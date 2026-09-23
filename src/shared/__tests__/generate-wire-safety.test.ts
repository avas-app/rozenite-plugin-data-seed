import { describe, expect, test } from 'bun:test'

import { TOKENS, generate, sampleToken } from '../generate'
import type { SchemaDocument } from '../schema'

/**
 * Generated data has to survive the trip out of here, and the failures are
 * silent ones.
 *
 * A seed does not stop at the panel. It crosses the Rozenite bridge, which
 * structured-clones everything, and it is serialized into the event stream by
 * whatever plugin is carrying it. Three values break that quietly rather than
 * loudly:
 *
 * - `undefined` — `JSON.stringify` drops the key outright, so the field simply
 *   is not there on the other side. Nothing warns.
 * - `NaN` and `Infinity` — both serialize to `null`, so a number field arrives
 *   empty. Nothing warns about that either.
 *
 * Worse, a consumer's app listener sees the raw value while its event stream
 * sees the serialized copy, so for `NaN` the two disagree about what was sent
 * and which one a test reads decides what it concludes.
 *
 * `num()` already refuses a non-finite argument and an unknown token falls
 * through to type-based generation rather than returning nothing, so this
 * holds today. It holds by construction in two separate places, though, and
 * neither says out loud that something downstream depends on it — which is
 * what this file is for.
 */

/** Every leaf in a generated value, with the path that reached it. */
function leaves(value: unknown, path = '$'): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leaves(item, `${path}[${index}]`))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}.${key}`))
  }
  return [[path, value]]
}

function check(value: unknown, label: string) {
  const found = leaves(value)

  // 1. Nothing is `undefined` — the failure that removes a field silently.
  expect(
    found.filter(([, leaf]) => leaf === undefined).map(([at]) => at),
  ).toEqual([])

  // 2. Every number is finite — NaN and Infinity both serialize to null.
  expect(
    found
      .filter(([, leaf]) => typeof leaf === 'number' && !Number.isFinite(leaf))
      .map(([at]) => at),
  ).toEqual([])

  // 3. Subsumes both of the above, and catches a value type nobody has
  //    thought of yet: a JSON round trip has to be lossless.
  expect(JSON.parse(JSON.stringify({ [label]: value }))).toEqual({ [label]: value })

  // 4. The bridge constraint, and independent of the above — structuredClone
  //    and JSON disagree about several types, so neither implies the other.
  expect(() => structuredClone(value)).not.toThrow()
}

describe('every token produces a wire-safe value', () => {
  for (const entry of TOKENS) {
    test(entry.token, () => {
      check(sampleToken(entry.token), 'token')
    })
  }
})

describe('generated documents are wire-safe', () => {
  const run = (schema: SchemaDocument, label: string) => {
    // Several seeds, because a union branch or an array length that only one
    // seed reaches is exactly where an unchecked value would hide.
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      check(generate(schema, { seed }).value, label)
    }
  }

  test('a document using most of the schema vocabulary', () => {
    run(
      {
        $ref: '#/definitions/Root',
        definitions: {
          Root: {
            type: 'object',
            properties: {
              id: { type: 'string', fake: 'string.uuid' },
              when: { type: 'string', fake: 'date.recent' },
              count: { type: 'number', fake: 'number.int({min: 1, max: 9})' },
              ratio: { type: 'number', fake: 'number.float' },
              ok: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              state: { enum: ['on', 'off'] },
              pinned: { const: 7 },
              email: { type: 'string', format: 'email' },
              either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              bag: { additionalProperties: { type: 'string' } },
              child: { $ref: '#/definitions/Root' },
            },
            required: ['id', 'when', 'count', 'ratio', 'ok', 'tags', 'state'],
          },
        },
      },
      'vocabulary',
    )
  })

  test('an unknown token falls back to the type instead of producing nothing', () => {
    // `fromToken` returns undefined for a token it does not know, and the
    // caller warns and carries on to the type. Returning that undefined
    // straight out would be the silent-field-loss bug.
    const result = generate(
      {
        type: 'object',
        properties: { name: { type: 'string', fake: 'name.fullName' } },
        required: ['name'],
      },
      { seed: 'x' },
    )
    expect(result.warnings[0]?.reason).toMatch(/unknown @fake token/)
    expect(typeof result.value).toBe('object')
    expect((result.value as { name: unknown }).name).toBeTypeOf('string')
    check(result.value, 'unknown-token')
  })

  test('hostile numeric arguments cannot reach the output', () => {
    // `1e400` parses as Infinity and `null` is not a number; both would land
    // in the payload as `null` after serialization if they were used. `num()`
    // rejects anything non-finite and falls back to its default.
    const result = generate(
      {
        type: 'object',
        properties: {
          huge: { type: 'number', fake: 'number.int({min: 1e400, max: 1e400})' },
          nulled: { type: 'number', fake: 'number.int({min: null, max: null})' },
          backwards: { type: 'number', fake: 'number.int({min: 10, max: 1})' },
        },
        required: ['huge', 'nulled', 'backwards'],
      },
      { seed: 'y' },
    )
    check(result.value, 'hostile-args')
  })

  test('an `any` field is null, which is a value, not a missing key', () => {
    // null survives JSON and structuredClone; undefined would not. The
    // distinction is the whole point.
    const result = generate(
      { type: 'object', properties: { meta: {} }, required: ['meta'] },
      { seed: 'z' },
    )
    expect(result.value).toEqual({ meta: null })
    expect(Object.keys(result.value as object)).toEqual(['meta'])
    check(result.value, 'any-field')
  })

  test('a recursive type terminates with a value rather than a hole', () => {
    const result = generate(
      {
        $ref: '#/definitions/Node',
        definitions: {
          Node: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              next: { $ref: '#/definitions/Node' },
            },
            required: ['label', 'next'],
          },
        },
      },
      { seed: 'deep' },
    )
    check(result.value, 'recursive')
  })
})
