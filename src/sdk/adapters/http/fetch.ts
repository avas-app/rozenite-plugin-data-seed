import { urlPath } from '../../../shared/target'
import type { TargetRef } from '../../../shared/target'
import type { HttpRuntime } from './runtime'
import {
  currentFetchHook,
  errorMessage,
  publishFetchHook,
  seedBodyText,
  seedStatus,
  settleQuietly,
  statusText,
} from './runtime'

/**
 * `fetch` interception.
 *
 * Two entry points onto the same wrapper: the global patch, which covers
 * everything built on `globalThis.fetch`, and `seedableFetch`, which an app
 * applies by hand to an implementation that cannot be patched — see its doc
 * comment for why `expo/fetch` is one of those.
 */

type FetchLike = (input: unknown, init?: unknown) => Promise<unknown>

type Globals = {
  fetch?: FetchLike
  Response?: new (body?: unknown, init?: unknown) => unknown
}

function globals(): Globals {
  return globalThis as unknown as Globals
}

/** True when a `Response` constructor exists to build a seeded reply with. */
export function canBuildResponses(): boolean {
  return typeof globals().Response === 'function'
}

/**
 * Wraps one `fetch` implementation so seeded routes never reach it.
 *
 * Exported publicly as `seedableFetch`. An app needs it for any fetch that is
 * not `globalThis.fetch` and cannot be reassigned — most notably `expo/fetch`,
 * whose module namespace Metro compiles to a getter with `configurable: false`,
 * so neither assignment nor `defineProperty` can replace it. Patching would
 * have to reach into `expo/src/...`, which would make Expo a bundle-time
 * dependency of this package and break every bare React Native app.
 *
 * ```ts
 * import { fetch as expoFetch } from 'expo/fetch'
 * import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'
 *
 * export const fetch = seedableFetch(expoFetch)
 * ```
 *
 * Resolves the runtime per call rather than capturing it, so a wrapper created
 * at module scope still works once `useSeeder` mounts, and goes inert again
 * when it unmounts.
 */
export function wrapFetch(impl: FetchLike): FetchLike {
  return function seedableFetchImpl(
    this: unknown,
    input: unknown,
    init?: unknown,
  ): Promise<unknown> {
    // Read through the same global hook the `./expo` entry uses, so there is
    // one publish point and one lookup rather than two mechanisms that can
    // disagree about whether seeding is active.
    const hook = currentFetchHook()
    if (!hook) return impl.call(this, input, init)
    return hook(impl, this, input, init)
  }
}

/**
 * Makes this runtime the one every wrapped fetch consults, and returns the undo.
 *
 * Separate from patching the global `fetch` because the two are independent:
 * `seedableFetch` wrappers and the `./expo` entry need the hook even when the
 * global itself was never patchable.
 */
export function publishRuntime(runtime: HttpRuntime): () => void {
  const ResponseCtor = globals().Response
  if (typeof ResponseCtor !== 'function') return () => {}

  const hook = (
    impl: FetchLike,
    thisArg: unknown,
    input: unknown,
    init?: unknown,
  ): Promise<unknown> => intercept(runtime, ResponseCtor, impl, thisArg, input, init)

  publishFetchHook(hook)
  return () => {
    if (currentFetchHook() === hook) publishFetchHook(null)
  }
}

/** Replaces `globalThis.fetch`, returning the undo. */
export function patchGlobalFetch(): () => void {
  const scope = globals()
  const original = scope.fetch
  if (typeof original !== 'function') return () => {}

  const patched = wrapFetch(original)
  scope.fetch = patched
  return () => {
    // Only restore if nothing else wrapped us afterwards; clobbering another
    // tool's patch would be worse than leaving ours in place.
    if (scope.fetch === patched) scope.fetch = original
  }
}

function intercept(
  runtime: HttpRuntime,
  ResponseCtor: NonNullable<Globals['Response']>,
  impl: FetchLike,
  thisArg: unknown,
  input: unknown,
  init?: unknown,
): Promise<unknown> {
  let request: { method: string; url: string }
  try {
    request = describeRequest(input, init)
  } catch {
    // Anything we cannot read, we do not touch.
    return impl.call(thisArg, input, init)
  }

  const { method, url } = request

  // Everything from here to the real call runs on the app's own `fetch` stack,
  // so a bug in ours surfaces as the app's request failing. Falling through to
  // the real implementation costs a devtool feature; throwing costs a feature
  // of the app being debugged.
  let entry: ReturnType<HttpRuntime['observe']>
  let seed: ReturnType<HttpRuntime['matchSeed']>
  try {
    if (!runtime.shouldWatch(method, url)) return impl.call(thisArg, input, init)
    entry = runtime.observe(method, url)
    seed = runtime.matchSeed(method, url)
  } catch {
    return impl.call(thisArg, input, init)
  }

  if (seed) {
    const status = seedStatus(seed)
    try {
      const response = buildResponse(ResponseCtor, seed.data, status, url)
      settleQuietly(runtime, entry, { status, body: seed.data })
      return Promise.resolve(response)
    } catch {
      // The seed could not be turned into a Response. Serving the real request
      // is wrong, but it is the app's own behaviour — a throw here is not.
      return impl.call(thisArg, input, init)
    }
  }

  entry.inFlight += 1
  try {
    runtime.changed()
  } catch {
    // Only the panel misses an update.
  }

  // Held across the call so the XHR layer can tell that a request arriving
  // underneath a polyfilled fetch has already been counted here.
  runtime.enterPassthrough()
  let pending: Promise<unknown>
  try {
    pending = impl.call(thisArg, input, init)
  } catch (error) {
    runtime.exitPassthrough()
    settleQuietly(runtime, entry, { error: errorMessage(error) })
    throw error
  }
  runtime.exitPassthrough()

  return pending.then(
    (response) => {
      const status = readStatus(response)
      if (runtime.captureBodies) {
        // Read a *copy* in the background. The app gets its response
        // immediately; capturing must never add latency to a real request,
        // and consuming the original stream would break the caller outright.
        void captureBody(response, runtime.maxCaptureBytes).then((body) => {
          settleQuietly(runtime, entry, { status, body })
        })
      } else {
        settleQuietly(runtime, entry, { status })
      }
      return response
    },
    (error: unknown) => {
      settleQuietly(runtime, entry, { error: errorMessage(error) })
      throw error
    },
  )
}

/** `fetch` accepts a string, a `URL`, or a `Request`; all three appear in apps. */
export function describeRequest(
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

function buildResponse(
  ResponseCtor: NonNullable<Globals['Response']>,
  data: unknown,
  status: number,
  url: string,
): unknown {
  const response = new ResponseCtor(seedBodyText(data), {
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

/** The panel's default pattern when you seed an observed route. */
export function defaultRoutePattern(ref: TargetRef): string {
  if (ref.kind !== 'route') return ''
  // Strip origin and query: seeding "GET /api/todos" is almost always what is
  // meant, and the exact URL with its page parameter almost never is.
  return `${ref.method} ${urlPath(ref.url)}`
}
