import type { SchemaDocument, SchemaNode } from './schema'

/**
 * Turns an extracted JSON Schema into plausible fake data.
 *
 * Deliberately has no `@faker-js/faker` dependency. Faker is several megabytes
 * for a panel that needs perhaps thirty generators, and bringing it in would
 * cost more than it gives. The token *names* below are faker-shaped on purpose,
 * so `person.fullName` means what you would guess, but every implementation is
 * local and this list is the whole of it.
 *
 * That is why the annotation is `@fake` and not `@faker`: the old spelling named
 * a library that was never involved, which is misleading in exactly the place
 * someone would go looking for faker's full API. `@faker` is still read, so no
 * existing annotation breaks.
 *
 * Generation is seeded and therefore reproducible: the same schema and seed
 * produce the same object every time. That is what makes "reroll" a deliberate
 * action rather than something that happens invisibly on every render, and it
 * keeps a generated fixture stable when you save it.
 */

export type GenerateOptions = {
  /** Any string. The same seed always yields the same value. */
  seed?: string
  /** Elements produced for an array with no `minItems`. */
  arrayLength?: number
  /**
   * How deep to follow `$ref` cycles before stopping. A self-referential type
   * like a comment tree is otherwise unbounded.
   */
  maxDepth?: number
  /**
   * Which branch of an `anyOf`/`oneOf` to take, by index. Unset picks one from
   * the seed — deterministic, but not something you can aim at, which is why
   * the panel exposes this as a control.
   */
  variant?: number
}

const DEFAULTS = {
  arrayLength: 3,
  maxDepth: 6,
} as const

/**
 * A hard ceiling on how many elements any one array gets.
 *
 * `minItems` comes off a committed schemas file and `arrayLength` comes from a
 * caller — the agent tools pass it straight through, and they run on the
 * device. Neither is a trusted number, and a big enough one is not slow, it is
 * an out-of-memory crash in the app. Clamping warns rather than failing, since
 * a shorter array is still a usable seed.
 */
const MAX_ARRAY_ITEMS = 1000

/** What the generator could not do, so the panel can say so rather than lie. */
export type GenerateWarning = {
  path: string
  reason: string
}

export type GenerateResult = {
  value: unknown
  warnings: GenerateWarning[]
}

export function generate(
  document: SchemaDocument,
  options: GenerateOptions = {},
): GenerateResult {
  const random = makeRandom(options.seed ?? 'data-seed')
  const warnings: GenerateWarning[] = []
  const context = {
    document,
    random,
    warnings,
    arrayLength: options.arrayLength ?? DEFAULTS.arrayLength,
    maxDepth: options.maxDepth ?? DEFAULTS.maxDepth,
    variant: options.variant,
  }
  const value = build(document, context, '$', 0, new Map())
  return { value, warnings }
}

type Context = {
  document: SchemaDocument
  random: () => number
  warnings: GenerateWarning[]
  arrayLength: number
  maxDepth: number
  variant?: number
}

function build(
  node: SchemaNode,
  context: Context,
  path: string,
  depth: number,
  seen: Map<string, number>,
): unknown {
  // A node is normally an object, but the document comes off disk and a
  // hand-edited or truncated one puts a `null` where a subschema should be.
  // Warning and moving on keeps the surrounding object generating.
  if (!node || typeof node !== 'object') {
    context.warnings.push({ path, reason: 'schema node is not an object' })
    return null
  }

  if (node.$ref) {
    const resolved = resolveRef(node.$ref, context.document)
    if (!resolved) {
      context.warnings.push({ path, reason: `unresolved $ref ${node.$ref}` })
      return null
    }
    // Recursion is bounded per-reference rather than globally: a wide object
    // graph should not be cut short just because one branch is deep.
    const visits = seen.get(node.$ref) ?? 0
    if (visits >= context.maxDepth) return terminate(resolved)
    const next = new Map(seen)
    next.set(node.$ref, visits + 1)
    return build(resolved, context, path, depth + 1, next)
  }

  if (node.const !== undefined) return node.const
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return pick(node.enum, context.random)
  }

  const branches = node.anyOf ?? node.oneOf
  if (branches && branches.length > 0) {
    const index =
      context.variant !== undefined
        ? Math.min(Math.max(context.variant, 0), branches.length - 1)
        : Math.floor(context.random() * branches.length)
    return build(branches[index], context, path, depth, seen)
  }

  if (node.allOf && node.allOf.length > 0) {
    // Intersections are merged shallowly, which covers the common case of a
    // base type extended with extra properties.
    return node.allOf.reduce<Record<string, unknown>>((merged, part) => {
      const value = build(part, context, path, depth, seen)
      return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...merged, ...(value as Record<string, unknown>) }
        : merged
    }, {})
  }

  const tag = readTag(node)
  if (tag) {
    const value = fromToken(tag.value, context.random)
    if (value !== undefined) return value
    context.warnings.push({
      path,
      reason: `unknown @${tag.tag} token "${tag.value}"${suggest(tag.value)}`,
    })
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type

  switch (type) {
    case 'object':
      return buildObject(node, context, path, depth, seen)
    case 'array':
      return buildArray(node, context, path, depth, seen)
    case 'string':
      return buildString(node, context, path)
    case 'number':
    case 'integer':
      return buildNumber(node, context)
    case 'boolean':
      return context.random() > 0.5
    case 'null':
      return null
    default:
      // No `type` at all means the source was `any` or `unknown`. There is
      // nothing to generate from, and inventing a shape would be worse than
      // saying so — this is the single most common hole in a real codebase.
      context.warnings.push({
        path,
        reason: 'no type information (the source is `any` or `unknown`)',
      })
      return null
  }
}

