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

  test('keeps the good entries and names the bad one', () => {
    const { entries, problems } = parseSchemasFile({
      entries: [
        { pattern: ['ok'], type: 'Ok', schema: { type: 'string' } },
        { pattern: 7, type: 'Bad', schema: {} },
        { pattern: ['no-schema'], type: 'Bad' },
        null,
      ],
    })
    // One bad pattern in a file must not cost you every other schema in it.
    expect(entries).toHaveLength(1)
    expect(entries[0].pattern).toEqual({ kind: 'key', key: ['ok'] })
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/entry 1/)
    expect(problems[1]).toMatch(/entry 2.*no schema/)
    expect(problems[2]).toMatch(/entry 3.*object/)
  })

  test('an entry with no schema is dropped, because generation reads it directly', () => {
    const { entries, problems } = parseSchemasFile({
      entries: [{ pattern: ['x'], type: 'X', schema: 'not an object' }],
    })
    expect(entries).toEqual([])
    expect(problems[0]).toMatch(/no schema object/)
  })

  test('a well-formed file reports no problems', () => {
    const { problems } = parseSchemasFile({
      entries: [{ pattern: ['todos'], type: 'T', schema: { type: 'object' } }],
    })
    expect(problems).toEqual([])
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
