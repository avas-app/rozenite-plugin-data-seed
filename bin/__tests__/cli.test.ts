import { afterAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  duplicateWarnings,
  extractIdentifiers,
  hollowReason,
  classifySource,
  makeGeneratorFactory,
  parseArgs,
  routePatternWarnings,
  toImportPath,
  unwrapAlias,
  validateTargets,
} from '../data-seed.mjs'
import { SCHEMAS_VERSION } from '../../src/shared/schema'
import {
  matchesTarget,
  parseTargetPattern,
  routeTarget,
} from '../../src/shared/target'

const CLI = path.resolve(import.meta.dir, '../data-seed.mjs')

/**
 * Each of these spawns the CLI, which builds a whole TypeScript program — twice
 * over for the run-it-again cases. Bun's 5s default is enough on an idle
 * machine and not enough under load, which makes for a test that fails for
 * reasons that have nothing to do with the code.
 */
const E2E_TIMEOUT = 60_000

describe('argument parsing', () => {
  test('reads the flags it documents', () => {
    const args = parseArgs(['extract', '--cwd', '/tmp/app', '--config', 'x.json'])
    expect(args).toMatchObject({ command: 'extract', cwd: '/tmp/app', config: 'x.json' })
    expect(args.errors).toEqual([])
  })

  test('a flag with no value is an error, not a crash', () => {
    // `path.resolve(undefined)` throws a TypeError, which is not a useful thing
    // to show someone who typed `--cwd` and forgot the path.
    expect(parseArgs(['extract', '--cwd']).errors[0]).toMatch(/--cwd needs a value/)
    expect(parseArgs(['extract', '--cwd', '--config', 'x']).errors[0]).toMatch(
      /--cwd needs a value/,
    )
  })

  test('an unknown option is named rather than ignored', () => {
    expect(parseArgs(['extract', '--outfile', 'x']).errors[0]).toMatch(/--outfile/)
  })
})

describe('target validation', () => {
  test('rejects each malformed target on its own and keeps the rest', () => {
    const { targets, rejected } = validateTargets([
      { key: ['good'], type: 'Good' },
      { key: ['a'], route: 'GET /a', type: 'Both' },
      { type: 'Neither' },
      { key: [], type: 'Empty' },
      { route: '   ', type: 'Blank' },
      { key: ['no-type'] },
      'nonsense',
      { route: 'GET /also-good', type: 'Fine' },
    ])
    expect(targets.map((target) => target.type)).toEqual(['Good', 'Fine'])
    expect(rejected).toHaveLength(6)
    expect(rejected.map((item) => item.message)).toEqual([
      expect.stringMatching(/both/),
      expect.stringMatching(/"key" array or a "route" string/),
      expect.stringMatching(/must not be empty/),
      expect.stringMatching(/non-empty string/),
      expect.stringMatching(/needs a "type"/),
      expect.stringMatching(/must be an object/),
    ])
  })

  test('keeps the original index, so shim aliases stay aligned', () => {
    const { targets } = validateTargets([
      { type: 'Broken' },
      { key: ['second'], type: 'Second' },
    ])
    expect(targets[0].index).toBe(1)
  })

  test('flags a pattern listed twice with two different types', () => {
    const { targets } = validateTargets([
      { key: ['user'], type: 'User' },
      { key: ['user'], type: 'Account' },
    ])
    expect(duplicateWarnings(targets)[0]).toMatch(/different types/)
  })
})

describe('identifier extraction for the shim', () => {
  test('takes the type names out of a generic instantiation', () => {
    expect(extractIdentifiers(['ApiResponse<Todo[]>']).sort()).toEqual([
      'ApiResponse',
      'Todo',
    ])
  })

  test('ignores the contents of string literals', () => {
    // `Status | 'pending'` must not try to import `pending`.
    expect(extractIdentifiers(["Status | 'pending' | \"done\""])).toEqual(['Status'])
  })

  test('never emits a reserved word, which would break the whole shim', () => {
    // A conditional type is a legitimate response type. `import type { extends }`
    // is a syntax error, and one syntax error makes *every* target resolve to
    // `any` — the exact silent-empty failure this all exists to prevent.
    const identifiers = extractIdentifiers([
      "T extends 'ride' ? RidePreferences : OrderPreference[]",
    ])
    expect(identifiers).not.toContain('extends')
    expect(identifiers).toContain('RidePreferences')
    expect(identifiers).toContain('OrderPreference')
  })

  test('imports only the head of a qualified name', () => {
    expect(extractIdentifiers(['Api.Response'])).toEqual(['Api'])
  })

  test('drops built-ins and primitives', () => {
    expect(extractIdentifiers(['Record<string, Partial<Thing>>'])).toEqual(['Thing'])
  })
})