function buildObject(
  node: SchemaNode,
  context: Context,
  path: string,
  depth: number,
  seen: Map<string, number>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const properties = node.properties ?? {}
  const required = new Set(node.required ?? [])

  for (const [key, child] of Object.entries(properties)) {
    // Optional properties are included anyway. A generated object exists to
    // exercise a screen, and omitting half its fields would mostly exercise the
    // empty states you were not trying to look at.
    void required
    out[key] = build(child, context, `${path}.${key}`, depth, seen)
  }
  return out
}

function buildArray(
  node: SchemaNode,
  context: Context,
  path: string,
  depth: number,
  seen: Map<string, number>,
): unknown[] {
  const items = Array.isArray(node.items) ? node.items[0] : node.items
  if (!items) return []
  const requested = Math.max(
    node.minItems ?? 0,
    Math.min(node.maxItems ?? context.arrayLength, context.arrayLength),
  )
  const length = Math.min(requested, MAX_ARRAY_ITEMS)
  if (length < requested) {
    context.warnings.push({
      path,
      reason: `array clamped to ${MAX_ARRAY_ITEMS} items (asked for ${requested})`,
    })
  }
  return Array.from({ length }, (_, index) =>
    build(items, context, `${path}[${index}]`, depth, seen),
  )
}

function buildString(node: SchemaNode, context: Context, path: string): string {
  switch (node.format) {
    case 'date-time':
      return isoDate(context.random, -30)
    case 'date':
      return isoDate(context.random, -30).slice(0, 10)
    case 'email':
      return token('internet.email', context.random) as string
    case 'uri':
    case 'url':
      return token('internet.url', context.random) as string
    case 'uuid':
      return token('string.uuid', context.random) as string
    default:
      break
  }
  // A bare `string` with no annotation and no format is genuinely ambiguous —
  // it may be a name, an ISO date, or an opaque id. Lorem is the honest answer;
  // a `@fake` tag is how you make it something better.
  void path
  return token('lorem.words', context.random) as string
}

/**
 * Whole numbers by default, including for `number`.
 *
 * TypeScript has one numeric type, so an id, a count, and a price all extract as
 * `"type": "number"` with nothing to tell them apart. In real API payloads the
 * overwhelming majority are integers, and `"id": 839.05` reads as broken data at
 * a glance. Anything that genuinely needs decimals says so with
 * `@faker number.float`.
 */
function buildNumber(node: SchemaNode, context: Context): number {
  const min = node.minimum ?? 1
  const max = node.maximum ?? 1000
  return Math.round(min + context.random() * (max - min))
}

/** Ends a recursive branch with an empty value of the right shape. */
function terminate(node: SchemaNode): unknown {
  const type = Array.isArray(node.type) ? node.type[0] : node.type
  if (type === 'array') return []
  if (type === 'object') return {}
  return null
}

function resolveRef(ref: string, document: SchemaDocument): SchemaNode | null {
  const match = /^#\/definitions\/(.+)$/.exec(ref)
  if (!match) return null
  // A hand-edited schemas file can hold a `$ref` that is not valid percent
  // encoding, and `decodeURIComponent` throws on those rather than returning
  // the input. The caller turns a null into a warning it can show; an exception
  // escapes into the panel's render and takes the whole panel down.
  let name: string
  try {
    name = decodeURIComponent(match[1])
  } catch {
    name = match[1]
  }
  return document.definitions?.[name] ?? null
}

