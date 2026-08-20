import type { SerializedPayload, TargetSnapshot } from '../../shared/types'
import { targetId } from '../../shared/types'
import {
  ADAPTER_HTTP,
  formatRoutePattern,
  matchesRoute,
  parseRoutePattern,
  urlPath,
} from '../../shared/target'
import type { TargetRef } from '../../shared/target'
import { serialize } from '../serialize'
import type { Seed, SeedAdapter, Session } from '../session'

/**
 * Seeds HTTP responses, for apps that do not route everything through a query
 * cache — and for cases where seeding *below* the cache is the point, since a
 * response seeded here still runs the app's real parsing, transform and error
 * handling on the way up.
 *
 * This adapter is shaped differently from the cache-backed ones, in three ways
 * that the rest of the plugin has to accommodate:
 *
 *  - **Nothing can be enumerated.** A route only becomes known once a request
 *    has gone out, so `listTargets` reports what has been *observed*, plus any
 *    seeded pattern that has not matched anything yet.
 *  - **Seeds are keyed by pattern, not by target.** `GET /api/users/*` is one
 *    seed covering every user, where a query key seed covers exactly one key.
 *    That is why lookup here scans rather than hashing.
 *  - **There is no cache to write into or invalidate.** A seed takes effect on
 *    the next request and withdrawing it needs no cleanup, which is why this
 *    adapter implements neither `push` nor `invalidate`.
 */

export type HttpAdapterOptions = {
  /** Only intercept URLs matching these globs. Defaults to everything. */
  include?: string[]
  /**
   * Never intercept these. The defaults cover Metro's own dev endpoints, which
   * would otherwise flood the observed list on every reload.
   *
   * They are deliberately specific paths rather than "anything on localhost" —
   * plenty of people develop against an API on localhost, and silently hiding
   * it would be far worse than showing a little dev-server noise.
   */
  exclude?: string[]
  /** Observed routes retained before the oldest is dropped. Defaults to 200. */
  maxRoutes?: number
  /**
   * Read a copy of each real response so the panel can show what came back and
   * offer it as a starting point for a seed. Defaults to true.
   */
  captureBodies?: boolean
  /** Cap on a captured body, in bytes. Defaults to 64 KB. */
  maxCaptureBytes?: number
}

const DEFAULT_EXCLUDE = [
  '**/symbolicate',
  '**/hot',
  '**/inspector/**',
  '**/open-debugger',
  '**/launch-js-devtools',
  '**/debugger-frontend/**',
]

const DEFAULT_MAX_ROUTES = 200
const DEFAULT_MAX_CAPTURE = 64 * 1024

type Observed = {
  method: string
  url: string
  hits: number
  updatedAt: number
  inFlight: number
  status?: number
  error?: string
  preview?: SerializedPayload
  /** The last real response body, kept so it can seed the editor. */
  body?: unknown
}

type FetchLike = (input: unknown, init?: unknown) => Promise<unknown>