describe('source specifiers', () => {
  test('a relative path keeps its shape and loses its extension', () => {
    expect(toImportPath('./api.ts')).toBe('./api')
    expect(toImportPath('../../packages/state/queries.ts')).toBe(
      '../../packages/state/queries',
    )
  })

  test('a bare filename is made relative', () => {
    expect(toImportPath('api.ts')).toBe('./api')
  })

  test('a package specifier is passed through untouched', () => {
    // Prefixing `./` onto this is what made a monorepo unable to name its own
    // types, since they are rarely all reachable by relative path.
    expect(toImportPath('@app/state/queries', 'specifier')).toBe('@app/state/queries')
  })

  test('a source is classified by whether it resolves, not by its spelling', () => {
    // `api.ts` and `@app/state/queries` are both "not obviously relative".
    // Guessing from the shape gets one of them wrong every time.
    const root = project('classify', { 'api.ts': 'export type A = string' })
    expect(classifySource(root, './api.ts')).toMatchObject({ kind: 'file' })
    expect(classifySource(root, 'api.ts')).toMatchObject({ kind: 'file' })
    expect(classifySource(root, 'api')).toMatchObject({ kind: 'file' })
    expect(classifySource(root, '@app/state/queries')).toEqual({ kind: 'specifier' })
    expect(classifySource(root, './missing.ts')).toEqual({ kind: 'missing' })
  })
})

describe('route pattern warnings', () => {
  test('says nothing about a pattern that works', () => {
    expect(routePatternWarnings('GET /v2/api/wallet')).toEqual([])
    expect(routePatternWarnings('/v2/api/wallet')).toEqual([])
    expect(routePatternWarnings('GET **/wallet')).toEqual([])
    expect(routePatternWarnings('GET https://api.example.com/**')).toEqual([])
  })

  test('catches a path with no leading slash', () => {
    expect(routePatternWarnings('GET wallet')[0]).toMatch(/does not start with "\/"/)
  })

  test('catches a mistyped method', () => {
    expect(routePatternWarnings('GTE /wallet')[0]).toMatch(/not an HTTP method/)
  })

  test('catches a method with no path', () => {
    // `"GET"` alone parses as a path *called* GET, which nobody means.
    expect(routePatternWarnings('GET ')[0]).toMatch(/no path/)
    expect(routePatternWarnings('GET')[0]).toMatch(/no path/)
  })

  /**
   * The warning duplicates knowledge the real matcher owns, so it is checked
   * against the matcher rather than against my belief about the matcher.
   */
  test('agrees with the matcher about what can and cannot match', () => {
    const url = 'https://api.example.com/v2/api/wallet'
    const ref = routeTarget('GET', url).ref

    const warned = 'GET wallet'
    expect(routePatternWarnings(warned).length).toBeGreaterThan(0)
    expect(matchesTarget(parseTargetPattern(warned), ref)).toBe(false)

    for (const clean of ['GET /v2/api/wallet', 'GET **/wallet', '/v2/api/wallet']) {
      expect(routePatternWarnings(clean)).toEqual([])
      expect(matchesTarget(parseTargetPattern(clean), ref)).toBe(true)
    }
  })
})

