#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
 *
 * ## What this file is defensive about, and why
 *
 * The output is a *committed* artifact. A run that half-works and says so is
 * strictly better than one that either dies on the first bad target or — far
 * worse — prints ticks for schemas that carry no type information. Every target
 * is therefore isolated: a bad one is reported and skipped, the rest still land.
 *
 * The one thing never traded away is honesty about what was produced. A schema
 * that would generate `null` for every field is a *failure*, not a success, even
 * though the generator returns it without complaint.
 */

const CONFIG_NAME = 'data-seed.config.json'
/** Must match `SCHEMAS_VERSION` in `src/shared/schema.ts` (a test asserts it). */
const SCHEMAS_VERSION = 2
const SHIM_BASENAME = '.data-seed-extract'

/** Config keys we understand, so a typo is caught rather than ignored. */
const CONFIG_KEYS = new Set(['tsconfig', 'source', 'out', 'targets', 'queries'])

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', '*',
])

/**
 * Identifiers that appear in type expressions but are not importable — TS
 * built-ins, utility types, primitives, and every reserved word.
 *
 * The reserved words matter more than they look: `T extends 'a' ? X : Y` is a
 * perfectly good target type, and emitting `import type { extends }` is a syntax
 * error that takes down the whole shim — every target, not just that one.
 */
const NOT_IMPORTABLE = new Set([
  // utility + structural types
  'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick',
  'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
  'ConstructorParameters', 'InstanceType', 'ThisType', 'ThisParameterType',
  'OmitThisParameter', 'Awaited', 'NoInfer', 'Uppercase', 'Lowercase',
  'Capitalize', 'Uncapitalize',
  // globals a response type plausibly mentions
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Error',
  'Function', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Iterable', 'AsyncIterable', 'Iterator', 'ArrayBuffer', 'SharedArrayBuffer',
  'DataView', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'JSON', 'Math',
  'Blob', 'File', 'FormData', 'URL', 'URLSearchParams', 'Headers', 'Response',
  // primitives and type keywords
  'string', 'number', 'boolean', 'null', 'undefined', 'any', 'unknown', 'never',
  'void', 'object', 'true', 'false', 'bigint', 'symbol',
  // reserved words that can appear in a type expression
  'extends', 'keyof', 'typeof', 'infer', 'readonly', 'in', 'is', 'asserts',
  'new', 'import', 'this', 'as', 'satisfies', 'const', 'out', 'type',
  'abstract', 'declare', 'function', 'class', 'interface', 'enum', 'namespace',
  'module', 'global', 'default', 'export', 'return', 'case', 'switch', 'if',
  'else', 'for', 'while', 'do', 'break', 'continue', 'delete', 'instanceof',
  'let', 'var', 'yield', 'await', 'async',
])

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'let', 'static', 'await', 'implements',
  'interface', 'package', 'private', 'protected', 'public',
])

// --------------------------------------------------------------- reporting

/** A failure we chose, as opposed to one that escaped. */
export class CliError extends Error {}

/**
 * Stops with a sentence.
 *
 * Throws rather than calling `process.exit`, which discards whatever is still
 * buffered on stdout when it is a pipe — so the message explaining the failure
 * is exactly what goes missing when the output is being captured.
 */
function fail(message) {
  throw new CliError(message)
}

function reason(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.split('\n')[0].trim() || 'unknown error'
}

