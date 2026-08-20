import { afterEach, describe, expect, test } from 'bun:test'

import { installHttpAdapter } from '../adapters/http'
import { routeTarget } from '../../shared/target'
import { Session } from '../session'

/**
 * `XMLHttpRequest` interception, which is the path axios takes.
 *
 * Bun has no XHR, so these run against a stand-in shaped like React Native's:
 * state behind prototype getters with **no setters**, so a fake response has to
 * shadow them on the instance rather than assign — which is exactly the part
 * that would silently break against the real thing.
 *
 * The axios cases are the ones that matter most. A hand-rolled assertion about
 * which events fired would just restate this file's own assumptions; a real
 * client resolving with the seeded body is the actual claim.
 */

type Handler = (event: unknown) => void

/** Requests the stand-in "sent", so a test can prove nothing left the app. */
let network: Array<{ method: string; url: string }> = []
/** What the stand-in answers with when a request does reach it. */
let networkReply = { status: 200, body: '{"source":"network"}' }

class FakeXhr {
  #readyState = 0
  #status = 0
  #statusText = ''
  #responseText = ''
  #url = ''
  #method = 'GET'
  #listeners = new Map<string, Handler[]>()
  #headers: Record<string, string> = {}

  responseType = ''
  timeout = 0
  withCredentials = false
  onreadystatechange: Handler | null = null
  onload: Handler | null = null
  onloadend: Handler | null = null
  onerror: Handler | null = null
  onabort: Handler | null = null
  ontimeout: Handler | null = null
  upload: unknown = undefined

  // Getters with no setters, as React Native declares them.
  get readyState() {
    return this.#readyState
  }
  get status() {
    return this.#status
  }
  get statusText() {
    return this.#statusText
  }
  get responseText() {
    return this.#responseText
  }
  get responseURL() {
    return this.#url
  }
  get response(): unknown {
    if (this.responseType === 'json') {
      try {
        return JSON.parse(this.#responseText)
      } catch {
        return null
      }
    }
    return this.#responseText
  }

  open(method: string, url: string): void {
    this.#method = String(method).toUpperCase()
    this.#url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.#headers[name.toLowerCase()] = value
  }

  getAllResponseHeaders(): string {
    return 'content-type: application/json\r\n'
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === 'content-type' ? 'application/json' : null
  }

  abort(): void {}

  addEventListener(type: string, handler: Handler): void {
    const list = this.#listeners.get(type) ?? []
    list.push(handler)
    this.#listeners.set(type, list)
  }

  removeEventListener(type: string, handler: Handler): void {
    const list = this.#listeners.get(type) ?? []
    this.#listeners.set(
      type,
      list.filter((item) => item !== handler),
    )
  }

  dispatchEvent(event: { type: string }): boolean {
    for (const handler of this.#listeners.get(event.type) ?? []) handler(event)
    return true
  }

  send(): void {
    network.push({ method: this.#method, url: this.#url })
    setTimeout(() => {
      this.#readyState = 4
      this.#status = networkReply.status
      this.#statusText = 'OK'
      this.#responseText = networkReply.body
      this.dispatchEvent({ type: 'readystatechange' })
      this.onreadystatechange?.({ type: 'readystatechange' })
      this.dispatchEvent({ type: 'load' })
      this.onload?.({ type: 'load' })
      this.dispatchEvent({ type: 'loadend' })
      this.onloadend?.({ type: 'loadend' })
    }, 0)
  }
}

/**
 * axios decides whether the XHR adapter is usable **at import time**, from
 * `typeof XMLHttpRequest`. Bun has none, so the stand-in has to be installed
 * before axios is loaded — hence the dynamic import rather than a static one.
 */
const scope = globalThis as unknown as {
  XMLHttpRequest?: unknown
  fetch: typeof fetch
}
scope.XMLHttpRequest = FakeXhr
const axios = (await import('axios')).default

let teardown: (() => void) | null = null

afterEach(() => {
  teardown?.()
  teardown = null
})

function setup(
  options: Parameters<typeof installHttpAdapter>[1] = {},
  { polyfillFetch = false } = {},
) {
  network = []
  networkReply = { status: 200, body: '{"source":"network"}' }

  const originalXhr = scope.XMLHttpRequest
  const originalFetch = scope.fetch
  scope.XMLHttpRequest = FakeXhr

  // Stand-in for whatwg-fetch: builds an XHR and sends it synchronously inside
  // the promise executor, which is what the passthrough guard relies on to tell
  // that such a request is already accounted for one layer up. Installed before
  // the adapter, so the fetch patch wraps *this*.
  if (polyfillFetch) {
    scope.fetch = ((url: string) =>
      new Promise((resolve) => {
        const xhr = new FakeXhr()
        xhr.open('GET', String(url))
        xhr.onloadend = () =>
          resolve(new Response(xhr.responseText, { status: xhr.status }))
        xhr.send()
      })) as typeof fetch
  }

  const session = new Session()
  const dispose = installHttpAdapter(session, options)

  teardown = () => {
    dispose()
    scope.fetch = originalFetch
    if (originalXhr === undefined) delete scope.XMLHttpRequest
    else scope.XMLHttpRequest = originalXhr
  }

  return { session, dispose }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('axios', () => {
  test('a seeded route resolves without touching the network', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [{ id: 1, title: 'Seeded' }])

    const response = await axios.get('https://api.example.com/api/todos', {
      adapter: 'xhr',
    })

    expect(response.data).toEqual([{ id: 1, title: 'Seeded' }])
    expect(response.status).toBe(200)
    expect(network).toHaveLength(0)
  })

  test('an unseeded route reaches the network unchanged', async () => {
    setup()
    const response = await axios.get('https://api.example.com/api/todos', {
      adapter: 'xhr',
    })
    expect(response.data).toEqual({ source: 'network' })
    expect(network).toHaveLength(1)
  })

  test('a seeded 500 rejects the way a real one does', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), { message: 'boom' }, { status: 500 })

    await expect(
      axios.get('https://api.example.com/api/todos', { adapter: 'xhr' }),
    ).rejects.toMatchObject({ response: { status: 500, data: { message: 'boom' } } })
    expect(network).toHaveLength(0)
  })

