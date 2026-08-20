import { describe, expect, test } from 'bun:test'

import type { FixtureContext } from '../fixtures'
import { loadFixtures } from '../fixtures'

/** Builds a stand-in for Metro's `require.context`. */
function context(modules: Record<string, unknown>): FixtureContext {
  const fn = ((id: string) => {
    if (!(id in modules)) throw new Error(`Cannot find module '${id}'`)
    return modules[id]
  }) as FixtureContext
  fn.keys = () => Object.keys(modules)
  return fn
}

const CART = {
  version: 1,
  name: 'cart with 50 items',
  target: ['cart', { userId: 7 }],
  savedAt: '2026-08-19T10:00:00.000Z',
  data: { items: [1, 2, 3] },
}

describe('loadFixtures', () => {
  test('reads a require.context', () => {
    const { summaries, problems } = loadFixtures(context({ './cart.json': CART }))
    expect(problems).toEqual([])
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      id: './cart.json',
      name: 'cart with 50 items',
      target: { kind: 'key', key: ['cart', { userId: 7 }] },
      label: '["cart",{"userId":7}]',
    })
    expect(summaries[0].byteLength).toBeGreaterThan(0)
  })

  test('unwraps an ES module interop default', () => {
    const { summaries } = loadFixtures(context({ './cart.json': { default: CART } }))
    expect(summaries[0].name).toBe('cart with 50 items')
  })

  test('accepts a plain map for apps that list fixtures by hand', () => {
    const { summaries } = loadFixtures({ 'cart.json': CART })
    expect(summaries[0].id).toBe('cart.json')
  })

  test('keeps full values addressable by id, not in the summary', () => {
    const { summaries, byId } = loadFixtures(context({ './cart.json': CART }))
    expect(summaries[0]).not.toHaveProperty('data')
    expect(byId.get('./cart.json')?.data).toEqual({ items: [1, 2, 3] })
  })

  test('reports a malformed fixture instead of hiding it', () => {
    const { summaries, problems } = loadFixtures(
      context({ './ok.json': CART, './bad.json': { data: 1 } }),
    )
    expect(summaries).toHaveLength(1)
    expect(problems).toHaveLength(1)
    expect(problems[0].id).toBe('./bad.json')
    expect(problems[0].reason).toMatch(/missing target/)
  })

  test('one broken module does not lose the rest', () => {
    const broken = context({ './ok.json': CART, './boom.json': CART })
    const guarded: FixtureContext = Object.assign(
      (id: string) => {
        if (id === './boom.json') throw new Error('unresolved module')
        return broken(id)
      },
      { keys: broken.keys },
    )
    const { summaries, problems } = loadFixtures(guarded)
    expect(summaries).toHaveLength(1)
    expect(problems[0].reason).toMatch(/unresolved module/)
  })

  test('sorts by name so the list is stable across reloads', () => {
    const { summaries } = loadFixtures(
      context({
        './b.json': { ...CART, name: 'zebra' },
        './a.json': { ...CART, name: 'apple' },
      }),
    )
    expect(summaries.map((f) => f.name)).toEqual(['apple', 'zebra'])
  })

  test('no source is not an error', () => {
    const { summaries, problems } = loadFixtures(undefined)
    expect(summaries).toEqual([])
    expect(problems).toEqual([])
  })
})