function help() {
  console.log(`
  data-seed extract [--config <path>] [--cwd <dir>]
  data-seed tokens

  Reads ${CONFIG_NAME} and writes a JSON Schema for each target pattern.

  ${CONFIG_NAME}:
  {
    "tsconfig": "./tsconfig.json",
    "out": "./data-seed.schemas.json",
    "source": "./api.ts",
    "targets": [
      { "key": ["todos"],           "type": "ApiResponse<Todo[]>" },
      { "key": ["user", "*"],       "type": "ApiResponse<User>"   },
      { "route": "GET /api/todos",  "type": "ApiResponse<Todo[]>" },
      { "name": "RealtimePayload",  "type": "RealtimePayload"     }
    ]
  }

  "source" is where the target types are imported from — a path relative to the
  config, or a package specifier like "@app/state/queries". Every target type
  has to be reachable from that one module.

  A target is named by exactly one of "key", "route" or "name".

    key    "*" matches any single element, so ["user", "*"] covers every user.
    route  "*" matches within a path segment and "**" crosses segments, so
           "GET /api/users/*" covers /api/users/7 but not /api/users/7/posts.
           An omitted method matches any. The path is the one on the wire,
           including any base path the client prepends — "**" is the escape
           hatch when that varies by environment.
    name   Any TypeScript type, with no key and no URL — an envelope that
           arrives over a websocket or a realtime channel, say. The schema is
           extracted and written under that name for other tooling to read.
           This plugin cannot seed one: it has no address to intercept.

  Annotate fields in your own source to control generated values:

    /** @fake person.fullName */
    name: string

  Run \`data-seed tokens\` for every token and an example of what it produces.
  (\`@faker\` is the original spelling of the tag and still works.)

  A target that cannot be resolved is reported and skipped; the rest are still
  written. The exit code is non-zero if anything failed.
`)
}

// ------------------------------------------------------------------ args

export function parseArgs(argv) {
  const args = { command: argv[0] ?? null, cwd: null, config: null, errors: [] }
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') {
      args.command = 'help'
    } else if (flag === '--config' || flag === '--cwd') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        args.errors.push(`${flag} needs a value`)
        continue
      }
      i += 1
      if (flag === '--config') args.config = value
      else args.cwd = value
    } else {
      args.errors.push(`unknown option "${flag}" (valid: --config, --cwd, --help)`)
    }
  }
  return args
}

// ---------------------------------------------------------------- config

function readConfig(cwd, explicit) {
  const configPath = explicit ? path.resolve(cwd, explicit) : path.join(cwd, CONFIG_NAME)
  if (!fs.existsSync(configPath)) {
    fail(`no ${CONFIG_NAME} found at ${configPath}\n  Run with --help to see the format.`)
  }

  let text
  try {
    text = fs.readFileSync(configPath, 'utf8')
  } catch (error) {
    fail(`could not read ${configPath}: ${reason(error)}`)
  }

  let config
  try {
    config = JSON.parse(text)
  } catch (error) {
    fail(`${configPath} is not valid JSON: ${reason(error)}`)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail(`${configPath} must contain a JSON object.`)
  }

  const warnings = []
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      warnings.push(`unknown config key "${key}" — ignored (expected ${[...CONFIG_KEYS].join(', ')})`)
    }
  }

  // `queries` is the v1 spelling and still works, so an existing config keeps
  // extracting without being rewritten.
  const raw = config.targets ?? config.queries
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`${configPath} needs a non-empty "targets" array.`)
  }

  return { config, raw, configPath, root: path.dirname(configPath), warnings }
}

/**
 * Splits targets into usable and rejected.
 *
 * A malformed target is rejected on its own rather than killing the run: one
 * typo in a thirty-target config should cost you that one schema.
 */
export function validateTargets(raw) {
  const targets = []
  const rejected = []

  raw.forEach((target, index) => {
    const at = `target ${index}`
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      rejected.push({ label: at, message: 'must be an object' })
      return
    }

    const hasKey = 'key' in target && target.key !== undefined
    const hasRoute = 'route' in target && target.route !== undefined
    const hasName = 'name' in target && target.name !== undefined

    const selectors = [hasKey, hasRoute, hasName].filter(Boolean).length
    if (selectors > 1) {
      rejected.push({
        label: at,
        message: 'sets more than one of "key", "route" and "name"; pick one',
      })
      return
    }
    if (selectors === 0) {
      rejected.push({
        label: at,
        message: 'needs a "key" array, a "route" string, or a "name" string',
      })
      return
    }
    if (hasKey && !Array.isArray(target.key)) {
      rejected.push({ label: at, message: '"key" must be an array' })
      return
    }
    if (hasKey && target.key.length === 0) {
      rejected.push({ label: at, message: '"key" must not be empty' })
      return
    }
    if (hasRoute && (typeof target.route !== 'string' || target.route.trim() === '')) {
      rejected.push({ label: at, message: '"route" must be a non-empty string' })
      return
    }
    if (hasName && (typeof target.name !== 'string' || target.name.trim() === '')) {
      rejected.push({ label: at, message: '"name" must be a non-empty string' })
      return
    }
    if (typeof target.type !== 'string' || target.type.trim() === '') {
      const named = hasKey
        ? JSON.stringify(target.key)
        : String(hasRoute ? target.route : target.name).trim()
      rejected.push({ label: `${at} (${named})`, message: 'needs a "type"' })
      return
    }

    let pattern
    let label
    if (hasKey) {
      pattern = target.key
      label = JSON.stringify(target.key)
    } else if (hasRoute) {
      pattern = target.route.trim()
      label = pattern
    } else {
      label = target.name.trim()
      pattern = { name: label }
    }
    targets.push({ pattern, label, type: target.type.trim(), index })
  })

  return { targets, rejected }
}

