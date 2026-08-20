import { afterEach, describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import { installHttpAdapter } from '../adapters/http'
import type { QueryClientLike } from '../adapters/react-query'
import { installReactQueryAdapter } from '../adapters/react-query'
import { keyTarget, routeTarget } from '../../shared/target'
import { Session } from '../session'

/**
 * Routing between adapters — the only behaviour that did not exist when there
 * was just one.
 *
 * The risk this covers is a target quietly reaching the wrong adapter: a route
 * landing in the query cache, or a key being matched against URL patterns. Both
 * would look like "the seed did not apply" from the outside.
 */

let teardown: (() => void) | null = null

afterEach(() => {
  teardown?.()
  teardown = null
})

function setup() {
  const originalFetch = globalThis.fetch
  const networkCalls: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    networkCalls.push(String(input))
    return new Response('{}', { status: 200 })
  }) as typeof fetch

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session = new Session()
  const disposeQuery = installReactQueryAdapter(
    client as unknown as QueryClientLike,
    session,
  )
  const disposeHttp = installHttpAdapter(session)

  teardown = () => {
    disposeHttp()
    disposeQuery()
    globalThis.fetch = originalFetch
  }

  return { client, session, networkCalls }
}

describe('multiple adapters', () => {
  test('both register and report themselves', () => {
    const { session } = setup()
    expect(session.adapters.map((a) => a.id)).toEqual(['react-query', 'http'])
  })

  test('a key goes to the query cache and a route to fetch', async () => {
    const { client, session, networkCalls } = setup()

    session.apply(keyTarget(['todos']), [{ id: 1 }])
    session.apply(routeTarget('GET', '/api/todos'), [{ id: 2 }])

    expect(client.getQueryData<unknown[]>(['todos'])).toEqual([{ id: 1 }])
    const response = await fetch('https://x.com/api/todos')
    expect(await response.json()).toEqual([{ id: 2 }])
    expect(networkCalls).toHaveLength(0)
  })

  test('seed ids are namespaced, so the two cannot collide', () => {
    const { session } = setup()
    session.apply(keyTarget(['todos']), 1)
    session.apply(routeTarget('GET', '/api/todos'), 2)

    const ids = session.seedList().map((seed) => seed.id)
    expect(ids).toEqual(['react-query:["todos"]', 'http:GET /api/todos'])
  })

  test('an identical-looking key and route stay separate seeds', () => {
    const { session } = setup()
    session.apply(keyTarget(['/api/todos']), 'key')
    session.apply(routeTarget('GET', '/api/todos'), 'route')
    expect(session.seedCount).toBe(2)
  })

  test('listTargets merges both adapters', async () => {
    const { client, session } = setup()
    await client.fetchQuery({ queryKey: ['todos'], queryFn: async () => [] })
    session.apply(routeTarget('GET', '/api/todos'), [])

    const adapters = session.listTargets().map((target) => target.adapter)
    expect(adapters).toContain('react-query')
    expect(adapters).toContain('http')
  })

  test('clearAll withdraws across both and counts them', async () => {
    const { session, networkCalls } = setup()
    session.apply(keyTarget(['todos']), 1)
    session.apply(routeTarget('GET', '/api/todos'), 2)

    expect(session.clearAll()).toBe(2)
    expect(session.seedCount).toBe(0)

    await fetch('https://x.com/api/todos')
    expect(networkCalls).toHaveLength(1)
  })

  test('capabilities describe each adapter separately', () => {
    const { session } = setup()
    const { adapters } = session.capabilities
    expect(adapters.find((a) => a.id === 'react-query')?.enumerable).toBe(true)
    expect(adapters.find((a) => a.id === 'http')?.enumerable).toBe(false)
  })

  test('an unroutable target reports failure instead of silently vanishing', () => {
    const { session } = setup()
    // No adapter answers to this id, so there is nothing to apply it through.
    expect(
      session.apply({ adapter: 'swr', ref: { kind: 'key', key: ['a'] } }, 1),
    ).toBeNull()
    expect(session.seedCount).toBe(0)
  })

  test('naming an adapter explicitly overrides the search', () => {
    const { session } = setup()
    const applied = session.apply(
      { adapter: 'react-query', ref: { kind: 'key', key: ['todos'] } },
      1,
    )
    expect(applied?.id).toBe('react-query:["todos"]')
  })
})

describe('seed lifetime', () => {
  test('seeds survive an adapter unregistering, so Fast Refresh does not drop them', () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch
    const session = new Session()

    const dispose = installHttpAdapter(session)
    session.apply(routeTarget('GET', '/api/todos'), [1])
    dispose()
    expect(session.seedCount).toBe(1)

    // Re-installing is what a remount does; the seed must still be live.
    const again = installHttpAdapter(session)
    expect(session.listTargets()[0].seeded).toBe(true)

    again()
    globalThis.fetch = originalFetch
  })
})
