import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import type { QueryClientLike } from '../adapters/react-query'
import { installReactQueryAdapter } from '../adapters/react-query'
import { keyTarget } from '../../shared/target'
import { Session } from '../session'

/**
 * These run against the real `@tanstack/react-query` (a devDependency — the
 * shipped package still has no dependency on it).
 *
 * That matters more here than usual: the plugin's central claim is that a seed
 * beats the `queryFn` a component passes inline, and that claim is about
 * TanStack's own option-merge order. A hand-rolled fake client would happily
 * confirm whatever this file assumed, which is exactly the bug worth catching.
 */

type Source = { source: string }

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const session = new Session()
  const dispose = installReactQueryAdapter(
    client as unknown as QueryClientLike,
    session,
  )
  return { client, session, dispose }
}

describe('react query seed interception', () => {
  test('a seed beats the queryFn the caller passes inline', async () => {
    const { client, session, dispose } = setup()
    let realCalls = 0
    const realFn = async () => {
      realCalls++
      return { source: 'network' }
    }

    session.apply(keyTarget(['todos']), { source: 'seed' })

    const result = await client.fetchQuery({ queryKey: ['todos'], queryFn: realFn })

    expect(result).toEqual({ source: 'seed' })
    expect(realCalls).toBe(0)
    dispose()
  })

  test('the seed survives an explicit refetch', async () => {
    const { client, session, dispose } = setup()
    const realFn = async () => ({ source: 'network' })

    await client.fetchQuery({ queryKey: ['todos'], queryFn: realFn })
    session.apply(keyTarget(['todos']), { source: 'seed' })

    await client.refetchQueries({ queryKey: ['todos'], exact: true })

    expect(client.getQueryData<Source>(['todos'])).toEqual({ source: 'seed' })
    dispose()
  })

  test('clearing a seed lets real data back in', async () => {
    const { client, session, dispose } = setup()
    const realFn = async () => ({ source: 'network' })

    session.apply(keyTarget(['todos']), { source: 'seed' })
    await client.fetchQuery({ queryKey: ['todos'], queryFn: realFn })
    expect(client.getQueryData<Source>(['todos'])).toEqual({ source: 'seed' })

    const [{ id }] = session.seedList()
    session.clear(id)
    await client.fetchQuery({ queryKey: ['todos'], queryFn: realFn })

    expect(client.getQueryData<Source>(['todos'])).toEqual({ source: 'network' })
    dispose()
  })

  test('seeding a key that is not in the cache yet creates it', async () => {
    const { client, session, dispose } = setup()

    session.apply(keyTarget(['user', 7]), { name: 'Seeded' })

    expect(client.getQueryData<{ name: string }>(['user', 7])).toEqual({ name: 'Seeded' })
    dispose()
  })

  test('a seed is scoped to its exact key, not the key prefix', async () => {
    const { client, session, dispose } = setup()
    const realFn = async () => ({ source: 'network' })

    session.apply(keyTarget(['todos']), { source: 'seed' })
    const detail = await client.fetchQuery({
      queryKey: ['todos', 'detail', 1],
      queryFn: realFn,
    })

    // `setQueryDefaults` would have matched this by prefix. Hash-keyed seeds
    // deliberately do not — seeding a list must not hijack its detail routes.
    expect(detail).toEqual({ source: 'network' })
    dispose()
  })

  test('mutating what the app received does not corrupt the seed', async () => {
    const { client, session, dispose } = setup()
    const realFn = async () => ({ items: [] as string[] })

    session.apply(keyTarget(['todos']), { items: ['a'] })

    const first = (await client.fetchQuery({
      queryKey: ['todos'],
      queryFn: realFn,
    })) as { items: string[] }
    first.items.push('mutated')

    await client.refetchQueries({ queryKey: ['todos'], exact: true })

    expect(client.getQueryData<{ items: string[] }>(['todos'])).toEqual({ items: ['a'] })
    dispose()
  })

  test('dispose restores the original defaultQueryOptions', async () => {
    const { client, session, dispose } = setup()
    const realFn = async () => ({ source: 'network' })

    session.apply(keyTarget(['todos']), { source: 'seed' })
    dispose()

    const result = await client.fetchQuery({ queryKey: ['todos'], queryFn: realFn })
    expect(result).toEqual({ source: 'network' })
  })

  test('reports that interception is available', () => {
    const { session, dispose } = setup()
    expect(session.adapters[0]?.intercept).toBe(true)
    dispose()
  })
})

describe('snapshots', () => {
  test('lists cached queries with previews and seed state', async () => {
    const { client, session, dispose } = setup()

    await client.fetchQuery({
      queryKey: ['todos'],
      queryFn: async () => [{ id: 1, title: 'One' }],
    })
    session.apply(keyTarget(['user', 7]), { name: 'Seeded' })

    const { targets, seeds } = session.snapshot()
    const todos = targets.find((t) => t.label === JSON.stringify(['todos']))

    expect(todos?.status).toBe('success')
    expect(todos?.seeded).toBe(false)
    expect(todos?.preview?.kind).toBe('json')
    expect(seeds).toHaveLength(1)
    expect(seeds[0].ref).toEqual({ kind: 'key', key: ['user', 7] })
    dispose()
  })

  test('clearAll withdraws every seed', () => {
    const { session, dispose } = setup()

    session.apply(keyTarget(['a']), 1)
    session.apply(keyTarget(['b']), 2)
    expect(session.seedCount).toBe(2)

    session.clearAll()
    expect(session.seedCount).toBe(0)
    dispose()
  })
})