/**
 * Things about a route pattern that will not stop extraction but will stop it
 * ever matching a request.
 *
 * Worth saying out loud because the failure is otherwise invisible: an
 * unmatched pattern is indistinguishable from a seed nobody triggered.
 */
export function routePatternWarnings(route) {
  const problems = []
  const match = /^([A-Za-z]+|\*)\s+(.*)$/.exec(route.trim())
  const method = match ? match[1].toUpperCase() : null
  const glob = match ? match[2].trim() : route.trim()

  if (method && !HTTP_METHODS.has(method)) {
    problems.push(`"${match[1]}" is not an HTTP method — the whole string is being read as a path`)
  }
  if (glob === '' || HTTP_METHODS.has(glob.toUpperCase())) {
    // `"GET"` on its own parses as a *path* called GET, which is never what
    // anyone meant by it.
    problems.push('has a method but no path')
  } else if (!glob.startsWith('/') && !glob.startsWith('*') && !/^https?:\/\//.test(glob)) {
    problems.push(
      `path does not start with "/" — matching is anchored, so this only fits a URL that is exactly "${glob}". ` +
        `Did you mean "/${glob}" or "**/${glob}"?`,
    )
  }
  return problems
}

/** Patterns written twice, which makes which schema wins a coin toss. */
export function duplicateWarnings(targets) {
  const seen = new Map()
  const warnings = []
  for (const target of targets) {
    const identity = JSON.stringify(target.pattern)
    const first = seen.get(identity)
    if (first === undefined) {
      seen.set(identity, target)
    } else if (first.type !== target.type) {
      warnings.push(
        `${target.label} is listed twice with different types (${first.type}, ${target.type}) — ` +
          'which one applies is not defined',
      )
    } else {
      warnings.push(`${target.label} is listed twice`)
    }
  }
  return warnings
}

// ------------------------------------------------------------------ shim

/** Strips string and template literals so their contents are not read as types. */
function stripLiterals(text) {
  return text.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ')
}

/**
 * The importable names a set of type expressions mentions.
 *
 * Over-importing is harmless — an unused or unresolved named import is inert
 * under `skipTypeCheck` — but *under*-importing silently yields `any`, so this
 * errs towards including a name. The exclusions are only for things that would
 * break the shim outright (reserved words) or that certainly are not exports
 * (literal contents, qualified members, TS built-ins).
 */
export function extractIdentifiers(types) {
  const identifiers = new Set()
  for (const expression of types) {
    const text = stripLiterals(expression)
    for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = match[0]
      if (NOT_IMPORTABLE.has(name) || RESERVED.has(name)) continue
      // `Foo.Bar` — only `Foo` is importable.
      if (/\.\s*$/.test(text.slice(0, match.index))) continue
      identifiers.add(name)
    }
  }
  return [...identifiers]
}

/**
 * How the shim should refer to `source`.
 *
 * A path loses its extension and gains a `./` if it needs one; a package
 * specifier (`@app/state/queries`) is passed through untouched, which is what a
 * monorepo needs — the types are rarely all reachable by relative path from
 * wherever the config happens to live.
 */