export function installHttpAdapter(
  session: Session,
  options: HttpAdapterOptions = {},
): () => void {
  const {
    include,
    exclude = DEFAULT_EXCLUDE,
    maxRoutes = DEFAULT_MAX_ROUTES,
    captureBodies = true,
    maxCaptureBytes = DEFAULT_MAX_CAPTURE,
  } = options

  const seeds = session.seedReader(ADAPTER_HTTP)
  const observed = new Map<string, Observed>()
  const disposers: Array<() => void> = []

  const includeRules = include?.map(parseRoutePattern)
  const excludeRules = exclude.map(parseRoutePattern)

  const shouldWatch = (method: string, url: string): boolean => {
    if (excludeRules.some((rule) => matchesRoute(rule, method, url))) return false
    if (!includeRules) return true
    return includeRules.some((rule) => matchesRoute(rule, method, url))
  }

  /**
   * The seed covering a request, if any.
   *
   * A linear scan over stored patterns. Requests are orders of magnitude rarer
   * than renders — this is not the hot path that the query adapter's hash
   * lookup is — and a handful of seeds is the realistic case.
   */
  const matchSeed = (method: string, url: string): Seed | undefined => {
    for (const [identity, seed] of seeds.entries()) {
      const pattern = parseRoutePattern(identity)
      if (matchesRoute(pattern, method, url)) return seed
    }
    return undefined
  }

  const observe = (method: string, url: string): Observed => {
    const key = `${method} ${url}`
    let entry = observed.get(key)
    if (!entry) {
      entry = { method, url, hits: 0, updatedAt: Date.now(), inFlight: 0 }
      // Insertion-ordered, so the first key is the least recently *first seen*.
      if (observed.size >= maxRoutes) {
        const oldest = observed.keys().next()
        if (!oldest.done) observed.delete(oldest.value)
      }
      observed.set(key, entry)
    }
    entry.hits += 1
    entry.updatedAt = Date.now()
    return entry
  }

  const settle = (
    entry: Observed,
    outcome: { status?: number; error?: string; body?: unknown },
  ): void => {
    entry.inFlight = Math.max(0, entry.inFlight - 1)
    entry.updatedAt = Date.now()
    if (outcome.status !== undefined) entry.status = outcome.status
    entry.error = outcome.error
    if ('body' in outcome) {
      entry.body = outcome.body
      entry.preview = serialize(outcome.body, { preview: true })
    }
    session.scheduleFlush()
  }

  // ---- fetch ----

  const globals = globalThis as unknown as {
    fetch?: FetchLike
    Response?: new (body?: unknown, init?: unknown) => unknown
  }
  const originalFetch = globals.fetch
  const ResponseCtor = globals.Response
  const intercept = typeof originalFetch === 'function' && typeof ResponseCtor === 'function'

  if (intercept && originalFetch) {
    const patched = function seedFetch(
      this: unknown,
      input: unknown,
      init?: unknown,
    ): Promise<unknown> {
      let request: { method: string; url: string }
      try {
        request = describeRequest(input, init)
      } catch {
        // Anything we cannot read, we do not touch.
        return originalFetch.call(this, input, init)
      }

      const { method, url } = request
      if (!shouldWatch(method, url)) return originalFetch.call(this, input, init)

      const entry = observe(method, url)
      const seed = matchSeed(method, url)

      if (seed) {
        const status = seedStatus(seed)
        settle(entry, { status, body: seed.data })
        return Promise.resolve(buildResponse(ResponseCtor, seed.data, status, url))
      }

      entry.inFlight += 1
      session.scheduleFlush()

      return originalFetch.call(this, input, init).then(
        (response) => {
          const status = readStatus(response)
          if (captureBodies) {
            // Read a *copy* in the background. The app gets its response
            // immediately; capturing must never add latency to a real request,
            // and consuming the original stream would break the caller outright.
            void captureBody(response, maxCaptureBytes).then((body) => {
              settle(entry, { status, body })
            })
          } else {
            settle(entry, { status })
          }
          return response
        },
        (error: unknown) => {
          settle(entry, { error: errorMessage(error) })
          throw error
        },
      )
    }

    globals.fetch = patched as FetchLike
    disposers.push(() => {
      // Only restore if nothing else wrapped us afterwards; clobbering another
      // tool's patch would be worse than leaving ours in place.
      if (globals.fetch === patched) globals.fetch = originalFetch
    })
  }

  // ---- adapter ----

  const adapter: SeedAdapter = {
    id: ADAPTER_HTTP,
    label: 'HTTP',
    intercept,
    // A route is only known once it has been requested, which is what drives
    // the panel to offer a "seed a route you have not seen yet" input.
    enumerable: false,

    identify: (ref) =>
      ref.kind === 'route'
        ? formatRoutePattern(parseRoutePattern(`${ref.method} ${ref.url}`))
        : null,

    listTargets: () => {
      const rows: TargetSnapshot[] = []

      for (const entry of observed.values()) {
        const seed = matchSeed(entry.method, entry.url)
        rows.push({
          id: targetId(ADAPTER_HTTP, `${entry.method} ${entry.url}`),
          adapter: ADAPTER_HTTP,
          ref: { kind: 'route', method: entry.method, url: entry.url },
          label: `${entry.method} ${entry.url}`,
          status: entry.error ? 'error' : entry.status === undefined ? 'pending' : 'success',
          fetchStatus: entry.inFlight > 0 ? 'fetching' : 'idle',
          updatedAt: entry.updatedAt,
          seeded: Boolean(seed),
          preview: entry.preview,
          error: entry.error ?? httpErrorText(entry.status),
          hits: entry.hits,
        })
      }

      /**
       * Seeded patterns that have not matched anything yet.
       *
       * Without this a rule you just wrote would simply not appear until a
       * request happened to hit it — which reads as "the seed did not take"
       * exactly when you are waiting to find out whether it did.
       */
      for (const [identity, seed] of seeds.entries()) {
        const covered = Array.from(observed.values()).some((entry) =>
          matchesRoute(parseRoutePattern(identity), entry.method, entry.url),
        )
        if (covered) continue
        rows.push({
          id: targetId(ADAPTER_HTTP, identity),
          adapter: ADAPTER_HTTP,
          ref: seed.target.ref,
          label: identity,
          status: 'success',
          fetchStatus: 'idle',
          updatedAt: seed.appliedAt,
          seeded: true,
          preview: serialize(seed.data, { preview: true }),
          hits: 0,
        })
      }

      return rows
    },

    readData: (identity) => {
      const entry = observed.get(identity)
      return entry && 'body' in entry ? serialize(entry.body) : { kind: 'undefined' }
    },

    // No `push`: there is no cache to write into — the seed applies to the next
    // request. No `invalidate`: withdrawing it needs no cleanup for the same
    // reason. Both being absent is what tells the session this adapter only
    // intercepts.
  }

  disposers.push(session.registerAdapter(adapter))

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // A failing disposer must not prevent the rest from running.
      }
    }
  }
}

