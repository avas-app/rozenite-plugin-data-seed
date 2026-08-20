import { describe, expect, test } from 'bun:test'

import { SCHEMAS_VERSION, parseSchemasFile, serializeSchemaEntry } from '../schema'

describe('parseSchemasFile', () => {
  test('accepts a well-formed file', () => {
    const file = parseSchemasFile({
      version: SCHEMAS_VERSION,
      generatedAt: 'now',
      entries: [],
    })
    expect(file.entries).toEqual([])
  })

  test('reads both pattern forms', () => {
    const { entries } = parseSchemasFile({
      version: SCHEMAS_VERSION,
      entries: [
        { pattern: ['user', '*'], type: 'User', schema: {} },
        { pattern: 'GET /api/users/*', type: 'User', schema: {} },
      ],
    })
    expect(entries[0].pattern).toEqual({ kind: 'key', key: ['user', '*'] })
    expect(entries[1].pattern).toEqual({
      kind: 'route',
      method: 'GET',
      glob: '/api/users/*',
    })
  })

  test('a v1 file still reads, since its array patterns are unchanged', () => {
    const { entries } = parseSchemasFile({
      version: 1,
      entries: [{ pattern: ['todos'], type: 'Todo[]', schema: {} }],
    })
    expect(entries[0].pattern).toEqual({ kind: 'key', key: ['todos'] })
  })

  test('names the offending entry rather than failing anonymously', () => {
    expect(() =>
      parseSchemasFile({ entries: [{ pattern: ['ok'] }, { pattern: 7 }] }),
    ).toThrow(/entry 1/)
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

  test('round-trips a pattern back to its authored form', () => {
    const { entries } = parseSchemasFile({
      entries: [
        { pattern: ['todos'], type: 'T', schema: {} },
        { pattern: 'GET /api/todos', type: 'T', schema: {} },
      ],
    })
    expect(serializeSchemaEntry(entries[0]).pattern).toEqual(['todos'])
    expect(serializeSchemaEntry(entries[1]).pattern).toBe('GET /api/todos')
  })
})
