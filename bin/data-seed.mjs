#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * `data-seed extract` — turns the app's TypeScript types into JSON Schemas the
 * panel can generate data from.
 *
 * This is a CLI rather than part of the plugin because Rozenite gives plugins no
 * Node-side execution: the panel runs in a browser and the SDK runs in Hermes,
 * and neither can read a tsconfig. The output is committed and bundled with the
 * app exactly like fixtures, which is what gets it back to the panel.
 *
 * Plain `.mjs` on purpose — it is not part of the Vite build, so it stays
 * runnable straight from the package with nothing compiled first.
 */

const CONFIG_NAME = 'data-seed.config.json'
/** Bumped to 2 when a pattern became "array or route string". */
const SCHEMAS_VERSION = 2

/**
 * Identifiers that appear in type expressions but are not importable — TS
 * built-ins, utility types, and primitives. Anything else in an expression is
 * assumed to come from the module being read.
 */
const NOT_IMPORTABLE = new Set([
  'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick',
  'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
  'Promise', 'Map', 'Set', 'Date', 'RegExp', 'Awaited', 'string', 'number',
  'boolean', 'null', 'undefined', 'any', 'unknown', 'never', 'void', 'object',
  'true', 'false', 'bigint', 'symbol',
])

function fail(message) {
  console.error(`\n  data-seed: ${message}\n`)
  process.exit(1)
}

function help() {
  console.log(`
  data-seed extract [--config <path>] [--cwd <dir>]

  Reads ${CONFIG_NAME} and writes a JSON Schema for each target pattern.

  ${CONFIG_NAME}:
  {
    "tsconfig": "./tsconfig.json",
    "out": "./data-seed.schemas.json",
    "source": "./api.ts",
    "targets": [
      { "key": ["todos"],           "type": "ApiResponse<Todo[]>" },
      { "key": ["user", "*"],       "type": "ApiResponse<User>"   },
      { "route": "GET /api/todos",  "type": "ApiResponse<Todo[]>" }
    ]
  }

  A target is named by "key" or by "route", never both.

    key    "*" matches any single element, so ["user", "*"] covers every user.
    route  "*" matches within a path segment and "**" crosses segments, so
           "GET /api/users/*" covers /api/users/7 but not /api/users/7/posts.
           An omitted method matches any.

  Annotate fields in your own source to control generated values:

    /** @faker person.fullName */
    name: string
`)
}

function parseArgs(argv) {
  const args = { command: argv[0], cwd: process.cwd(), config: null }
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i]
    else if (argv[i] === '--cwd') args.cwd = path.resolve(argv[++i])
    else if (argv[i] === '--help' || argv[i] === '-h') args.command = 'help'
  }
  return args
}

async function loadGenerator() {
  try {
    return await import('ts-json-schema-generator')
  } catch {
    fail(
      'ts-json-schema-generator is not installed.\n' +
        '  It is a peer dependency so it only lands in projects that extract schemas:\n\n' +
        '    npm install --save-dev ts-json-schema-generator',
    )
  }
}

function readConfig(cwd, explicit) {
  const configPath = explicit ? path.resolve(cwd, explicit) : path.join(cwd, CONFIG_NAME)
  if (!fs.existsSync(configPath)) {
    fail(`no ${CONFIG_NAME} found at ${configPath}\n  Run with --help to see the format.`)
  }
  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    fail(`${configPath} is not valid JSON: ${error.message}`)
  }
  // `queries` is the v1 spelling and still works, so an existing config keeps
  // extracting without being rewritten.
  const targets = config.targets ?? config.queries
  if (!Array.isArray(targets) || targets.length === 0) {
    fail(`${configPath} needs a non-empty "targets" array.`)
  }
  for (const [index, target] of targets.entries()) {
    const hasKey = Array.isArray(target.key)
    const hasRoute = typeof target.route === 'string'
    if (hasKey && hasRoute) {
      fail(`${configPath} target ${index} sets both "key" and "route"; pick one.`)
    }
    if (!hasKey && !hasRoute) {
      fail(`${configPath} target ${index} needs a "key" array or a "route" string.`)
    }
    if (typeof target.type !== 'string' || target.type.trim() === '') {
      fail(`${configPath} target ${index} needs a "type".`)
    }
  }
  return { config, targets, configPath, root: path.dirname(configPath) }
}

/**
 * Writes a throwaway module that names each target's type.
 *
 * ts-json-schema-generator resolves a *named* type, but the useful types are
 * usually generic instantiations — `ApiResponse<Todo[]>` is not a name, so it
 * cannot be requested directly. Declaring an alias for it makes it one.
 *
 * The file is written inside the project so its relative imports and tsconfig
 * paths resolve exactly as the app's own code does.
 */