// ------------------------------------------------------------------ helpers

/** `fetch` accepts a string, a `URL`, or a `Request`; all three appear in apps. */
function describeRequest(
  input: unknown,
  init?: unknown,
): { method: string; url: string } {
  const options = (init ?? {}) as { method?: string }
  if (typeof input === 'string') {
    return { method: (options.method ?? 'GET').toUpperCase(), url: input }
  }
  if (input && typeof input === 'object') {
    const candidate = input as { url?: unknown; method?: unknown; href?: unknown }
    if (typeof candidate.href === 'string') {
      return { method: (options.method ?? 'GET').toUpperCase(), url: candidate.href }
    }
    if (typeof candidate.url === 'string') {
      const method = options.method ?? (candidate.method as string | undefined) ?? 'GET'
      return { method: method.toUpperCase(), url: candidate.url }
    }
  }
  throw new Error('unrecognised fetch input')
}

export type SeedMetaLike = { status?: number }

function seedStatus(seed: Seed): number {
  const status = (seed.meta as SeedMetaLike | undefined)?.status
  return typeof status === 'number' ? status : 200
}

function buildResponse(
  ResponseCtor: new (body?: unknown, init?: unknown) => unknown,
  data: unknown,
  status: number,
  url: string,
): unknown {
  const body = data === undefined ? '' : JSON.stringify(data)
  const response = new ResponseCtor(body, {
    status,
    // `statusText` matters: some clients render it, and axios includes it in
    // the error it throws for a non-2xx.
    statusText: statusText(status),
    headers: { 'Content-Type': 'application/json' },
  })
  try {
    // whatwg-fetch leaves `url` empty on a constructed Response, and code that
    // logs or redirect-checks against it would see a blank.
    Object.defineProperty(response, 'url', { value: url, configurable: true })
  } catch {
    // Non-configurable in some implementations; not worth failing the seed for.
  }
  return response
}

function readStatus(response: unknown): number | undefined {
  const candidate = response as { status?: unknown }
  return typeof candidate?.status === 'number' ? candidate.status : undefined
}

/**
 * Reads a clone of a response body, parsed as JSON when it is JSON.
 *
 * Always resolves — a capture failure is a missing preview, never a broken
 * request, and the app has already been handed the real response by this point.
 */
async function captureBody(response: unknown, maxBytes: number): Promise<unknown> {
  const candidate = response as {
    clone?: () => { text?: () => Promise<string> }
  }
  if (typeof candidate?.clone !== 'function') return undefined
  try {
    const copy = candidate.clone()
    if (typeof copy.text !== 'function') return undefined
    const text = await copy.text()
    const clipped = text.length > maxBytes ? text.slice(0, maxBytes) : text
    try {
      return JSON.parse(clipped)
    } catch {
      return clipped
    }
  } catch {
    return undefined
  }
}

/** A non-2xx is not a thrown error, but it is still what you want to see. */
function httpErrorText(status: number | undefined): string | undefined {
  if (status === undefined || (status >= 200 && status < 400)) return undefined
  return `HTTP ${status}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

function statusText(status: number): string {
  return STATUS_TEXT[status] ?? ''
}

/** Exported for the panel's default when you seed an observed route. */
export function defaultRoutePattern(ref: TargetRef): string {
  if (ref.kind !== 'route') return ''
  // Strip origin and query: seeding "GET /api/todos" is almost always what is
  // meant, and the exact URL with its page parameter almost never is.
  return `${ref.method} ${urlPath(ref.url)}`
}
