import type { HttpRuntime, Observed } from './runtime'
import {
  activeRuntime,
  errorMessage,
  seedBodyText,
  seedStatus,
  statusText,
} from './runtime'

/**
 * `XMLHttpRequest` interception, which is what covers **axios**.
 *
 * In React Native `fetch` is a polyfill *over* XHR, so patching fetch alone
 * misses every client that talks to XHR directly — axios being by far the most
 * common. Patching XHR alone would be tempting for that reason, but it means
 * faking an XHR rather than constructing a `Response`, which is meaningfully
 * more delicate. So both are patched, fetch first, and the runtime's
 * passthrough counter keeps a polyfilled fetch from being recorded twice.
 *
 * Faking a response means shadowing the prototype's getters on the instance and
 * firing the right events in the right order. What "the right order" is comes
 * from what clients actually listen to: axios uses `onloadend` when it exists
 * and falls back to `onreadystatechange`, so both fire, and `load` is dispatched
 * for everything else.
 */

type XhrCtor = {
  new (): XhrLike
  prototype: XhrLike
}

type XhrLike = {
  open: (method: string, url: string, ...rest: unknown[]) => void
  send: (body?: unknown) => void
  readyState?: number
  status?: number
  statusText?: string
  response?: unknown
  responseText?: string
  responseType?: string
  responseURL?: string
  onreadystatechange?: (() => void) | null
  onload?: (() => void) | null
  onloadend?: (() => void) | null
  onerror?: (() => void) | null
  onprogress?: (() => void) | null
  dispatchEvent?: (event: { type: string }) => unknown
  getAllResponseHeaders?: () => string
  getResponseHeader?: (name: string) => string | null
  setRequestHeader?: (name: string, value: string) => void
}

/** What `open` recorded, kept on the instance until `send`. */
type Pending = { method: string; url: string }

const PENDING = new WeakMap<object, Pending>()

export function patchXhr(): () => void {
  const scope = globalThis as unknown as { XMLHttpRequest?: XhrCtor }
  const XHR = scope.XMLHttpRequest
  if (typeof XHR !== 'function' || !XHR.prototype) return () => {}

  const originalOpen = XHR.prototype.open
  const originalSend = XHR.prototype.send
  if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') {
    return () => {}
  }

  const patchedOpen = function open(
    this: XhrLike,
    method: string,
    url: string,
    ...rest: unknown[]
  ): void {
    try {
      PENDING.set(this as object, {
        method: String(method ?? 'GET').toUpperCase(),
        url: String(url ?? ''),
      })
    } catch {
      // A frozen or exotic instance: fall through and simply do not intercept.
    }
    return originalOpen.call(this, method, url, ...rest)
  }

  const patchedSend = function send(this: XhrLike, body?: unknown): void {
    const runtime = activeRuntime()
    const pending = PENDING.get(this as object)

    // `inPassthrough` means a polyfilled `fetch` is already recording this
    // request one layer up; recording it here too would double every hit.
    if (!runtime || !pending || runtime.inPassthrough) {
      return originalSend.call(this, body)
    }
    if (!runtime.shouldWatch(pending.method, pending.url)) {
      return originalSend.call(this, body)
    }

    const entry = runtime.observe(pending.method, pending.url)
    const seed = runtime.matchSeed(pending.method, pending.url)

    if (seed) {
      const status = seedStatus(seed)
      runtime.settle(entry, { status, body: seed.data })
      respondWith(this, pending, seedBodyText(seed.data), status)
      return
    }

    entry.inFlight += 1
    runtime.changed()
    observeReal(this, runtime, entry)
    return originalSend.call(this, body)
  }

  XHR.prototype.open = patchedOpen
  XHR.prototype.send = patchedSend

  return () => {
    if (XHR.prototype.open === patchedOpen) XHR.prototype.open = originalOpen
    if (XHR.prototype.send === patchedSend) XHR.prototype.send = originalSend
  }
}

/**
 * Records a real request's outcome without changing it.
 *
 * Chains onto `onreadystatechange` rather than replacing it, and uses
 * `addEventListener` when available so an app handler assigned *after* `send`
 * still runs.
 */