describe('hollow schema detection', () => {
  const wrap = (definitions: Record<string, unknown>, ref: string) => ({
    $ref: `#/definitions/${ref}`,
    definitions,
  })

  test('passes a real schema', () => {
    expect(
      hollowReason(wrap({ User: { type: 'object', properties: { a: { type: 'string' } } } }, 'User')),
    ).toBeNull()
  })

  test('catches the empty object a non-exported type produces', () => {
    expect(hollowReason(wrap({ Thing: {} }, 'Thing'))).toMatch(/no type information/)
  })

  test('catches an array of nothing, which reads as a real schema', () => {
    // `{"type":"array","items":{}}` has a `type`, so any naive check passes it —
    // and it generates `[null, null, null]`.
    expect(
      hollowReason(wrap({ 'Thing[]': { type: 'array', items: {} } }, 'Thing%5B%5D')),
    ).toMatch(/elements carry no type information/)
  })

  test('catches nested arrays of nothing', () => {
    expect(
      hollowReason(
        wrap({ X: { type: 'array', items: { type: 'array', items: {} } } }, 'X'),
      ),
    ).toMatch(/elements/)
  })

  test('catches an array with no items at all', () => {
    expect(hollowReason(wrap({ X: { type: 'array' } }, 'X'))).toMatch(/no element type/)
  })

  test('catches a root $ref that goes nowhere', () => {
    expect(hollowReason({ $ref: '#/definitions/Missing', definitions: {} })).toMatch(
      /does not resolve/,
    )
  })

  test('follows a $ref chain to the real definition', () => {
    expect(
      hollowReason(
        wrap({ A: { $ref: '#/definitions/B' }, B: { type: 'string' } }, 'A'),
      ),
    ).toBeNull()
  })

  test('a recursive type is a real type, not a hollow one', () => {
    expect(
      hollowReason(
        wrap(
          { Node: { type: 'object', properties: { next: { $ref: '#/definitions/Node' } } } },
          'Node',
        ),
      ),
    ).toBeNull()
  })

  test('an `any` field inside a real type is not a reason to reject it', () => {
    // Only the root is judged: `any` fields are ordinary, and generation already
    // warns about them by path.
    expect(
      hollowReason(
        wrap({ User: { type: 'object', properties: { meta: {} } } }, 'User'),
      ),
    ).toBeNull()
  })

  test('accepts a Record, which arrives as additionalProperties only', () => {
    expect(
      hollowReason(wrap({ M: { additionalProperties: { type: 'string' } } }, 'M')),
    ).toBeNull()
  })

  test('accepts an enum and a const', () => {
    expect(hollowReason(wrap({ E: { enum: ['a', 'b'] } }, 'E'))).toBeNull()
    expect(hollowReason(wrap({ C: { const: 1 } }, 'C'))).toBeNull()
  })

  test('a missing document is a reason, not a crash', () => {
    expect(hollowReason(null)).toMatch(/no schema/)
    expect(hollowReason(undefined)).toMatch(/no schema/)
  })

  test('a self-referential root $ref does not hang', () => {
    expect(
      hollowReason({ $ref: '#/definitions/A', definitions: { A: { $ref: '#/definitions/A' } } }),
    ).toMatch(/does not resolve/)
  })
})

describe('unwrapAlias', () => {
  test('points the document at what the alias pointed at', () => {
    const schema = {
      $ref: '#/definitions/DataSeed_0',
      definitions: {
        DataSeed_0: { $ref: '#/definitions/User' },
        User: { type: 'object' },
      },
    }
    unwrapAlias(schema, 'DataSeed_0', 'User')
    expect(schema.$ref).toBe('#/definitions/User')
    expect(schema.definitions.DataSeed_0).toBeUndefined()
  })

  test('never overwrites an existing definition with the inlined alias', () => {
    const schema = {
      $ref: '#/definitions/DataSeed_0',
      definitions: {
        DataSeed_0: { type: 'array', items: { $ref: '#/definitions/User' } },
        'User[]': { type: 'string' },
      },
    }
    unwrapAlias(schema, 'DataSeed_0', 'User[]')
    expect(schema.definitions['User[]']).toEqual({ type: 'string' })
    expect(schema.$ref).toBe(`#/definitions/${encodeURIComponent('User[] (root)')}`)
  })
})

