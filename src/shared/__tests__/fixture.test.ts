import { describe, expect, test } from 'bun:test'

import {
  FIXTURE_VERSION,
  FixtureParseError,
  createFixture,
  isFixtureFile,
  parseFixture,
  sameTarget,
  serializeFixture,
  toFileName,
} from '../fixture'
import { keyTarget, routeTarget } from '../target'

describe('toFileName', () => {
  test('slugs a display name', () => {
    expect(toFileName('Cart with 50 items')).toBe('cart-with-50-items.json')
  })

  test('strips punctuation that would not survive a git checkout', () => {
    expect(toFileName('user/7 — "empty" state!')).toBe('user-7-empty-state.json')
  })

  test('falls back rather than producing a dotfile', () => {
    expect(toFileName('!!!')).toBe('fixture.json')
    expect(toFileName('   ')).toBe('fixture.json')
  })

  test('caps length so the path stays portable', () => {
    expect(toFileName('a'.repeat(200)).length).toBeLessThanOrEqual(69)
  })
})

describe('round trip', () => {
  test('serialize then parse preserves the fixture', () => {
    const fixture = createFixture(
      'cart',
      keyTarget(['cart', { userId: 7 }]).ref,
      { items: [1, 2, 3], total: null },
      '2026-08-19T10:00:00.000Z',
    )
    const parsed = parseFixture('cart.json', serializeFixture(fixture))
    expect(parsed).toEqual(fixture)
  })

  test('serialized output is diff-friendly', () => {
    const text = serializeFixture(createFixture('a', keyTarget(['a']).ref, { b: 1 }, 'ts'))
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "name": "a"')
  })
})

describe('parseFixture', () => {
  test('names the file in every error', () => {
    expect(() => parseFixture('broken.json', '{oops')).toThrow(/^broken\.json:/)
    expect(() => parseFixture('a.json', '[]')).toThrow(/expected a JSON object/)
    expect(() => parseFixture('a.json', '{"data":1}')).toThrow(/missing target/)
    expect(() => parseFixture('a.json', '{"target":[]}')).toThrow(/missing data/)
    expect(() => parseFixture('a.json', '{"target":{"kind":"route"},"data":1}')).toThrow(
      /route target needs a url/,
    )
  })

  test('errors are typed so the UI can distinguish them', () => {
    expect(() => parseFixture('a.json', 'nope')).toThrow(FixtureParseError)
  })

  test('refuses a file from a newer plugin instead of silently misreading it', () => {
    const text = JSON.stringify({
      version: FIXTURE_VERSION + 1,
      target: ['a'],
      data: {},
    })
    expect(() => parseFixture('a.json', text)).toThrow(/newer plugin/)
  })

  test('accepts a hand-written fixture with only the essentials', () => {
    const parsed = parseFixture('todos.json', '{"target":["todos"],"data":[]}')
    expect(parsed.name).toBe('todos')
    expect(parsed.version).toBe(FIXTURE_VERSION)
    expect(parsed.data).toEqual([])
  })

  test('keeps a null data value rather than treating it as missing', () => {
    const parsed = parseFixture('a.json', '{"target":["a"],"data":null}')
    expect(parsed.data).toBeNull()
  })

  test('a v1 fixture still reads, so committed files need no migration', () => {
    const parsed = parseFixture('a.json', '{"version":1,"queryKey":["a"],"data":[]}')
    expect(parsed.target).toEqual({ kind: 'key', key: ['a'] })
  })

  test('reads a route fixture', () => {
    const parsed = parseFixture(
      'a.json',
      '{"target":{"kind":"route","method":"get","url":"/api/a"},"data":[],"meta":{"status":500}}',
    )
    expect(parsed.target).toEqual({ kind: 'route', method: 'GET', url: '/api/a' })
    expect(parsed.meta).toEqual({ status: 500 })
  })
})

describe('sameTarget', () => {
  test('matches structurally', () => {
    const a = keyTarget(['user', 7]).ref
    expect(sameTarget(a, keyTarget(['user', 7]).ref)).toBe(true)
    expect(sameTarget(a, keyTarget(['user', 8]).ref)).toBe(false)
  })

  test('a route and a key are never the same target', () => {
    expect(
      sameTarget(keyTarget(['/api/a']).ref, routeTarget('GET', '/api/a').ref),
    ).toBe(false)
  })
})

describe('isFixtureFile', () => {
  test('only .json counts', () => {
    expect(isFixtureFile('a.json')).toBe(true)
    expect(isFixtureFile('a.txt')).toBe(false)
  })
})
