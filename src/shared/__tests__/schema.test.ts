import { describe, expect, test } from 'bun:test'

import {
  SCHEMAS_VERSION,
  findByPattern,
  matchesPattern,
  parseSchemasFile,
} from '../schema'

describe('matchesPattern', () => {
  test('matches exactly', () => {
    expect(matchesPattern(['todos'], ['todos'])).toBe(true)
    expect(matchesPattern(['todos'], ['users'])).toBe(false)
  })

  test('* covers a single element', () => {
    expect(matchesPattern(['user', '*'], ['user', 7])).toBe(true)
    expect(matchesPattern(['user', '*'], ['user', 'me'])).toBe(true)
  })

  test('length must match, so a list pattern cannot swallow a detail route', () => {
    expect(matchesPattern(['todos'], ['todos', 'detail', 1])).toBe(false)
    expect(matchesPattern(['user', '*'], ['user'])).toBe(false)
  })

  test('object elements compare structurally', () => {
    expect(matchesPattern([{ a: 1 }], [{ a: 1 }])).toBe(true)
    expect(matchesPattern([{ a: 1 }], [{ a: 2 }])).toBe(false)
  })
})

describe('findByPattern', () => {
  const entries = [
    { pattern: ['user', '*'], type: 'User' },
    { pattern: ['user', 7], type: 'AdminUser' },
    { pattern: ['todos'], type: 'Todos' },
  ]

  test('an exact pattern beats a wildcard regardless of order', () => {
    expect(findByPattern(entries, ['user', 7])?.type).toBe('AdminUser')
    expect(findByPattern([...entries].reverse(), ['user', 7])?.type).toBe('AdminUser')
  })

  test('falls back to the wildcard for other keys', () => {
    expect(findByPattern(entries, ['user', 9])?.type).toBe('User')
  })

  test('returns null when nothing matches', () => {
    expect(findByPattern(entries, ['nope'])).toBeNull()
  })
})

describe('parseSchemasFile', () => {
  test('accepts a well-formed file', () => {
    const file = parseSchemasFile({
      version: SCHEMAS_VERSION,
      generatedAt: 'now',
      entries: [],
    })
    expect(file.entries).toEqual([])
  })

  test('rejects anything without entries', () => {
    expect(() => parseSchemasFile({})).toThrow(/entries array/)
    expect(() => parseSchemasFile(null)).toThrow(/JSON object/)
  })

  test('refuses a file from a newer plugin rather than misreading it', () => {
    expect(() =>
      parseSchemasFile({ version: SCHEMAS_VERSION + 1, entries: [] }),
    ).toThrow(/newer plugin/)
  })
})