export function toImportPath(source, kind = 'file') {
  const trimmed = source.trim()
  if (kind === 'specifier') return trimmed
  const withoutExtension = trimmed.replace(/\.tsx?$/, '')
  return withoutExtension.startsWith('.') || path.isAbsolute(withoutExtension)
    ? withoutExtension
    : `./${withoutExtension}`
}

function existsAsFile(candidate) {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function resolveSourceFile(root, source) {
  const base = path.resolve(root, source)
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ].find(existsAsFile)
}

/**
 * Decides whether `source` names a file on disk or a package.
 *
 * Resolution decides it rather than the spelling: `api.ts` and
 * `@app/state/queries` are both "not obviously relative", and guessing from the
 * shape gets one of them wrong. Only a source written as a path (`./x`, `/x`)
 * that does not exist is an outright failure — because the shim would then
 * import a module that is not there, `skipTypeCheck` would swallow it, and
 * *every* target would resolve to `any`: a full run of ticks over nothing.
 */
export function classifySource(root, source) {
  const trimmed = source.trim()
  const found = resolveSourceFile(root, trimmed)
  if (found) return { kind: 'file', path: found }
  if (trimmed.startsWith('.') || path.isAbsolute(trimmed)) return { kind: 'missing' }
  return { kind: 'specifier' }
}

/**
 * Writes a throwaway module that names each target's type.
 *
 * ts-json-schema-generator resolves a *named* type, but the useful types are
 * usually generic instantiations — `ApiResponse<Todo[]>` is not a name, so it
 * cannot be requested directly. Declaring an alias for it makes it one.
 *
 * The file is written inside the project so its relative imports and tsconfig
 * paths resolve exactly as the app's own code does. It never overwrites an
 * existing file, and it is removed however the process exits.
 */
function writeShim(root, source, kind, targets) {
  const identifiers = extractIdentifiers(targets.map((target) => target.type))
  const lines = ['// Generated by `data-seed extract`. Safe to delete.']
  if (identifiers.length > 0) {
    lines.push(
      `import type { ${identifiers.join(', ')} } from '${toImportPath(source, kind)}'`,
    )
  }
  lines.push('')
  for (const target of targets) {
    lines.push(`export type DataSeed_${target.index} = ${target.type}`)
  }

  let shimPath = path.join(root, `${SHIM_BASENAME}.ts`)
  for (let suffix = 1; fs.existsSync(shimPath); suffix += 1) {
    if (suffix > 50) fail(`could not find a free filename for the extraction shim in ${root}`)
    shimPath = path.join(root, `${SHIM_BASENAME}-${suffix}.ts`)
  }

  try {
    fs.writeFileSync(shimPath, `${lines.join('\n')}\n`, 'utf8')
  } catch (error) {
    fail(
      `could not write the extraction shim to ${root}: ${reason(error)}\n` +
        '  Extraction needs to place one temporary .ts file next to the config.',
    )
  }
  return shimPath
}

/**
 * Removes the shim however this process ends.
 *
 * A `finally` covers the normal path; a Ctrl-C in the middle of a slow monorepo
 * program build does not, and leaving a stray `.data-seed-extract.ts` behind is
 * the kind of thing that gets committed by accident.
 */
