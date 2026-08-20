import type { SerializedPayload, TargetSnapshot } from '../../../shared/types'
import { targetId } from '../../../shared/types'
import {
  ADAPTER_HTTP,
  formatRoutePattern,
  matchesRoute,
  parseRoutePattern,
} from '../../../shared/target'
import { serialize } from '../../serialize'
import type { Seed, SeedReader } from '../../session'

/**
 * What every HTTP transport shares: deciding whether to watch a request,
 * finding the seed that covers it, and recording what happened.
 *
 * There are three transports rather than one because React Native has three
 * genuinely separate networking paths — the `fetch` polyfill, `XMLHttpRequest`
 * underneath it, and `expo/fetch`, which is native and goes through neither.
 * They differ only in how a request is read and a response is faked; everything
 * else is here.
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
  /**
   * Also patch `XMLHttpRequest`, which is what axios and other pre-fetch
   * clients use. Defaults to true.
   *
   * Turn it off if another tool already owns XHR — two patches are usually
   * fine, but this one fakes responses, and stacking that is not worth guessing
   * about.
   */
  xhr?: boolean
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

export type Observed = {
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

export type Outcome = {
  status?: number
  error?: string
  body?: unknown
}

export class HttpRuntime {
  readonly captureBodies: boolean
  readonly maxCaptureBytes: number

  #seeds: SeedReader
  #observed = new Map<string, Observed>()
  #includeRules?: Array<{ method: string; glob: string }>
  #excludeRules: Array<{ method: string; glob: string }>
  #maxRoutes: number
  #onChange: () => void

  /**
   * Depth of "we are inside our own fetch passthrough".
   *
   * React Native's `fetch` is a polyfill *over* `XMLHttpRequest`, so a request
   * that passes through the fetch wrapper then reaches the XHR patch and would
   * be recorded a second time — one request, two rows, doubled hit counts.
   *
   * whatwg-fetch runs `xhr.open`/`xhr.send` synchronously inside its Promise
   * executor, so a plain counter held across that call is enough to tell the
   * XHR layer the request is already accounted for.
   */
  #passthroughDepth = 0

  constructor(seeds: SeedReader, options: HttpAdapterOptions, onChange: () => void) {
    this.#seeds = seeds
    this.#onChange = onChange
    this.#maxRoutes = options.maxRoutes ?? DEFAULT_MAX_ROUTES
    this.captureBodies = options.captureBodies ?? true
    this.maxCaptureBytes = options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE
    this.#includeRules = options.include?.map(parseRoutePattern)
    this.#excludeRules = (options.exclude ?? DEFAULT_EXCLUDE).map(parseRoutePattern)
  }

  shouldWatch(method: string, url: string): boolean {
    if (this.#excludeRules.some((rule) => matchesRoute(rule, method, url))) return false
    if (!this.#includeRules) return true
    return this.#includeRules.some((rule) => matchesRoute(rule, method, url))
  }

  /**
   * The seed covering a request, if any.
   *
   * A linear scan over stored patterns. Requests are orders of magnitude rarer
   * than renders — this is not the hot path that the query adapter's hash
   * lookup is — and a handful of seeds is the realistic case.
   */
  matchSeed(method: string, url: string): Seed | undefined {
    for (const [identity, seed] of this.#seeds.entries()) {
      if (matchesRoute(parseRoutePattern(identity), method, url)) return seed
    }
    return undefined
  }

  /** Records a request and returns its row. */
  observe(method: string, url: string): Observed {
    const key = `${method} ${url}`
    let entry = this.#observed.get(key)
    if (!entry) {
      entry = { method, url, hits: 0, updatedAt: Date.now(), inFlight: 0 }
      // Insertion-ordered, so the first key is the least recently *first seen*.
      if (this.#observed.size >= this.#maxRoutes) {
        const oldest = this.#observed.keys().next()
        if (!oldest.done) this.#observed.delete(oldest.value)
      }
      this.#observed.set(key, entry)
    }
    entry.hits += 1
    entry.updatedAt = Date.now()
    return entry
  }

  settle(entry: Observed, outcome: Outcome): void {
    entry.inFlight = Math.max(0, entry.inFlight - 1)
    entry.updatedAt = Date.now()
    if (outcome.status !== undefined) entry.status = outcome.status
    entry.error = outcome.error
    if ('body' in outcome) {
      entry.body = outcome.body
      entry.preview = serialize(outcome.body, { preview: true })
    }
    this.#onChange()
  }

  changed(): void {
    this.#onChange()
  }

  // ---- re-entrancy ----

  enterPassthrough(): void {
    this.#passthroughDepth += 1
  }

  exitPassthrough(): void {
    this.#passthroughDepth = Math.max(0, this.#passthroughDepth - 1)
  }

  get inPassthrough(): boolean {
    return this.#passthroughDepth > 0
  }

  // ---- panel surface ----

  readData(identity: string): SerializedPayload {
    const entry = this.#observed.get(identity)
    return entry && 'body' in entry ? serialize(entry.body) : { kind: 'undefined' }
  }

  listTargets(): TargetSnapshot[] {
    const rows: TargetSnapshot[] = []

    for (const entry of this.#observed.values()) {
      rows.push({
        id: targetId(ADAPTER_HTTP, `${entry.method} ${entry.url}`),
        adapter: ADAPTER_HTTP,
        ref: { kind: 'route', method: entry.method, url: entry.url },
        label: `${entry.method} ${entry.url}`,
        status: entry.error
          ? 'error'
          : entry.status === undefined
            ? 'pending'
            : 'success',
        fetchStatus: entry.inFlight > 0 ? 'fetching' : 'idle',
        updatedAt: entry.updatedAt,
        seeded: Boolean(this.matchSeed(entry.method, entry.url)),
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
    for (const [identity, seed] of this.#seeds.entries()) {
      const pattern = parseRoutePattern(identity)
      const covered = Array.from(this.#observed.values()).some((entry) =>
        matchesRoute(pattern, entry.method, entry.url),
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
  }
}

/** This adapter's stable identity for a route ref: its normalised pattern. */
export function routeIdentity(method: string, url: string): string {
  return formatRoutePattern(parseRoutePattern(`${method} ${url}`))
}

export function seedStatus(seed: Seed): number {
  const status = (seed.meta as { status?: number } | undefined)?.status
  return typeof status === 'number' ? status : 200
}

/** A non-2xx is not a thrown error, but it is still what you want to see. */
export function httpErrorText(status: number | undefined): string | undefined {
  if (status === undefined || (status >= 200 && status < 400)) return undefined
  return `HTTP ${status}`
}

export function errorMessage(error: unknown): string {
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

export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? ''
}

/** The JSON body a seed responds with. */
export function seedBodyText(data: unknown): string {
  if (data === undefined) return ''
  try {
    return JSON.stringify(data) ?? ''
  } catch {
    return ''
  }
}

// ------------------------------------------------------- ambient registry

/**
 * The runtime a wrapped `fetch` talks to.
 *
 * Module-level because those wrappers are created at import time, long before
 * `useSeeder` mounts — the same delegating indirection the query adapter uses
 * for `queryFn`, and for the same reason: the wrapper has to resolve the
 * session at *call* time or it would capture whatever was true at startup.
 */
let active: HttpRuntime | null = null

export function setActiveRuntime(runtime: HttpRuntime | null): void {
  active = runtime
}

export function clearActiveRuntime(runtime: HttpRuntime): void {
  if (active === runtime) active = null
}

export function activeRuntime(): HttpRuntime | null {
  return active
}

/**
 * The same rendezvous again, but on `globalThis`.
 *
 * The `./expo` entry deliberately imports nothing from this package: it has to
 * `require` an internal Expo path, so it must stay out of every bundle that does
 * not opt in. That makes a module-level variable useless to it — it could be
 * resolved as a second copy of this module, and then the copy the hook writes to
 * is not the copy the wrapper reads from, which fails silently and looks exactly
 * like "the seed did not apply".
 *
 * A global has no such ambiguity, so it is what the two ends agree on.
 */
export const FETCH_HOOK_KEY = '__rozeniteDataSeedFetchHook__'

export type FetchHook = (
  impl: (input: unknown, init?: unknown) => Promise<unknown>,
  thisArg: unknown,
  input: unknown,
  init?: unknown,
) => Promise<unknown>

type HookHost = Record<string, FetchHook | null | undefined>

export function publishFetchHook(hook: FetchHook | null): void {
  ;(globalThis as unknown as HookHost)[FETCH_HOOK_KEY] = hook
}

export function currentFetchHook(): FetchHook | null {
  return (globalThis as unknown as HookHost)[FETCH_HOOK_KEY] ?? null
}
