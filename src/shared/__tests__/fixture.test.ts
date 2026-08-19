import { describe, expect, test } from 'bun:test'

import {
  FIXTURE_VERSION,
  FixtureParseError,
  createFixture,
  isFixtureFile,
  parseFixture,
  sameQueryKey,
  serializeFixture,
  toFileName,
} from '../fixture'

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
      ['cart', { userId: 7 }],
      { items: [1, 2, 3], total: null },
      '2026-08-19T10:00:00.000Z',
    )
    const parsed = parseFixture('cart.json', serializeFixture(fixture))
    expect(parsed).toEqual(fixture)
  })

  test('serialized output is diff-friendly', () => {
    const text = serializeFixture(createFixture('a', ['a'], { b: 1 }, 'ts'))
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "name": "a"')
  })
})

describe('parseFixture', () => {
  test('names the file in every error', () => {
    expect(() => parseFixture('broken.json', '{oops')).toThrow(/^broken\.json:/)
    expect(() => parseFixture('a.json', '[]')).toThrow(/expected a JSON object/)
    expect(() => parseFixture('a.json', '{"data":1}')).toThrow(/queryKey must be an array/)
    expect(() => parseFixture('a.json', '{"queryKey":[]}')).toThrow(/missing data/)
  })

  test('errors are typed so the UI can distinguish them', () => {
    expect(() => parseFixture('a.json', 'nope')).toThrow(FixtureParseError)
  })

  test('refuses a file from a newer plugin instead of silently misreading it', () => {
    const text = JSON.stringify({
      version: FIXTURE_VERSION + 1,
      queryKey: ['a'],
      data: {},
    })
    expect(() => parseFixture('a.json', text)).toThrow(/newer plugin/)
  })

  test('accepts a hand-written fixture with only the essentials', () => {
    const parsed = parseFixture('todos.json', '{"queryKey":["todos"],"data":[]}')
    expect(parsed.name).toBe('todos')
    expect(parsed.version).toBe(FIXTURE_VERSION)
    expect(parsed.data).toEqual([])
  })

  test('keeps a null data value rather than treating it as missing', () => {
    const parsed = parseFixture('a.json', '{"queryKey":["a"],"data":null}')
    expect(parsed.data).toBeNull()
  })
})

describe('sameQueryKey', () => {
  test('matches structurally', () => {
    expect(sameQueryKey(['user', 7], ['user', 7])).toBe(true)
    expect(sameQueryKey(['user', 7], ['user', 8])).toBe(false)
    expect(sameQueryKey(['user'], ['user', undefined as unknown])).toBe(false)
  })
})

describe('isFixtureFile', () => {
  test('only .json counts', () => {
    expect(isFixtureFile('a.json')).toBe(true)
    expect(isFixtureFile('a.txt')).toBe(false)
  })
})