function writeShim(root, source, targets) {
  const identifiers = new Set()
  for (const target of targets) {
    for (const match of target.type.matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (!NOT_IMPORTABLE.has(match[0])) identifiers.add(match[0])
    }
  }

  const importPath = toImportPath(source)
  const lines = [
    '// Generated by `data-seed extract`. Safe to delete.',
    `import type { ${[...identifiers].join(', ')} } from '${importPath}'`,
    '',
  ]
  targets.forEach((target, index) => {
    lines.push(`export type DataSeed_${index} = ${target.type}`)
  })

  const shimPath = path.join(root, '.data-seed-extract.ts')
  fs.writeFileSync(shimPath, `${lines.join('\n')}\n`, 'utf8')
  return shimPath
}

function toImportPath(source) {
  const withoutExtension = source.replace(/\.tsx?$/, '')
  return withoutExtension.startsWith('.') ? withoutExtension : `./${withoutExtension}`
}

/** The pattern as it is written on disk: an array for keys, a string for routes. */
function patternOf(target) {
  return Array.isArray(target.key) ? target.key : target.route.trim()
}

function labelOf(target) {
  return Array.isArray(target.key) ? JSON.stringify(target.key) : target.route.trim()
}

async function extract(args) {
  const { config, targets, root } = readConfig(args.cwd, args.config)
  const { createGenerator } = await loadGenerator()

  const source = config.source ?? './api.ts'
  const tsconfig = path.resolve(root, config.tsconfig ?? './tsconfig.json')
  const out = path.resolve(root, config.out ?? './data-seed.schemas.json')

  if (!fs.existsSync(tsconfig)) fail(`tsconfig not found at ${tsconfig}`)

  const shimPath = writeShim(root, source, targets)
  const entries = []
  const failures = []

  try {
    for (const [index, target] of targets.entries()) {
      const typeName = `DataSeed_${index}`
      try {
        const generator = createGenerator({
          path: shimPath,
          tsconfig,
          type: typeName,
          // `extended` plus an explicit extra tag is what carries `@faker`
          // annotations from the source through to the schema.
          jsDoc: 'extended',
          extraTags: ['faker'],
          // The app's own type-check is the app's business; failing extraction
          // over an unrelated error elsewhere in the project would be unhelpful.
          skipTypeCheck: true,
          additionalProperties: false,
        })
        const schema = generator.createSchema(typeName)
        unwrapAlias(schema, typeName, target.type)
        entries.push({ pattern: patternOf(target), type: target.type, schema })
        console.log(`  ✓ ${labelOf(target)}  ${target.type}`)
      } catch (error) {
        failures.push({ target, message: String(error.message ?? error).split('\n')[0] })
        console.error(`  ✗ ${labelOf(target)}  ${target.type}`)
        console.error(`      ${String(error.message ?? error).split('\n')[0]}`)
      }
    }
  } finally {
    fs.rmSync(shimPath, { force: true })
  }

  if (entries.length === 0) fail('no schemas could be generated.')

  const file = {
    version: SCHEMAS_VERSION,
    generatedAt: new Date().toISOString(),
    entries,
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, 'utf8')

  console.log(`\n  Wrote ${entries.length} schema(s) to ${path.relative(root, out)}`)
  if (failures.length > 0) {
    console.log(`  ${failures.length} failed — see above.`)
  }
  console.log('\n  Commit it, and pass it to the hook:\n')
  console.log('    useSeeder({')
  console.log('      queryClient,')
  console.log(`      schemas: require('${toImportPath(path.relative(root, out))}'),`)
  console.log('    })\n')
}

/**
 * Removes the shim's alias from the emitted document.
 *
 * `DataSeed_3` is an implementation detail that would otherwise leak into a
 * committed file and churn whenever the config is reordered. The generator
 * emits it as a one-line indirection — `{"$ref": "#/definitions/Real"}` — so the
 * fix is to point the document at whatever the alias pointed at and drop it.
 *
 * Emphatically *not* done by renaming the alias to the real type name: the real
 * definition is usually already stored under that name, and renaming overwrites
 * it with the indirection, leaving a `$ref` that resolves to itself. That
 * produces a schema which extracts and commits perfectly happily and then
 * generates `null` for every field.
 */
function unwrapAlias(schema, aliasName, displayName) {
  const definitions = schema.definitions
  if (!definitions || !(aliasName in definitions)) return

  const alias = definitions[aliasName]
  delete definitions[aliasName]

  const isIndirection =
    alias && typeof alias === 'object' && alias.$ref && Object.keys(alias).length === 1

  if (isIndirection) {
    schema.$ref = alias.$ref
    return
  }

  // The generator inlined the type rather than referencing it, so the alias node
  // *is* the definition and needs a home. Only claim the display name if it is
  // free, so an existing definition is never overwritten.
  const name = displayName in definitions ? `${displayName} (root)` : displayName
  definitions[name] = alias
  schema.$ref = `#/definitions/${encodeURIComponent(name)}`
}

const args = parseArgs(process.argv.slice(2))
if (args.command === 'extract') {
  await extract(args)
} else {
  help()
  if (args.command && args.command !== 'help') process.exit(1)
}