describe('the generator factory', () => {
  test('builds the program once and reuses it', () => {
    // Building the TypeScript program is nearly all of the cost, so paying it
    // per target is what made a 47-target monorepo config take 20s.
    const built: unknown[] = []
    const createGenerator = (options: { type: string }) => {
      built.push(options.type)
      return { createSchema: (name: string) => ({ name }) }
    }
    const factory = makeGeneratorFactory(createGenerator, '/shim.ts', '/tsconfig.json')
    factory.schemaFor('DataSeed_0')
    factory.schemaFor('DataSeed_1')
    expect(built).toEqual(['*'])
    expect(factory.sharedFailed).toBeNull()
  })

  test('falls back to one generator per target rather than giving up', () => {
    // `type: '*'` asks the generator to consider every exported type in the
    // program. A project with something it cannot handle anywhere would
    // otherwise take the whole run down; per-target is slow but still works.
    const built: string[] = []
    const createGenerator = (options: { type: string }) => {
      if (options.type === '*') throw new Error('cannot handle SomeOtherType')
      built.push(options.type)
      return { createSchema: (name: string) => ({ name }) }
    }
    const factory = makeGeneratorFactory(createGenerator, '/shim.ts', '/tsconfig.json')
    expect(factory.sharedFailed).toMatch(/cannot handle SomeOtherType/)
    expect(factory.schemaFor('DataSeed_0')).toEqual({ name: 'DataSeed_0' })
    expect(factory.schemaFor('DataSeed_1')).toEqual({ name: 'DataSeed_1' })
    expect(built).toEqual(['DataSeed_0', 'DataSeed_1'])
  })
})

test('the version the CLI writes matches the one the SDK reads', () => {
  const source = fs.readFileSync(CLI, 'utf8')
  const match = /const SCHEMAS_VERSION = (\d+)/.exec(source)
  expect(Number(match?.[1])).toBe(SCHEMAS_VERSION)
})

// --------------------------------------------------------------- end to end

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'data-seed-cli-'))
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

function project(name: string, files: Record<string, string>) {
  const root = path.join(scratch, name)
  fs.mkdirSync(root, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), content, 'utf8')
  }
  return root
}

/**
 * Runs the CLI and returns its exit code and combined output.
 *
 * The output is captured through a redirect rather than `stdout: 'pipe'`,
 * because piped capture comes back empty for child processes spawned from a
 * test in this repo — an environment quirk, not something the CLI does.
 */
function run(root: string) {
  const log = path.join(scratch, `${path.basename(root)}.log`)
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const result = Bun.spawnSync([
    'sh',
    '-c',
    `node ${quote(CLI)} extract --cwd ${quote(root)} > ${quote(log)} 2>&1`,
  ])
  const output = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
  return { code: result.exitCode, output }
}

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ESNext', module: 'ESNext' },
  include: ['**/*.ts'],
})