  test('the method has to agree', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    await axios.post('https://api.example.com/api/todos', {}, { adapter: 'xhr' })
    expect(network).toHaveLength(1)
    expect(network[0].method).toBe('POST')
  })

  test('a glob covers every matching request', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/users/*'), { id: 0 })

    const a = await axios.get('https://x.com/api/users/7', { adapter: 'xhr' })
    const b = await axios.get('https://x.com/api/users/9', { adapter: 'xhr' })
    await axios.get('https://x.com/api/users/7/posts', { adapter: 'xhr' })

    expect(a.data).toEqual({ id: 0 })
    expect(b.data).toEqual({ id: 0 })
    // `*` stays within a segment, so the nested route is still real traffic.
    expect(network.map((call) => call.url)).toEqual(['https://x.com/api/users/7/posts'])
  })

  test('responseType json is honoured', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), { ok: true })
    const response = await axios.get('https://x.com/api/todos', {
      adapter: 'xhr',
      responseType: 'json',
    })
    expect(response.data).toEqual({ ok: true })
  })

  test('clearing a seed lets axios through again', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    await axios.get('https://x.com/api/todos', { adapter: 'xhr' })
    expect(network).toHaveLength(0)

    session.clearAll()
    await axios.get('https://x.com/api/todos', { adapter: 'xhr' })
    expect(network).toHaveLength(1)
  })
})

describe('observation', () => {
  test('records what axios actually called, with its body', async () => {
    const { session } = setup()
    await axios.get('https://x.com/api/todos', { adapter: 'xhr' })
    await settled()

    const [row] = session.listTargets()
    expect(row.label).toBe('GET https://x.com/api/todos')
    expect(row.hits).toBe(1)
    expect(row.preview?.value).toEqual({ source: 'network' })
  })

  test('a non-2xx is surfaced as an error', async () => {
    const { session } = setup()
    networkReply = { status: 503, body: 'nope' }
    await axios
      .get('https://x.com/api/todos', { adapter: 'xhr' })
      .catch(() => undefined)
    await settled()
    expect(session.listTargets()[0].error).toBe('HTTP 503')
  })

  test("Metro's own endpoints are not recorded", async () => {
    const { session } = setup()
    await axios.get('http://localhost:8081/symbolicate', { adapter: 'xhr' })
    await settled()
    expect(session.listTargets()).toHaveLength(0)
  })
})

describe('lifecycle', () => {
  test('dispose restores the prototype', async () => {
    const { session, dispose } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    dispose()

    await axios.get('https://x.com/api/todos', { adapter: 'xhr' })
    expect(network).toHaveLength(1)
  })

  test('xhr: false leaves XMLHttpRequest alone', async () => {
    const { session } = setup({ xhr: false })
    session.apply(routeTarget('GET', '/api/todos'), [])

    await axios.get('https://x.com/api/todos', { adapter: 'xhr' })
    // The seed exists but nothing patched XHR, so it never applied.
    expect(network).toHaveLength(1)
  })

  test('a polyfilled fetch over XHR is recorded once, not twice', async () => {
    const { session } = setup({}, { polyfillFetch: true })

    await fetch('https://x.com/api/todos')
    await settled()

    const rows = session.listTargets().filter((row) => row.label.includes('/api/todos'))
    expect(rows).toHaveLength(1)
    expect(rows[0].hits).toBe(1)
  })

  test('a seed still applies through a polyfilled fetch, at the fetch layer', async () => {
    const { session } = setup({}, { polyfillFetch: true })
    session.apply(routeTarget('GET', '/api/todos'), [{ id: 1 }])

    const response = await fetch('https://x.com/api/todos')

    expect(await response.json()).toEqual([{ id: 1 }])
    // Served above the polyfill, so the XHR underneath was never constructed.
    expect(network).toHaveLength(0)
  })
})