// ---- tokens ----

/**
 * Parses `namespace.method` or `namespace.method({"min":1})` and dispatches.
 * Returns undefined for an unknown token so the caller can warn rather than
 * silently substituting something wrong.
 */
function fromToken(raw: string, random: () => number): unknown {
  const trimmed = raw.trim()
  const call = /^([\w.]+)\s*(?:\((.*)\))?$/.exec(trimmed)
  if (!call) return undefined
  const [, name, args] = call

  let parsed: Record<string, unknown> = {}
  if (args) {
    try {
      parsed = JSON.parse(args.replace(/([{,]\s*)(\w+):/g, '$1"$2":')) as Record<
        string,
        unknown
      >
    } catch {
      parsed = {}
    }
  }
  return token(name, random, parsed)
}

const FIRST = ['Ada', 'Grace', 'Alan', 'Katherine', 'Linus', 'Barbara', 'Ken', 'Radia']
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Torvalds', 'Liskov', 'Thompson', 'Perlman']
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit']
const CITIES = ['Lisbon', 'Osaka', 'Nairobi', 'Bogotá', 'Reykjavík', 'Hanoi']
const COUNTRIES = ['Portugal', 'Japan', 'Kenya', 'Colombia', 'Iceland', 'Vietnam']

function token(
  name: string,
  random: () => number,
  args: Record<string, unknown> = {},
): unknown {
  const first = () => pick(FIRST, random)
  const last = () => pick(LAST, random)

  switch (name) {
    case 'person.firstName':
      return first()
    case 'person.lastName':
      return last()
    case 'person.fullName':
      return `${first()} ${last()}`
    case 'internet.email':
      return `${first().toLowerCase()}.${last().toLowerCase()}@example.com`
    case 'internet.userName':
      return `${first().toLowerCase()}${Math.floor(random() * 100)}`
    case 'internet.url':
      return `https://example.com/${words(random, 1).replace(/\s/g, '-')}`
    case 'image.avatar':
      return `https://example.com/avatars/${Math.floor(random() * 1000)}.png`
    case 'string.uuid':
      return uuid(random)
    case 'string.alpha':
      return words(random, 1).replace(/\s/g, '').slice(0, num(args.length, 8))
    case 'lorem.words':
      return words(random, num(args.count, 3))
    case 'lorem.sentence': {
      const sentence = words(random, num(args.count, 8))
      return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
    }
    case 'lorem.paragraph':
      return Array.from({ length: 3 }, () => {
        const s = words(random, 10)
        return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
      }).join(' ')
    case 'date.recent':
      return isoDate(random, -7)
    case 'date.past':
      return isoDate(random, -365)
    case 'date.soon':
      return isoDate(random, 7)
    case 'date.future':
      return isoDate(random, 365)
    case 'number.int':
      return Math.round(
        num(args.min, 1) + random() * (num(args.max, 1000) - num(args.min, 1)),
      )
    case 'number.float': {
      const value = num(args.min, 0) + random() * (num(args.max, 1) - num(args.min, 0))
      return Math.round(value * 100) / 100
    }
    case 'datatype.boolean':
      return random() > 0.5
    case 'phone.number':
      return `+1 555 ${String(Math.floor(random() * 9000) + 1000)}`
    case 'location.city':
      return pick(CITIES, random)
    case 'location.country':
      return pick(COUNTRIES, random)
    case 'location.streetAddress':
      return `${Math.floor(random() * 900) + 100} ${last()} Street`
    default:
      return undefined
  }
}

/**
 * Suggests a real token for a misspelt one.
 *
 * A bare "unknown token" warning sends you to the README to find out that it is
 * `person.fullName` and not `name.fullName`; naming the likely candidate ends it
 * there. Matches on either half of the token, since the namespace is what people
 * usually get wrong.
 */
function suggest(raw: string): string {
  const name = raw.trim().split('(')[0]
  const [namespace, method] = name.split('.')
  const candidates = TOKEN_NAMES.filter((candidate) => {
    const [ns, m] = candidate.split('.')
    return ns === namespace || (method !== undefined && m === method)
  })
  if (candidates.length === 0) return ''
  return `. Did you mean ${candidates.slice(0, 3).join(', ')}?`
}

/**
 * The annotation on a node, and which spelling it used.
 *
 * `@fake` is canonical; `@faker` is the original spelling and still works. The
 * spelling is reported back so the shape preview can echo what the source
 * actually says rather than quietly rewriting it.
 */
export function readTag(node: SchemaNode): { tag: 'fake' | 'faker'; value: string } | null {
  if (typeof node.fake === 'string' && node.fake.trim()) {
    return { tag: 'fake', value: node.fake }
  }
  if (typeof node.faker === 'string' && node.faker.trim()) {
    return { tag: 'faker', value: node.faker }
  }
  return null
}

export type TokenDoc = {
  token: string
  /** What it produces, in one phrase. */
  summary: string
  /** Named arguments and their defaults, when it takes any. */
  args?: string
}

/**
 * Every token, with what it does — the single source of truth.
 *
 * The README table and the panel's reference are both built from this, and the
 * examples in them are produced by actually running `token()`. A hand-written
 * list of what a generator emits is wrong the first time someone edits the
 * generator and forgets the docs.
 */
export const TOKENS: readonly TokenDoc[] = [
  { token: 'person.firstName', summary: 'A first name' },
  { token: 'person.lastName', summary: 'A surname' },
  { token: 'person.fullName', summary: 'A first name and surname' },
  { token: 'internet.email', summary: 'An address at example.com' },
  { token: 'internet.userName', summary: 'A lowercase handle with digits' },
  { token: 'internet.url', summary: 'An https URL' },
  { token: 'image.avatar', summary: 'An avatar image URL' },
  { token: 'string.uuid', summary: 'A v4-shaped UUID' },
  { token: 'string.alpha', summary: 'Letters only', args: 'length = 8' },
  { token: 'lorem.words', summary: 'Space-separated words', args: 'count = 3' },
  { token: 'lorem.sentence', summary: 'One capitalised sentence', args: 'count = 8' },
  { token: 'lorem.paragraph', summary: 'Three sentences' },
  { token: 'date.recent', summary: 'ISO timestamp, up to a week before the epoch' },
  { token: 'date.past', summary: 'ISO timestamp, up to a year before the epoch' },
  { token: 'date.soon', summary: 'ISO timestamp, up to a week after the epoch' },
  { token: 'date.future', summary: 'ISO timestamp, up to a year after the epoch' },
  { token: 'number.int', summary: 'A whole number', args: 'min = 1, max = 1000' },
  { token: 'number.float', summary: 'A number with two decimals', args: 'min = 0, max = 1' },
  { token: 'datatype.boolean', summary: 'true or false' },
  { token: 'phone.number', summary: 'A +1 555 number' },
  { token: 'location.city', summary: 'A city name' },
  { token: 'location.country', summary: 'A country name' },
  { token: 'location.streetAddress', summary: 'A street address' },
]

/** Just the names, for `suggest()` and for validating an annotation. */
export const TOKEN_NAMES: readonly string[] = TOKENS.map((entry) => entry.token)

/**
 * One example of what a token produces, generated by running it.
 *
 * Seeded per token so the value is stable across runs — a docs table that
 * churns on every build stops being regenerated.
 */
export function sampleToken(name: string, seed = 'docs'): string {
  const value = token(name, makeRandom(`${seed}:${name}`))
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

// ---- deterministic randomness ----

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length) % values.length]
}