describe('running it', () => {
  test('a partly broken config still produces the schemas that work', () => {
    const root = project('mixed', {
      'tsconfig.json': TSCONFIG,
      'api.ts': [
        'export type Good = { id: string; count: number }',
        // Not exported — the case that used to extract as a green tick.
        'type Private = { secret: string }',
        'export type Holder = { thing: Private }',
      ].join('\n'),
      'data-seed.config.json': JSON.stringify({
        source: './api.ts',
        targets: [
          { key: ['good'], type: 'Good' },
          { key: ['private'], type: 'Private' },
          { key: ['privates'], type: 'Private[]' },
          { key: ['holder'], type: 'Holder' },
          { key: ['both'], route: 'GET /x', type: 'Good' },
        ],
      }),
    })

    const { code, output } = run(root)

    expect(output).toContain('✓ ["good"]')
    expect(output).toContain('✓ ["holder"]')
    // Both shapes of empty are caught, and named.
    expect(output).toContain('✗ ["private"]')
    expect(output).toContain('✗ ["privates"]')
    expect(output).toMatch(/is `Private` exported/)
    // The malformed target is reported without taking the run down.
    expect(output).toMatch(/sets both "key" and "route"/)
    // Failure is visible to CI…
    expect(code).toBe(1)

    // …and the schemas that did work are still on disk.
    const written = JSON.parse(
      fs.readFileSync(path.join(root, 'data-seed.schemas.json'), 'utf8'),
    )
    expect(written.entries.map((entry: { type: string }) => entry.type)).toEqual([
      'Good',
      'Holder',
    ])
  }, E2E_TIMEOUT)

  test('a clean config exits zero and rewrites nothing on a second run', () => {
    const root = project('clean', {
      'tsconfig.json': TSCONFIG,
      'api.ts': 'export type Good = { id: string }',
      'data-seed.config.json': JSON.stringify({
        source: './api.ts',
        targets: [{ key: ['good'], type: 'Good' }],
      }),
    })

    const first = run(root)
    expect(first.code).toBe(0)
    expect(first.output).toContain('Wrote 1 schema')

    const out = path.join(root, 'data-seed.schemas.json')
    const stamp = JSON.parse(fs.readFileSync(out, 'utf8')).generatedAt

    const second = run(root)
    expect(second.code).toBe(0)
    // A committed file that changes on every run trains people to skip the diff.
    expect(second.output).toContain('unchanged')
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).generatedAt).toBe(stamp)
  }, E2E_TIMEOUT)

  test('a source that does not resolve fails before extracting anything', () => {
    const root = project('no-source', {
      'tsconfig.json': TSCONFIG,
      'data-seed.config.json': JSON.stringify({
        source: './nope.ts',
        targets: [{ key: ['x'], type: 'X' }],
      }),
    })
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toMatch(/"source" does not resolve/)
    expect(fs.existsSync(path.join(root, 'data-seed.schemas.json'))).toBe(false)
  }, E2E_TIMEOUT)

  test('the temporary shim never survives the run', () => {
    const root = project('shim', {
      'tsconfig.json': TSCONFIG,
      'api.ts': 'export type Good = { id: string }',
      'data-seed.config.json': JSON.stringify({
        source: './api.ts',
        targets: [{ key: ['good'], type: 'Good' }],
      }),
    })
    run(root)
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.data-seed'))).toEqual([])
  }, E2E_TIMEOUT)

  test('an existing file is never claimed as the shim, or deleted', () => {
    const root = project('collision', {
      'tsconfig.json': TSCONFIG,
      'api.ts': 'export type Good = { id: string }',
      '.data-seed-extract.ts': '// someone else owns this\n',
      'data-seed.config.json': JSON.stringify({
        source: './api.ts',
        targets: [{ key: ['good'], type: 'Good' }],
      }),
    })
    const { code } = run(root)
    expect(code).toBe(0)
    expect(fs.readFileSync(path.join(root, '.data-seed-extract.ts'), 'utf8')).toBe(
      '// someone else owns this\n',
    )
  }, E2E_TIMEOUT)

  test('a mistyped config key is named instead of silently ignored', () => {
    const root = project('typo', {
      'tsconfig.json': TSCONFIG,
      'api.ts': 'export type Good = { id: string }',
      'data-seed.config.json': JSON.stringify({
        sources: './api.ts',
        source: './api.ts',
        targets: [{ key: ['good'], type: 'Good' }],
      }),
    })
    const { output } = run(root)
    expect(output).toMatch(/unknown config key "sources"/)
  }, E2E_TIMEOUT)

  test('a route that can never match is warned about, not silently accepted', () => {
    const root = project('route-warn', {
      'tsconfig.json': TSCONFIG,
      'api.ts': 'export type Good = { id: string }',
      'data-seed.config.json': JSON.stringify({
        source: './api.ts',
        targets: [{ route: 'GET wallet', type: 'Good' }],
      }),
    })
    const { code, output } = run(root)
    // Extraction succeeded — the schema is fine, the pattern is the problem.
    expect(code).toBe(0)
    expect(output).toMatch(/does not start with "\/"/)
  }, E2E_TIMEOUT)

  test('every target failing points at the source rather than at each type', () => {
    const root = project('all-hollow', {
      'tsconfig.json': TSCONFIG,
      'api.ts': 'export const nothing = 1',
      'data-seed.config.json': JSON.stringify({
        source: './api.ts',
        targets: [
          { key: ['a'], type: 'Alpha' },
          { key: ['b'], type: 'Beta' },
        ],
      }),
    })
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toMatch(/Nothing at all resolved/)
  }, E2E_TIMEOUT)

  test('an unparseable config says so instead of throwing', () => {
    const root = project('bad-json', {
      'tsconfig.json': TSCONFIG,
      'data-seed.config.json': '{ not json',
    })
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toMatch(/is not valid JSON/)
    expect(output).not.toMatch(/at Object\./) // no stack trace
  }, E2E_TIMEOUT)
})
