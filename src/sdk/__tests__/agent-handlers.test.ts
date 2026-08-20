import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import * as handlers from '../agent-handlers'
import type { QueryClientLike } from '../adapters/react-query'
import { installReactQueryAdapter } from '../adapters/react-query'
import { keyTarget } from '../../shared/target'
import { loadFixtures } from '../fixtures'
import { Session } from '../session'

const CART = {
  version: 2,
  name: 'cart with 50 items',
  target: ['cart'],
  savedAt: '2026-08-19T10:00:00.000Z',
  data: { items: [1, 2, 3] },
}

const SCHEMA = {
  pattern: { kind: 'key' as const, key: ['todos'] },
  type: 'Todo[]',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string', faker: 'lorem.sentence' },
      },
    },
  },
}

function setup({ instrument = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session = new Session()
  const dispose = instrument
    ? installReactQueryAdapter(client as unknown as QueryClientLike, session)
    : () => {}
  session.setFixtures(loadFixtures({ './cart.json': CART }))
  session.setSchemas([SCHEMA])
  return { client, session, dispose }
}

describe('list-targets / read-target', () => {
  test('summarises values instead of returning them', async () => {
    const { client, session, dispose } = setup()
    await client.fetchQuery({
      queryKey: ['todos'],
      queryFn: async () => [{ id: 1 }, { id: 2 }],
    })

    const { items } = handlers.listTargets(session)
    expect(items).toHaveLength(1)
    expect(items[0].summary).toBe('Array(2)')
    expect(items[0].bytes).toBeGreaterThan(0)
    expect(items[0]).not.toHaveProperty('data')
    dispose()
  })

  test('filters and reports truncation', async () => {
    const { client, session, dispose } = setup()
    await client.fetchQuery({ queryKey: ['todos'], queryFn: async () => [] })
    await client.fetchQuery({ queryKey: ['users'], queryFn: async () => [] })

    expect(handlers.listTargets(session, { search: 'todo' }).items).toHaveLength(1)
    expect(handlers.listTargets(session, { limit: 1 }).truncated).toBe(true)
    expect(handlers.listTargets(session, { onlySeeded: true }).items).toHaveLength(0)

    session.apply(keyTarget(['todos']), [])
    expect(handlers.listTargets(session, { onlySeeded: true }).items).toHaveLength(1)
    dispose()
  })

  test('an absent query is a normal answer, not an error', () => {
    const { session, dispose } = setup()
    const result = handlers.readTarget(session, { queryKey: ['nope'] })
    expect(result.found).toBe(false)
    expect(result.seeded).toBe(false)
    dispose()
  })
})

describe('seeding', () => {
  test('apply and clear round-trip by key', async () => {
    const { client, session, dispose } = setup()
    const applied = handlers.applySeed(session, {
      queryKey: ['todos'],
      data: [{ id: 99 }],
    })
    expect(applied.persistent).toBe(true)
    expect(client.getQueryData<unknown[]>(['todos'])).toEqual([{ id: 99 }])

    expect(handlers.clearSeed(session, { queryKey: ['todos'] }).cleared).toBe(true)
    // Clearing something already cleared is not an error.
    expect(handlers.clearSeed(session, { queryKey: ['todos'] }).cleared).toBe(false)
    dispose()
  })

  test('reports persistent: false when the client could not be hooked', () => {
    const { session, dispose } = setup({ instrument: false })
    // No driver at all — the handler should say so rather than throw a TypeError.
    expect(() => handlers.applySeed(session, { queryKey: ['a'], data: 1 })).toThrow(
      /not attached/,
    )
    dispose()
  })

  test('clear-all reports how many it withdrew', () => {
    const { session, dispose } = setup()
    handlers.applySeed(session, { queryKey: ['a'], data: 1 })
    handlers.applySeed(session, { queryKey: ['b'], data: 2 })
    expect(handlers.clearAllSeeds(session).cleared).toBe(2)
    expect(handlers.clearAllSeeds(session).cleared).toBe(0)
    dispose()
  })
})

describe('fixtures', () => {
  test('applies by name or by id', () => {
    const { client, session, dispose } = setup()
    const byName = handlers.applyFixture(session, { fixture: 'cart with 50 items' })
    expect(byName.label).toBe('["cart"]')
    expect(client.getQueryData<{ items: number[] }>(['cart'])).toEqual({
      items: [1, 2, 3],
    })

    expect(handlers.applyFixture(session, { fixture: './cart.json' }).fixture).toBe(
      'cart with 50 items',
    )
    dispose()
  })

  test('an unknown fixture lists what is available', () => {
    const { session, dispose } = setup()
    expect(() => handlers.applyFixture(session, { fixture: 'nope' })).toThrow(
      /Available: cart with 50 items/,
    )
    dispose()
  })

  test('lists fixtures with their problems', () => {
    const { session, dispose } = setup()
    session.setFixtures(loadFixtures({ './cart.json': CART, './bad.json': { data: 1 } }))
    const result = handlers.listFixtures(session)
    expect(result.items).toHaveLength(1)
    expect(result.problems[0].id).toBe('./bad.json')
    dispose()
  })
})

describe('generate-seed', () => {
  test('generates from the schema and applies it', () => {
    const { client, session, dispose } = setup()
    const result = handlers.generateSeed(session, { queryKey: ['todos'], items: 5 })
    expect(result.applied).toBe(true)
    expect(result.type).toBe('Todo[]')
    expect(result.data).toHaveLength(5)
    expect(client.getQueryData<unknown[]>(['todos'])).toHaveLength(5)
    dispose()
  })

  test('dryRun returns the value without touching the cache', () => {
    const { client, session, dispose } = setup()
    const result = handlers.generateSeed(session, {
      queryKey: ['todos'],
      dryRun: true,
    })
    expect(result.applied).toBe(false)
    expect(result.persistent).toBe(false)
    expect(client.getQueryData(['todos'])).toBeUndefined()
    dispose()
  })

  test('the same explicit seed reproduces the same value', () => {
    const { session, dispose } = setup()
    const a = handlers.generateSeed(session, { queryKey: ['todos'], seed: 'k', dryRun: true })
    const b = handlers.generateSeed(session, { queryKey: ['todos'], seed: 'k', dryRun: true })
    expect(a.data).toEqual(b.data)
    dispose()
  })

  test('a target with no schema says how to add one', () => {
    const { session, dispose } = setup()
    expect(() => handlers.generateSeed(session, { queryKey: ['nope'] })).toThrow(
      /data-seed extract/,
    )
    dispose()
  })
})
