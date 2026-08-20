import { describe, expect, test } from 'bun:test'

import { describeSchema, displayName } from '../describe'
import type { SchemaDocument } from '../schema'

const doc = (schema: SchemaDocument): SchemaDocument => schema

describe('objects and scalars', () => {
  test('renders fields with their types', () => {
    const out = describeSchema(
      doc({
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' } },
        required: ['id', 'name'],
      }),
      'User',
    )
    expect(out).toBe(['type User = {', '  id: number', '  name: string', '}'].join('\n'))
  })

  test('marks fields not in `required` as optional', () => {
    const out = describeSchema(
      doc({
        type: 'object',
        properties: { id: { type: 'number' }, nickname: { type: 'string' } },
        required: ['id'],
      }),
      'User',
    )
    expect(out).toContain('id: number')
    expect(out).toContain('nickname?: string')
  })

  test('renders enums and literals as unions', () => {
    const out = describeSchema(
      doc({
        type: 'object',
        properties: {
          theme: { type: 'string', enum: ['light', 'dark'] },
          kind: { const: 'user' },
        },
      }),
      'X',
    )
    expect(out).toContain("theme?: 'light' | 'dark'")
    expect(out).toContain("kind?: 'user'")
  })

  test('an empty object is not rendered as a blank block', () => {
    expect(describeSchema(doc({ type: 'object' }), 'X')).toBe('type X = {}')
  })
})

describe('the things worth seeing at a glance', () => {
  test('a @faker annotation rides along as a comment', () => {
    const out = describeSchema(
      doc({
        type: 'object',
        properties: { name: { type: 'string', faker: 'person.fullName' } },
      }),
      'User',
    )
    expect(out).toContain('name?: string  // @faker person.fullName')
  })

  test('an untyped field reads as `any` — those are the ones generation nulls', () => {
    const out = describeSchema(
      doc({ type: 'object', properties: { flags: { description: 'untyped' } } }),
      'Settings',
    )
    expect(out).toContain('flags?: any')
  })
})

describe('references', () => {
  const shared = doc({
    type: 'object',
    properties: {
      a: { $ref: '#/definitions/Thing' },
      b: { $ref: '#/definitions/Thing' },
    },
    definitions: {
      Thing: { type: 'object', properties: { id: { type: 'number' } } },
    },
  })

  test('a definition used once is inlined, hiding synthetic names', () => {
    const out = describeSchema(
      doc({
        type: 'object',
        properties: { only: { $ref: '#/definitions/Thing' } },
        definitions: {
          Thing: { type: 'object', properties: { id: { type: 'number' } } },
        },
      }),
      'Root',
    )
    expect(out).toContain('id?: number')
    expect(out).not.toContain('type Thing')
  })

  test('a shared definition is named once and referenced', () => {
    const out = describeSchema(shared, 'Root')
    expect(out).toContain('a?: Thing')
    expect(out).toContain('b?: Thing')
    expect(out).toContain('type Thing = {')
  })

  test('a recursive type terminates by name rather than expanding', () => {
    const out = describeSchema(
      doc({
        $ref: '#/definitions/Comment',
        definitions: {
          Comment: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              replies: { type: 'array', items: { $ref: '#/definitions/Comment' } },
            },
          },
        },
      }),
      'Thread',
    )
    expect(out).toContain('replies?: Comment[]')
    expect(out.match(/type Comment =/g)).toHaveLength(1)
  })

  test('URI-encoded refs resolve', () => {
    const out = describeSchema(
      doc({
        $ref: '#/definitions/Api%3CUser%3E',
        definitions: {
          'Api<User>': { type: 'object', properties: { ok: { const: true } } },
        },
      }),
      'Root',
    )
    expect(out).toContain('ok?: true')
  })
})

describe('unions', () => {
  const union = doc({
    type: 'object',
    properties: { items: { type: 'array', items: { $ref: '#/definitions/N' } } },
    definitions: {
      N: {
        anyOf: [
          { type: 'object', properties: { kind: { const: 'a' } } },
          { type: 'object', properties: { kind: { const: 'b' } } },
        ],
      },
    },
  })

  test('a union is named rather than inlined into an array', () => {
    const out = describeSchema(union, 'Root')
    // `A | B[]` would bind the [] to B alone; naming avoids the ambiguity.
    expect(out).toContain('items?: N[]')
    expect(out).toContain('type N =')
  })

  test('a stacked union uses leading pipes, as it would in source', () => {
    const out = describeSchema(union, 'Root')
    expect(out).toMatch(/type N =\n\s+\| \{/)
  })

  test('an inline union of scalars stays on one line and parenthesises in arrays', () => {
    const out = describeSchema(
      doc({
        type: 'object',
        properties: {
          tags: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        },
      }),
      'Root',
    )
    expect(out).toContain('tags?: (string | number)[]')
  })
})

describe('displayName', () => {
  test('collapses the generator\'s synthetic alias names', () => {
    expect(displayName('ApiResponse<def-alias-src_api.ts-1361-1509[]>')).toBe(
      'ApiResponse<…[]>',
    )
    expect(displayName('def-alias-src_api.ts-1-2')).toBe('Anonymous')
    expect(displayName('Todo')).toBe('Todo')
  })
})
