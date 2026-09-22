import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import {
  generate,
  parseSchemasFile,
  sampleToken,
  seedTools,
} from '../../../sdk'

/**
 * The `./sdk` entry, which is imported from Node rather than from the app.
 *
 * Two things are worth testing here and nowhere else: that the entry stays
 * loadable outside a React Native bundle, and that the pieces a host-side
 * caller needs actually work through it. The first is the fragile one — it
 * holds today because every module this entry reaches lives in `src/shared`,
 * and one convenience import from `src/sdk/` would end it silently. Nothing
 * would fail here; it would fail in someone else's Node process.
 */

const ROOT = path.resolve(import.meta.dir, '../../..')

/**
 * Comments removed, so the example imports in a docstring are not read as
 * real ones — `sdk.ts` documents itself with the very specifier a consumer
 * types, and counting that would make the graph include this package.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

/** Every module the entry reaches, following relative imports only. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>()
  const external: string[] = []
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    const source = stripComments(fs.readFileSync(file, 'utf8'))
    for (const match of source.matchAll(/from '([^']+)'/g)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) {
        external.push(specifier)
        continue
      }
      const base = path.resolve(path.dirname(file), specifier)
      const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
        (candidate) => {
          try {
            return fs.statSync(candidate).isFile()
          } catch {
            return false
          }
        },
      )
      if (resolved === undefined) throw new Error(`unresolved import: ${specifier}`)
      queue.push(resolved)
    }
  }

  return [...seen, ...external]
}

describe('the Node entry stays a Node entry', () => {
  const graph = importGraph(path.join(ROOT, 'sdk.ts'))
  const files = graph.filter((entry) => entry.startsWith(ROOT))
  const external = graph.filter((entry) => !entry.startsWith(ROOT))

  test('reaches nothing under src/sdk or src/panel', () => {
    // Those trees are the app and the browser panel. Either one dragged in
    // here makes `import '@avasapp/rozenite-plugin-data-seed/sdk'` throw in a
    // plain Node process, which is the only place this entry is used.
    const offenders = files
      .map((file) => path.relative(ROOT, file))
      .filter((file) => file.startsWith('src/sdk/') || file.startsWith('src/panel/'))
    expect(offenders).toEqual([])
  })

  test('imports no React or React Native package', () => {
    const banned = /^(react|react-dom|react-native|react-native-web)(\/|$)/
    expect(external.filter((specifier) => banned.test(specifier))).toEqual([])
  })

  test('the only third party it reaches is the agent bridge it declares', () => {
    // Anything new showing up here is a peer dependency a Node consumer now
    // has to install, so it should be a deliberate edit rather than a surprise.
    expect([...new Set(external)].sort()).toEqual(['@rozenite/agent-shared'])
  })
})

describe('what a host-side caller gets', () => {
  const file = {
    version: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    entries: [
      {
        pattern: { name: 'RealtimePayload' },
        type: 'RealtimePayload<PresenceEvent>',
        schema: {
          $ref: '#/definitions/Payload',
          definitions: {
            Payload: {
              type: 'object',
              properties: {
                channel: { type: 'string' },
                seq: { type: 'number' },
                data: { $ref: '#/definitions/Presence' },
              },
              required: ['channel', 'seq', 'data'],
            },
            Presence: {
              type: 'object',
              properties: {
                userId: { type: 'string', fake: 'string.uuid' },
                state: { enum: ['online', 'away'] },
              },
              required: ['userId', 'state'],
            },
          },
        },
      },
      { pattern: ['todos'], type: 'Todo[]', schema: { type: 'array', items: { type: 'string' } } },
    ],
  }

  test('reads a schemas file and generates the entry this plugin cannot seed', () => {
    const parsed = parseSchemasFile(file)
    expect(parsed.problems).toEqual([])

    const entry = parsed.entries.find(
      (candidate) => candidate.pattern.kind === 'type',
    )
    expect(entry?.pattern).toEqual({ kind: 'type', name: 'RealtimePayload' })

    const result = generate(entry!.schema, { seed: 'fixed' })
    expect(result.warnings).toEqual([])
    const value = result.value as { data: { state: string } }
    expect(Object.keys(value).sort()).toEqual(['channel', 'data', 'seq'])
    expect(['online', 'away']).toContain(value.data.state)
  })

  test('generation is seeded, so a caller can reproduce a payload', () => {
    const [entry] = parseSchemasFile(file).entries
    expect(generate(entry.schema, { seed: 'a' }).value).toEqual(
      generate(entry.schema, { seed: 'a' }).value,
    )
    expect(generate(entry.schema, { seed: 'a' }).value).not.toEqual(
      generate(entry.schema, { seed: 'b' }).value,
    )
  })

  test('the descriptors and the token catalogue still come through', () => {
    // Guards the re-export block as a whole: these were already public, and a
    // botched edit to it would take them with it.
    expect(typeof seedTools.applySeed).not.toBe('undefined')
    expect(typeof sampleToken('person.fullName')).toBe('string')
  })
})