function observeReal(xhr: XhrLike, runtime: HttpRuntime, entry: Observed): void {
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    const status = typeof xhr.status === 'number' ? xhr.status : undefined
    if (!status) {
      runtime.settle(entry, { error: 'Network request failed' })
      return
    }
    runtime.settle(entry, {
      status,
      ...(runtime.captureBodies ? { body: readBody(xhr, runtime.maxCaptureBytes) } : {}),
    })
  }

  const target = xhr as unknown as {
    addEventListener?: (type: string, listener: () => void) => void
  }
  if (typeof target.addEventListener === 'function') {
    target.addEventListener('loadend', finish)
    target.addEventListener('error', finish)
    return
  }

  const previous = xhr.onreadystatechange
  xhr.onreadystatechange = function chained(this: XhrLike) {
    if (this.readyState === 4) finish()
    previous?.call(this)
  }
}

function readBody(xhr: XhrLike, maxBytes: number): unknown {
  try {
    const type = xhr.responseType
    if (type === 'json') return xhr.response
    const text =
      type === '' || type === 'text' || type === undefined
        ? xhr.responseText
        : undefined
    if (typeof text !== 'string') return undefined
    const clipped = text.length > maxBytes ? text.slice(0, maxBytes) : text
    try {
      return JSON.parse(clipped)
    } catch {
      return clipped
    }
  } catch {
    // Reading `responseText` throws for some responseType combinations.
    return undefined
  }
}

/**
 * Completes a request locally, without opening a socket.
 *
 * The instance properties are defined on the object itself, which shadows the
 * prototype getters React Native declares — assignment alone would throw or be
 * ignored, since those getters have no setters.
 */
function respondWith(
  xhr: XhrLike,
  pending: Pending,
  bodyText: string,
  status: number,
): void {
  const headers = 'content-type: application/json\r\n'

  define(xhr, 'readyState', 4)
  define(xhr, 'status', status)
  define(xhr, 'statusText', statusText(status))
  define(xhr, 'responseURL', pending.url)
  define(xhr, 'responseText', bodyText)
  define(xhr, 'response', responseFor(xhr, bodyText))
  define(xhr, 'getAllResponseHeaders', () => headers)
  define(xhr, 'getResponseHeader', (name: string) =>
    String(name).toLowerCase() === 'content-type' ? 'application/json' : null,
  )

  // Asynchronous, because a real XHR never completes before `send` returns and
  // callers routinely attach handlers on the line after it.
  const emit = () => {
    fire(xhr, 'readystatechange')
    fire(xhr, 'load')
    fire(xhr, 'loadend')
  }
  if (typeof queueMicrotask === 'function') queueMicrotask(emit)
  else setTimeout(emit, 0)
}

/**
 * `response` depends on `responseType`, and axios reads whichever it asked for.
 *
 * A `json` request that got back unparseable text yields `null`, which is what
 * a real XHR does rather than throwing.
 */
function responseFor(xhr: XhrLike, bodyText: string): unknown {
  const type = xhr.responseType
  if (type === 'json') {
    try {
      return bodyText === '' ? null : JSON.parse(bodyText)
    } catch {
      return null
    }
  }
  return bodyText
}

function define(target: XhrLike, key: string, value: unknown): void {
  try {
    Object.defineProperty(target, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  } catch {
    // Sealed instance; the remaining properties still apply.
  }
}

/** Fires both the `on*` handler and any `addEventListener` subscribers. */
function fire(xhr: XhrLike, type: string): void {
  const handler = (xhr as unknown as Record<string, unknown>)[`on${type}`]
  const event = { type, target: xhr, currentTarget: xhr }

  if (typeof xhr.dispatchEvent === 'function') {
    try {
      xhr.dispatchEvent(event)
    } catch (error) {
      // A dispatch that throws is the app's own listener failing; it must not
      // also prevent the `on*` handler below from running.
      void errorMessage(error)
    }
  }
  if (typeof handler === 'function') {
    ;(handler as (event: unknown) => void).call(xhr, event)
  }
}
