import { afterEach, describe, expect, test } from 'bun:test'

import { installHttpAdapter } from '../adapters/http'
import type { HttpAdapterOptions } from '../adapters/http'
import { routeTarget } from '../../shared/target'
import { Session } from '../session'

/**
 * These drive the real patched `globalThis.fetch`, with only the *underlying*
 * fetch replaced.
 *
 * The adapter's whole claim is that a seeded route never reaches the network
 * and an unseeded one is untouched, and that claim is about what it does to the
 * global. Calling the adapter's internals directly would confirm whatever this
 * file assumed instead.
 */

type Call = { url: string; method: string }

let teardown: (() => void) | null = null

afterEach(() => {
  teardown?.()
  teardown = null
})

function setup(
  options: HttpAdapterOptions = {},
  respond: () => Response = () =>
    new Response(JSON.stringify({ source: 'network' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
) {
  const calls: Call[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    calls.push({
      url: String((input as { href?: string })?.href ?? input),
      method: ((init as { method?: string })?.method ?? 'GET').toUpperCase(),
    })
    return respond()
  }) as typeof fetch

  const session = new Session()
  const dispose = installHttpAdapter(session, options)

  teardown = () => {
    dispose()
    globalThis.fetch = original
  }

  return { session, calls, dispose }
}

/** Body capture runs off the response promise, so previews land a tick later. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('interception', () => {
  test('a seeded route never reaches the network', async () => {
    const { session, calls } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [{ id: 1 }])

    const response = await fetch('https://api.example.com/api/todos')

    expect(await response.json()).toEqual([{ id: 1 }])
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(0)
  })

  test('an unseeded route passes straight through', async () => {
    const { calls } = setup()
    const response = await fetch('https://api.example.com/api/todos')
    expect(await response.json()).toEqual({ source: 'network' })
    expect(calls).toHaveLength(1)
  })

  test('the seeded status is what the caller sees', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), { message: 'boom' }, { status: 500 })

    const response = await fetch('https://api.example.com/api/todos')

    expect(response.status).toBe(500)
    expect(response.ok).toBe(false)
    expect(await response.json()).toEqual({ message: 'boom' })
  })

  test('the response carries the url it was asked for', async () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    const response = await fetch('https://api.example.com/api/todos')
    expect(response.url).toBe('https://api.example.com/api/todos')
  })

  test('a glob covers every matching request with one seed', async () => {
    const { session, calls } = setup()
    session.apply(routeTarget('GET', '/api/users/*'), { id: 0 })

    expect(await (await fetch('https://x.com/api/users/7')).json()).toEqual({ id: 0 })
    expect(await (await fetch('https://x.com/api/users/9')).json()).toEqual({ id: 0 })
    // `*` stays within a segment, so a nested route is still real traffic.
    await fetch('https://x.com/api/users/7/posts')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://x.com/api/users/7/posts')
  })

  test('the method has to agree', async () => {
    const { session, calls } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    await fetch('https://x.com/api/todos', { method: 'POST' })
    expect(calls).toHaveLength(1)
  })

  test('clearing a seed lets real requests through again', async () => {
    const { session, calls } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    await fetch('https://x.com/api/todos')
    expect(calls).toHaveLength(0)

    session.clearAll()
    await fetch('https://x.com/api/todos')
    expect(calls).toHaveLength(1)
  })

  test('a URL object is understood, not skipped', async () => {
    const { session, calls } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    await fetch(new URL('https://x.com/api/todos'))
    expect(calls).toHaveLength(0)
  })

  test('dispose restores the original fetch', async () => {
    const { dispose, calls, session } = setup()
    session.apply(routeTarget('GET', '/api/todos'), [])
    dispose()
    await fetch('https://x.com/api/todos')
    expect(calls).toHaveLength(1)
  })
})

describe('observation', () => {
  test('records requests it did not seed, with their bodies', async () => {
    const { session } = setup()
    await fetch('https://x.com/api/todos')
    await settled()

    const [row] = session.listTargets()
    expect(row.label).toBe('GET https://x.com/api/todos')
    expect(row.adapter).toBe('http')
    expect(row.status).toBe('success')
    expect(row.hits).toBe(1)
    expect(row.seeded).toBe(false)
    expect(row.preview?.value).toEqual({ source: 'network' })
  })

  test('counts repeats rather than duplicating the row', async () => {
    const { session } = setup()
    await fetch('https://x.com/api/todos')
    await fetch('https://x.com/api/todos')
    await settled()

    const rows = session.listTargets()
    expect(rows).toHaveLength(1)
    expect(rows[0].hits).toBe(2)
  })

  test('marks an observed route as seeded once a pattern covers it', async () => {
    const { session } = setup()
    await fetch('https://x.com/api/todos')
    await settled()
    expect(session.listTargets()[0].seeded).toBe(false)

    session.apply(routeTarget('GET', '/api/todos'), [])
    const rows = session.listTargets()
    // One row, not two: the pattern is folded into the route it covers.
    expect(rows).toHaveLength(1)
    expect(rows[0].seeded).toBe(true)
  })

  test('a seeded pattern nothing has hit yet is still listed', () => {
    const { session } = setup()
    session.apply(routeTarget('GET', '/api/never-called'), [])

    const rows = session.listTargets()
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('GET /api/never-called')
    expect(rows[0].seeded).toBe(true)
    expect(rows[0].hits).toBe(0)
  })

  test('a non-2xx is surfaced as an error, not a success', async () => {
    const { session } = setup({}, () => new Response('nope', { status: 503 }))
    await fetch('https://x.com/api/todos')
    await settled()
    expect(session.listTargets()[0].error).toBe('HTTP 503')
  })

  test('a thrown request is recorded with its message', async () => {
    const { session } = setup({}, () => {
      throw new Error('Network request failed')
    })
    await expect(fetch('https://x.com/api/todos')).rejects.toThrow(
      'Network request failed',
    )
    await settled()
    const [row] = session.listTargets()
    expect(row.status).toBe('error')
    expect(row.error).toBe('Network request failed')
  })

  test("Metro's own endpoints are not recorded", async () => {
    const { session } = setup()
    await fetch('http://localhost:8081/symbolicate')
    await fetch('http://localhost:8081/inspector/device')
    await settled()
    expect(session.listTargets()).toHaveLength(0)
  })

  test('include narrows what is watched', async () => {
    const { session } = setup({ include: ['https://api.example.com/**'] })
    await fetch('https://api.example.com/todos')
    await fetch('https://other.com/todos')
    await settled()

    const rows = session.listTargets()
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('GET https://api.example.com/todos')
  })

  test('the oldest route is dropped once the cap is reached', async () => {
    const { session } = setup({ maxRoutes: 2 })
    await fetch('https://x.com/a')
    await fetch('https://x.com/b')
    await fetch('https://x.com/c')
    await settled()

    const labels = session.listTargets().map((row) => row.label)
    expect(labels).toEqual(['GET https://x.com/b', 'GET https://x.com/c'])
  })

  test('captureBodies: false keeps the row but drops the preview', async () => {
    const { session } = setup({ captureBodies: false })
    await fetch('https://x.com/api/todos')
    await settled()
    const [row] = session.listTargets()
    expect(row.hits).toBe(1)
    expect(row.preview).toBeUndefined()
  })
})

describe('capabilities', () => {
  test('reports itself as intercepting but not enumerable', () => {
    const { session } = setup()
    const [adapter] = session.adapters
    expect(adapter.id).toBe('http')
    expect(adapter.intercept).toBe(true)
    // Nothing can be listed before a request happens, which is what drives the
    // panel to offer a "seed a route you have not seen yet" input.
    expect(adapter.enumerable).toBe(false)
  })

  test('a query key is not something this adapter can address', () => {
    const { session } = setup()
    expect(session.apply({ adapter: '', ref: { kind: 'key', key: ['a'] } }, 1)).toBeNull()
  })
})