function words(random: () => number, count: number): string {
  return Array.from({ length: Math.max(1, count) }, () => pick(WORDS, random)).join(' ')
}

function uuid(random: () => number): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-'
    else if (i === 14) out += '4'
    else out += hex[Math.floor(random() * 16)]
  }
  return out
}

/**
 * A date offset from a fixed epoch rather than from `Date.now()`.
 *
 * Generation has to be reproducible for the same seed, and a value derived from
 * the current time is the one thing that cannot be. The absolute dates are
 * arbitrary; what matters is that they are stable and correctly ordered.
 *
 * The consequence is worth stating, because it is the kind of thing that gets
 * read as a bug: `date.recent` drifts further into the past as real time moves
 * away from this constant, so a caller asserting "within the last hour" writes
 * a test that fails for reasons unconnected to their code. Bumping the epoch
 * would not fix that — it would go stale again, and it would change every
 * value already generated from a committed schema. `date.*` means "ordered
 * relative to the epoch", not "near now", and the token docs say so.
 */
export const DATE_EPOCH = Date.UTC(2026, 0, 1)

function isoDate(random: () => number, offsetDays: number): string {
  const jitter = random() * Math.abs(offsetDays) * 86_400_000
  const direction = offsetDays < 0 ? -1 : 1
  return new Date(DATE_EPOCH + direction * jitter).toISOString()
}

/** mulberry32 — small, fast, and good enough for fixture data. */
function makeRandom(seed: string): () => number {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i)
    state = Math.imul(state, 16777619)
  }
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