function withCleanup(shimPath) {
  let done = false
  const remove = () => {
    if (done) return
    done = true
    try {
      fs.rmSync(shimPath, { force: true })
    } catch {
      // Nothing useful to do — the file is temporary and named as such.
    }
  }
  const onSignal = (signal) => () => {
    remove()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  const handlers = [
    ['SIGINT', onSignal('SIGINT')],
    ['SIGTERM', onSignal('SIGTERM')],
    ['exit', remove],
  ]
  for (const [event, handler] of handlers) process.on(event, handler)
  return () => {
    for (const [event, handler] of handlers) process.off(event, handler)
    remove()
  }
}

// --------------------------------------------------------------- schemas

function refName(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/definitions/')) return null
  try {
    return decodeURIComponent(ref.slice('#/definitions/'.length))
  } catch {
    return ref.slice('#/definitions/'.length)
  }
}

const MEANINGFUL = [
  'type', '$ref', 'anyOf', 'oneOf', 'allOf', 'enum', 'const', 'properties',
  'items', 'not', 'format', 'patternProperties',
]

function carriesType(node) {
  if (!node || typeof node !== 'object') return false
  if (MEANINGFUL.some((key) => node[key] !== undefined)) return true
  // `Record<string, Foo>` arrives as additionalProperties-only.
  return typeof node.additionalProperties === 'object' && node.additionalProperties !== null
}

/**
 * Why a schema would generate nothing, or `null` if it is fine.
 *
 * The case this exists for: a target type that is not exported from `source`.
 * TypeScript reports it, `skipTypeCheck` swallows it, the alias becomes `any`,
 * and the generator cheerfully emits `{}` — which extracts, commits, and then
 * produces `null` for every field at runtime. It reads as a success everywhere
 * except in the app.
 *
 * Only the *root* is judged. An `any` field buried inside a real type is
 * ordinary and generates a documented warning at seed time; an `any` root means
 * the whole target is empty.
 */
export function hollowReason(document) {
  if (!document || typeof document !== 'object') {
    return 'the generator returned no schema'
  }

  const definitions = document.definitions ?? {}
  const seen = new Set()

  let node = document
  let guard = 0
  while (node && typeof node === 'object' && node.$ref !== undefined) {
    if (guard++ > 64) return 'its $ref chain does not terminate'
    const name = refName(node.$ref)
    if (name === null || seen.has(name)) return `its root $ref (${node.$ref}) does not resolve`
    seen.add(name)
    const next = definitions[name]
    if (next === undefined) return `its root $ref (${node.$ref}) does not resolve`
    node = next
  }

  return emptyReason(node, definitions, new Set(seen), 0)
}

function emptyReason(node, definitions, seen, depth) {
  if (depth > 32) return null
  if (!node || typeof node !== 'object') return 'it carries no type information'

  if (node.$ref !== undefined) {
    const name = refName(node.$ref)
    if (name === null || seen.has(name)) return null // a cycle is a real type
    const next = definitions[name]
    if (next === undefined) return `$ref ${node.$ref} does not resolve`
    return emptyReason(next, definitions, new Set(seen).add(name), depth + 1)
  }

  if (!carriesType(node)) {
    return 'it carries no type information (the type resolved to `any`)'
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type
  if (type === 'array') {
    const items = Array.isArray(node.items) ? node.items[0] : node.items
    if (items === undefined) return 'it is an array with no element type'
    const inner = emptyReason(items, definitions, seen, depth + 1)
    if (!inner) return null
    // A broken reference is worth quoting exactly; "empty" is not.
    return inner.startsWith('$ref') ? inner : 'its elements carry no type information'
  }

  return null
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
export function unwrapAlias(schema, aliasName, displayName) {
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

// -------------------------------------------------------------- generator

async function loadGenerator() {
  try {
    return await import('ts-json-schema-generator')
  } catch (error) {
    fail(
      `ts-json-schema-generator could not be loaded: ${reason(error)}\n` +
        '  It is a peer dependency so it only lands in projects that extract schemas:\n\n' +
        '    npm install --save-dev ts-json-schema-generator',
    )
  }
}

const GENERATOR_OPTIONS = {
  // `extended` plus explicit extra tags is what carries `@fake` annotations
  // from the source through to the schema. `faker` is the original spelling and
  // is still read, so no annotation breaks.
  jsDoc: 'extended',
  extraTags: ['fake', 'faker'],
  // The app's own type-check is the app's business; failing extraction over an
  // unrelated error elsewhere in the project would be unhelpful.
  skipTypeCheck: true,
  additionalProperties: false,
}

/**
 * One generator for the whole run, falling back to one per target.
 *
 * Building the TypeScript program is nearly all of the cost — on a monorepo it
 * is ~1s, and the old per-target construction paid it 47 times over for a
 * 47-target config. Sharing it turns a 20s run into 1.3s.
 *
 * The fallback exists because `type: '*'` asks the generator to consider every
 * exported type in the program, and a project with something it cannot handle
 * anywhere could refuse to construct. Per-target construction only looks at one
 * type at a time, so it can still get most of the way. Slow beats broken.
 */
export function makeGeneratorFactory(createGenerator, shimPath, tsconfig) {
  const base = { ...GENERATOR_OPTIONS, path: shimPath, tsconfig }
  let shared = null
  let sharedFailed = null

  try {
    shared = createGenerator({ ...base, type: '*' })
  } catch (error) {
    sharedFailed = reason(error)
  }

  return {
    sharedFailed,
    schemaFor(typeName) {
      if (shared) return shared.createSchema(typeName)
      return createGenerator({ ...base, type: typeName }).createSchema(typeName)
    },
  }
}

// ---------------------------------------------------------------- output

/**
 * Writes the schemas file, leaving it untouched when nothing changed.
 *
 * `generatedAt` alone would otherwise produce a diff on every run of a
 * committed file, which trains people to stop reading the diff.
 */
function writeSchemas(out, entries) {
  const serialized = JSON.stringify(entries)

  if (fs.existsSync(out)) {
    try {
      const previous = JSON.parse(fs.readFileSync(out, 'utf8'))
      if (
        previous?.version === SCHEMAS_VERSION &&
        JSON.stringify(previous.entries) === serialized &&
        typeof previous.generatedAt === 'string'
      ) {
        return { changed: false }
      }
    } catch {
      // Unreadable or not ours — overwrite it.
    }
  }

  const file = {
    version: SCHEMAS_VERSION,
    generatedAt: new Date().toISOString(),
    entries,
  }
  const body = `${JSON.stringify(file, null, 2)}\n`
  const temporary = `${out}.tmp`
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    // Written aside and renamed so an interrupted run cannot leave a truncated
    // file where a committed one used to be.
    fs.writeFileSync(temporary, body, 'utf8')
    fs.renameSync(temporary, out)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Best effort.
    }
    fail(`could not write ${out}: ${reason(error)}`)
  }
  return { changed: true }
}

// --------------------------------------------------------------- extract

async function extract(args) {
  const cwd = args.cwd ?? process.cwd()
  const { config, raw, root, warnings: configWarnings } = readConfig(cwd, args.config)
  const { createGenerator } = await loadGenerator()

  const source = config.source ?? './api.ts'
  const tsconfig = path.resolve(root, config.tsconfig ?? './tsconfig.json')
  const out = path.resolve(root, config.out ?? './data-seed.schemas.json')

  if (!fs.existsSync(tsconfig)) fail(`tsconfig not found at ${tsconfig}`)

  const sourceKind = classifySource(root, source).kind
  if (sourceKind === 'missing') {
    fail(
      `"source" does not resolve to a file: ${path.resolve(root, source)}\n` +
        '  Every target type is imported from this module, so nothing can be extracted\n' +
        '  without it. Use a path relative to the config, or a package specifier.',
    )
  }

  const { targets, rejected } = validateTargets(raw)
  const failures = rejected.map((item) => ({
    label: item.label,
    type: '',
    message: item.message,
  }))
  if (targets.length === 0) {
    fail(
      'no usable targets.\n' +
        failures.map((item) => `  - ${item.label}: ${item.message}`).join('\n'),
    )
  }

  const warnings = [...configWarnings, ...duplicateWarnings(targets)]
  for (const target of targets) {
    if (typeof target.pattern !== 'string') continue
    for (const problem of routePatternWarnings(target.pattern)) {
      warnings.push(`${target.label}: ${problem}`)
    }
  }

  const shimPath = writeShim(root, source, sourceKind, targets)
  const cleanup = withCleanup(shimPath)
  const entries = []

  try {
    const factory = makeGeneratorFactory(createGenerator, shimPath, tsconfig)
    if (factory.sharedFailed) {
      warnings.push(
        `falling back to one generator per target (slower): ${factory.sharedFailed}`,
      )
    }

    for (const target of targets) {
      const typeName = `DataSeed_${target.index}`
      try {
        const schema = factory.schemaFor(typeName)
        if (!schema || typeof schema !== 'object') {
          throw new Error('the generator returned no schema')
        }
        unwrapAlias(schema, typeName, target.type)

        const hollow = hollowReason(schema)
        if (hollow) {
          failures.push({
            label: target.label,
            type: target.type,
            message: hollow,
            hint: notExportedHint(target.type, source),
            hollow: true,
          })
          console.error(`  ✗ ${target.label}  ${target.type}`)
          console.error(`      ${hollow}`)
          continue
        }

        entries.push({ pattern: target.pattern, type: target.type, schema })
        console.log(`  ✓ ${target.label}  ${target.type}`)
      } catch (error) {
        const message = reason(error)
        failures.push({
          label: target.label,
          type: target.type,
          message,
          hint: notExportedHint(target.type, source),
        })
        console.error(`  ✗ ${target.label}  ${target.type}`)
        console.error(`      ${message}`)
      }
    }
  } finally {
    cleanup()
  }

  report({ entries, failures, warnings, out, root, source })
  // Set rather than `exit()`, so the report above is actually flushed.
  if (failures.length > 0) process.exitCode = 1
}

function notExportedHint(type, source) {
  const name = /^[A-Za-z_$][\w$]*/.exec(type.trim())?.[0]
  if (!name) return null
  return `is \`${name}\` exported from ${source}? A type that is not exported resolves to \`any\`.`
}

function report({ entries, failures, warnings, out, root, source }) {
  if (entries.length === 0) {
    console.error('\n  No schemas could be generated.')
    for (const failure of failures) {
      console.error(`    ${failure.label}: ${failure.message}`)
      if (failure.hint) console.error(`      ${failure.hint}`)
    }
    // Every single target resolving to `any` is almost never many separate
    // mistakes — it is one module that did not resolve.
    if (failures.length > 1 && failures.every((failure) => failure.hollow)) {
      console.error(
        `\n  Nothing at all resolved, which usually means "source" (${source}) is not\n` +
          '  the module these types come from, or does not resolve from the config.',
      )
    }
    console.error('')
    return
  }

  const { changed } = writeSchemas(out, entries)
  const relative = path.relative(root, out) || out
  console.log(
    changed
      ? `\n  Wrote ${entries.length} schema(s) to ${relative}`
      : `\n  ${entries.length} schema(s) in ${relative} — unchanged`,
  )

  if (warnings.length > 0) {
    console.log(`\n  ${warnings.length} warning(s):`)
    for (const warning of warnings) console.log(`    ! ${warning}`)
  }

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} target(s) failed and were left out:`)
    for (const failure of failures) {
      console.log(`    ✗ ${failure.label}${failure.type ? `  ${failure.type}` : ''}`)
      console.log(`        ${failure.message}`)
      if (failure.hint) console.log(`        ${failure.hint}`)
    }
  }

  console.log('\n  Commit it, and pass it to the hook:\n')
  console.log('    useSeeder({')
  console.log('      queryClient,')
  console.log(`      schemas: require('${toImportPath(relative)}'),`)
  console.log('    })\n')
}

// ---------------------------------------------------------------- tokens

/**
 * The built SDK bundle, read from `exports` because the Rozenite builder names
 * it (`index.js` under 2.1, `sdk.js` under 2.4). Skips `development`, which is
 * TypeScript source.
 */
function sdkEntryPoints() {
  const root = path.dirname(fileURLToPath(import.meta.url))
  const candidates = []
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, '../package.json'), 'utf8'),
    )
    const sdk = manifest?.exports?.['./sdk']
    for (const condition of ['import', 'default', 'require']) {
      const target = sdk?.[condition]
      if (typeof target === 'string') candidates.push(path.resolve(root, '..', target))
    }
  } catch {
    // Fall back to the known spellings below.
  }
  candidates.push(path.resolve(root, '../dist/sdk/sdk.js'))
  candidates.push(path.resolve(root, '../dist/sdk/index.js'))
  return candidates.filter((candidate) => !candidate.endsWith('.ts'))
}

/**
 * Prints every `@fake` token with an example of what it produces.
 *
 * The examples are generated by running the real generator, not written down
 * here, so this cannot drift from what seeding actually does.
 */
async function tokens() {
  let catalogue
  let unloadable
  for (const entry of sdkEntryPoints()) {
    if (!existsAsFile(entry)) continue
    try {
      catalogue = await import(pathToFileURL(entry).href)
      break
    } catch (error) {
      unloadable ??= { entry, error }
    }
  }
  if (!catalogue && unloadable) {
    fail(
      `the built package could not be loaded.\n` +
        `  ${path.relative(process.cwd(), unloadable.entry)}: ${reason(unloadable.error)}\n` +
        '  Try rebuilding it. From a checkout, run: bun run build',
    )
  }
  if (!catalogue) {
    fail(
      'the package is not built.\n' +
        '  `tokens` reads the generator itself so its examples cannot go stale.\n' +
        '  From a checkout, run: bun run build',
    )
  }

  const { TOKENS, sampleToken } = catalogue ?? {}
  if (!Array.isArray(TOKENS) || TOKENS.length === 0 || typeof sampleToken !== 'function') {
    fail(
      'the built package does not export a token catalogue.\n' +
        '  This build is older than the `tokens` command. Run: bun run build',
    )
  }

  const width = Math.max(...TOKENS.map((entry) => entry.token.length))
  const argWidth = Math.max(...TOKENS.map((entry) => (entry.args ? entry.args.length : 0)))

  console.log('\n  Annotate a field in your own source:\n')
  console.log('    /** @fake person.fullName */')
  console.log('    name: string\n')
  console.log('  Arguments are JSON: @fake number.int({min: 1, max: 10})\n')

  let namespace = null
  for (const entry of TOKENS) {
    const next = entry.token.split('.')[0]
    if (next !== namespace) {
      console.log('')
      namespace = next
    }
    let example
    try {
      example = sampleToken(entry.token)
    } catch (error) {
      // One broken token should not hide the other twenty-two.
      example = `(could not sample: ${reason(error)})`
    }
    console.log(
      `  ${entry.token.padEnd(width)}  ${(entry.args ?? '').padEnd(argWidth)}  ` +
        `${entry.summary.padEnd(38)}  ${example}`,
    )
  }
  console.log('\n  Unannotated strings become lorem text; unannotated numbers are')
  console.log('  whole. `@faker` is the original spelling of the tag and still works.')
  console.log('\n  `date.*` is offset from a fixed epoch, not from now, because the same')
  console.log('  seed has to give the same value every run. Assert on ordering or')
  console.log('  format — never that a generated timestamp is close to the clock.\n')
}

// ------------------------------------------------------------------ main

export async function main(argv) {
  const args = parseArgs(argv)

  if (args.errors.length > 0) {
    fail(args.errors.join('\n  '))
  }

  if (args.cwd !== null) {
    const resolved = path.resolve(args.cwd)
    try {
      if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory')
    } catch {
      fail(`--cwd is not a directory: ${resolved}`)
    }
    args.cwd = resolved
  }

  if (args.command === 'extract') {
    await extract(args)
  } else if (args.command === 'tokens') {
    await tokens()
  } else {
    help()
    if (args.command && args.command !== 'help') process.exitCode = 1
  }
}

/**
 * True when this file is the process entry rather than an import.
 *
 * Compared through `realpathSync` because the usual way to run this is the
 * `node_modules/.bin/data-seed` symlink — `process.argv[1]` is then the link and
 * `import.meta.url` is its target, and a plain string compare says "imported"
 * and silently does nothing at all.
 */
function isEntryPoint() {
  if (process.argv[1] === undefined) return false
  const real = (candidate) => {
    try {
      return fs.realpathSync(candidate)
    } catch {
      return path.resolve(candidate)
    }
  }
  return real(process.argv[1]) === real(fileURLToPath(import.meta.url))
}

const invokedDirectly = isEntryPoint()

if (invokedDirectly) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    // A CliError is a failure we chose and already have a sentence for. Anything
    // else escaped the per-target handling — still a sentence rather than a
    // stack trace, over a tool people run from a package script.
    console.error(
      error instanceof CliError
        ? `\n  data-seed: ${error.message}\n`
        : `\n  data-seed: unexpected error: ${reason(error)}\n`,
    )
    process.exitCode = 1
  }
}
