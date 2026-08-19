import { describe, expect, test } from 'bun:test'

import { generate } from '../generate'
import type { SchemaDocument } from '../schema'

const doc = (schema: SchemaDocument): SchemaDocument => schema

describe('determinism', () => {
  test('the same seed always produces the same value', () => {
    const schema = doc({
      type: 'object',
      properties: { name: { type: 'string', faker: 'person.fullName' } },
    })
    const a = generate(schema, { seed: 'abc' }).value
    const b = generate(schema, { seed: 'abc' }).value
    expect(a).toEqual(b)
  })

  test('different seeds produce different values', () => {
    const schema = doc({ type: 'string', faker: 'person.fullName' })
    const values = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((seed) => generate(schema, { seed }).value),
    )
    expect(values.size).toBeGreaterThan(1)
  })

  test('dates do not depend on the current time', () => {
    const schema = doc({ type: 'string', faker: 'date.recent' })
    const first = generate(schema, { seed: 'x' }).value
    expect(generate(schema, { seed: 'x' }).value).toBe(first as string)
    expect(String(first)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('scalars', () => {
  test('numbers are whole by default, since TypeScript cannot say otherwise', () => {
    const value = generate(doc({ type: 'number' }), { seed: 's' }).value
    expect(Number.isInteger(value)).toBe(true)
  })

  test('number.float opts back into decimals', () => {
    const values = Array.from({ length: 12 }, (_, i) =>
      generate(doc({ type: 'number', faker: 'number.float({min: 0, max: 1})' }), {
        seed: `s${i}`,
      }).value as number,
    )
    expect(values.some((v) => !Number.isInteger(v))).toBe(true)
    expect(values.every((v) => v >= 0 && v <= 1)).toBe(true)
  })

  test('number.int honours its bounds', () => {
    for (let i = 0; i < 20; i++) {
      const value = generate(
        doc({ type: 'number', faker: 'number.int({min: 5, max: 9})' }),
        { seed: `s${i}` },
      ).value as number
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThanOrEqual(9)
    }
  })

  test('enum and const are respected', () => {
    expect(generate(doc({ enum: ['a'] }), { seed: 's' }).value).toBe('a')
    expect(generate(doc({ const: 42 }), { seed: 's' }).value).toBe(42)
  })

  test('string formats are honoured without an annotation', () => {
    const email = generate(doc({ type: 'string', format: 'email' }), { seed: 's' })
    expect(String(email.value)).toContain('@')
    const uuid = generate(doc({ type: 'string', format: 'uuid' }), { seed: 's' })
    expect(String(uuid.value)).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('structures', () => {
  test('arrays use the requested length', () => {
    const schema = doc({ type: 'array', items: { type: 'number' } })
    expect(generate(schema, { seed: 's', arrayLength: 7 }).value).toHaveLength(7)
    expect(generate(schema, { seed: 's', arrayLength: 0 }).value).toHaveLength(0)
  })

  test('minItems wins over a smaller requested length', () => {
    const schema = doc({ type: 'array', items: { type: 'number' }, minItems: 4 })
    expect(generate(schema, { seed: 's', arrayLength: 1 }).value).toHaveLength(4)
  })

  test('optional properties are still generated', () => {
    const schema = doc({
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a'],
    })
    expect(Object.keys(generate(schema, { seed: 's' }).value as object)).toEqual(['a', 'b'])
  })

  test('a chosen variant is used for a discriminated union', () => {
    const schema = doc({
      anyOf: [
        { type: 'object', properties: { kind: { const: 'a' } } },
        { type: 'object', properties: { kind: { const: 'b' } } },
      ],
    })
    expect(generate(schema, { seed: 's', variant: 1 }).value).toEqual({ kind: 'b' })
    expect(generate(schema, { seed: 's', variant: 0 }).value).toEqual({ kind: 'a' })
  })

  test('an out-of-range variant clamps rather than throwing', () => {
    const schema = doc({ anyOf: [{ const: 'a' }, { const: 'b' }] })
    expect(generate(schema, { seed: 's', variant: 99 }).value).toBe('b')
  })

  test('allOf merges its branches', () => {
    const schema = doc({
      allOf: [
        { type: 'object', properties: { a: { const: 1 } } },
        { type: 'object', properties: { b: { const: 2 } } },
      ],
    })
    expect(generate(schema, { seed: 's' }).value).toEqual({ a: 1, b: 2 })
  })
})

describe('recursion', () => {
  test('a self-referential type terminates at the depth cap', () => {
    const schema = doc({
      $ref: '#/definitions/Node',
      definitions: {
        Node: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            children: { type: 'array', items: { $ref: '#/definitions/Node' } },
          },
        },
      },
    })
    const nesting = (maxDepth: number) => {
      const { value } = generate(schema, { seed: 's', maxDepth, arrayLength: 1 })
      let depth = 0
      let node = value as { children?: unknown[] } | null
      while (node && Array.isArray(node.children) && node.children.length > 0) {
        depth++
        node = node.children[0] as { children?: unknown[] }
        // Guards the test itself against an infinite structure.
        expect(depth).toBeLessThan(50)
      }
      return depth
    }

    // Bounded, and bounded *by the option* rather than by luck.
    expect(nesting(3)).toBe(3)
    expect(nesting(1)).toBe(1)
    expect(nesting(6)).toBe(6)
  })

  test('URI-encoded refs resolve — the generator emits them for generics', () => {
    const schema = doc({
      $ref: '#/definitions/ApiResponse%3CUser%3E',
      definitions: {
        'ApiResponse<User>': { type: 'object', properties: { ok: { const: true } } },
      },
    })
    expect(generate(schema, { seed: 's' }).value).toEqual({ ok: true })
  })
})

describe('warnings', () => {
  test('an `any` field is reported rather than invented', () => {
    const schema = doc({
      type: 'object',
      properties: { flags: { description: 'untyped' } },
    })
    const { value, warnings } = generate(schema, { seed: 's' })
    expect(value).toEqual({ flags: null })
    expect(warnings[0].path).toBe('$.flags')
    expect(warnings[0].reason).toMatch(/any/)
  })

  test('an unknown @faker token warns and falls back', () => {
    const { warnings } = generate(
      doc({ type: 'string', faker: 'nope.notAThing' }),
      { seed: 's' },
    )
    expect(warnings[0].reason).toMatch(/unknown @faker token/)
  })

  test('a misspelt token suggests the real one', () => {
    const wrongNamespace = generate(
      doc({ type: 'string', faker: 'name.fullName' }),
      { seed: 's' },
    )
    expect(wrongNamespace.warnings[0].reason).toMatch(/person\.fullName/)

    const wrongMethod = generate(
      doc({ type: 'string', faker: 'person.nope' }),
      { seed: 's' },
    )
    expect(wrongMethod.warnings[0].reason).toMatch(/person\.firstName/)
  })

  test('an unresolved $ref warns instead of throwing', () => {
    const { value, warnings } = generate(doc({ $ref: '#/definitions/Missing' }), {
      seed: 's',
    })
    expect(value).toBeNull()
    expect(warnings[0].reason).toMatch(/unresolved/)
  })
})
