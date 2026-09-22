/**
 * What a seed points at, independent of the library that will serve it.
 *
 * The plugin started life against TanStack Query, where identity is a query key
 * and the cache can be enumerated before anything happens. HTTP interception is
 * shaped differently: there is no registry, identity is a URL, and you only
 * learn a route exists when a request goes out. This module is the seam between
 * the two — everything above it (schemas, generation, fixtures, the panel)
 * addresses a `TargetRef` and does not care which adapter serves it.
 */

/** Built-in adapter ids. Adapters are registered by string, not by enum. */
export const ADAPTER_REACT_QUERY = 'react-query'
export const ADAPTER_HTTP = 'http'

/**
 * How one seedable thing is addressed.
 *
 * `key` covers anything cache-shaped and array-addressed — TanStack query keys
 * today, SWR array keys when that adapter lands. SWR's *string* keys are
 * deliberately not folded in here: they are usually URLs and want glob matching,
 * but they are not necessarily HTTP, so they will get their own `kind` rather
 * than being squeezed into either of these.
 */
export type TargetRef =
  | { kind: 'key'; key: readonly unknown[] }
  | { kind: 'route'; method: string; url: string }

/** A `TargetRef` plus the adapter that owns it. */
export type SeedTarget = {
  adapter: string
  ref: TargetRef
}

/**
 * `SeedTarget` constructors.
 *
 * An empty `adapter` means "whichever adapter claims this ref", which is what
 * almost every caller wants — there is exactly one adapter per kind today, and
 * naming it at every call site would be noise that goes stale when SWR lands.
 */
export function keyTarget(key: readonly unknown[], adapter = ''): SeedTarget {
  return { adapter, ref: { kind: 'key', key } }
}

export function routeTarget(method: string, url: string, adapter = ''): SeedTarget {
  return { adapter, ref: { kind: 'route', method: method.toUpperCase(), url } }
}

/** One-line rendering for panel rows, agent output, and error messages. */
export function formatRef(ref: TargetRef): string {
  if (ref.kind === 'route') return `${ref.method} ${ref.url}`
  try {
    return JSON.stringify(ref.key)
  } catch {
    return String(ref.key)
  }
}

/**
 * Identity *within* an adapter.
 *
 * For keys this is only a fallback — the React Query adapter overrides it with
 * TanStack's own `queryHash`, so custom `queryKeyHashFn` settings are honoured
 * rather than second-guessed.
 */
export function refIdentity(ref: TargetRef): string {
  if (ref.kind === 'route') return `${ref.method} ${ref.url}`
  try {
    return JSON.stringify(ref.key)
  } catch {
    return String(ref.key)
  }
}

// ------------------------------------------------------------------ globs

/**
 * `*` matches within a path segment, `**` crosses segments.
 *
 * The distinction matters for the same reason key patterns must match length
 * exactly: without it, `/api/users/*` captures `/api/users/7/posts` and a list
 * schema quietly starts generating data for a detail route.
 */
function globToRegExp(glob: string): RegExp {
  let source = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
      continue
    }
    source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

/** The pathname of a URL, or the input unchanged when it will not parse. */
export function urlPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    // Relative URLs, and anything a host app passes to XHR.open directly.
    const withoutQuery = url.split(/[?#]/)[0]
    return withoutQuery || url
  }
}

function urlPathWithQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url.split('#')[0] || url
  }
}

// --------------------------------------------------------------- patterns

/**
 * A pattern that selects targets, as written in `data-seed.config.json` and
 * stored in the schemas file.
 *
 * Route patterns are strings like `GET /api/users/*`; key patterns are arrays
 * with `"*"` standing for one element.
 *
 * A `type` pattern selects nothing at all. It exists so the schemas file can
 * carry a schema for a type that has no query key and no URL — an envelope that
 * arrives over a websocket or a realtime channel, say. Nothing in this plugin
 * can seed one; the entry is there for whatever *does* own that transport to
 * read, which is why extraction is worth doing for it and matching is not.
 */
export type TargetPattern =
  | { kind: 'key'; key: unknown[] }
  | { kind: 'route'; method: string; glob: string }
  | { kind: 'type'; name: string }

/** The method wildcard, and the element wildcard in a key pattern. */
export const WILDCARD = '*'

/**
 * Parses `"GET /api/todos"`, or `"/api/todos"` for any method.
 *
 * A bare path is the common case and reads better in a config file, so an
 * omitted method means "any" rather than an error.
 */
export function parseRoutePattern(text: string): {
  method: string
  glob: string
} {
  const trimmed = text.trim()
  const match = /^([A-Za-z]+|\*)\s+(.*)$/.exec(trimmed)
  if (match) {
    return { method: match[1].toUpperCase(), glob: match[2].trim() }
  }
  return { method: WILDCARD, glob: trimmed }
}

export function formatRoutePattern(pattern: {
  method: string
  glob: string
}): string {
  return `${pattern.method} ${pattern.glob}`
}

/** How a pattern is shown in the panel and in agent output. */
export function formatPattern(pattern: TargetPattern): string {
  if (pattern.kind === 'route') return formatRoutePattern(pattern)
  if (pattern.kind === 'type') return pattern.name
  try {
    return JSON.stringify(pattern.key)
  } catch {
    return String(pattern.key)
  }
}

/**
 * Matches a route pattern against an observed request.
 *
 * The glob is tried against the full URL, the pathname, and the pathname with
 * its query string, so `/api/todos` matches regardless of origin while
 * `https://api.example.com/**` can still pin one host, and `?page=1` can be
 * matched when a caller genuinely wants to distinguish pages.
 */
export function matchesRoute(
  pattern: { method: string; glob: string },
  method: string,
  url: string,
): boolean {
  if (pattern.method !== WILDCARD && pattern.method !== method.toUpperCase()) {
    return false
  }
  const regexp = globToRegExp(pattern.glob)
  return (
    regexp.test(url) ||
    regexp.test(urlPath(url)) ||
    regexp.test(urlPathWithQuery(url))
  )
}

/**
 * Matches a concrete key against a key pattern.
 *
 * Length must match exactly. A pattern shorter than the key would make
 * `["user"]` capture `["user", 7, "posts"]`, which is how a list schema ends up
 * generating data for a detail route.
 */
export function matchesKey(pattern: unknown[], key: readonly unknown[]): boolean {
  if (pattern.length !== key.length) return false
  return pattern.every((part, index) => {
    if (part === WILDCARD) return true
    try {
      return JSON.stringify(part) === JSON.stringify(key[index])
    } catch {
      return false
    }
  })
}

/**
 * Whether a *seed's* ref covers a target.
 *
 * A route seed is stored as a pattern, so `GET /v1/profile` covers the observed
 * `GET https://api.example.invalid/v1/profile`. The panel needs the same rule
 * the HTTP adapter uses when it serves a request — with plain ref equality, a
 * row correctly badged "seeded" offers no way to remove that seed, and applying
 * an edit writes a *second* seed that the first one then shadows.
 */
export function refCovers(seed: TargetRef, ref: TargetRef): boolean {
  if (seed.kind === 'key') {
    return ref.kind === 'key' && formatRef(seed) === formatRef(ref)
  }
  return (
    ref.kind === 'route' &&
    matchesRoute(parseRoutePattern(`${seed.method} ${seed.url}`), ref.method, ref.url)
  )
}

export function matchesTarget(pattern: TargetPattern, ref: TargetRef): boolean {
  if (pattern.kind === 'key') {
    return ref.kind === 'key' && matchesKey(pattern.key, ref.key)
  }
  // A type pattern names a type, not an address, so no observed ref is it.
  // Returning false rather than throwing keeps such an entry inert: it rides
  // along in the schemas file and is skipped by every lookup here.
  if (pattern.kind === 'type') return false
  return ref.kind === 'route' && matchesRoute(pattern, ref.method, ref.url)
}

/**
 * How loose a pattern is. Lower wins, so a hand-written exact entry overrides a
 * general one without depending on file order.
 *
 * Route patterns count wildcards and weight `**` higher than `*`, since it
 * spans segments and is therefore the broader claim.
 */
export function patternLooseness(pattern: TargetPattern): number {
  if (pattern.kind === 'key') {
    return pattern.key.filter((part) => part === WILDCARD).length
  }
  // Never actually compared — `findByTarget` only ranks patterns that matched,
  // and a type pattern never does. Exact, because it names exactly one type.
  if (pattern.kind === 'type') return 0
  const doubles = (pattern.glob.match(/\*\*/g) ?? []).length
  const singles = (pattern.glob.match(/\*/g) ?? []).length - doubles * 2
  const anyMethod = pattern.method === WILDCARD ? 1 : 0
  return doubles * 2 + singles + anyMethod
}

/** Finds the most specific pattern covering a ref, or null. */
export function findByTarget<T extends { pattern: TargetPattern }>(
  entries: T[],
  ref: TargetRef,
): T | null {
  const matches = entries.filter((entry) => matchesTarget(entry.pattern, ref))
  if (matches.length === 0) return null
  return matches.reduce((best, entry) =>
    patternLooseness(entry.pattern) < patternLooseness(best.pattern) ? entry : best,
  )
}

// ------------------------------------------------------------ JSON on-wire

/**
 * Patterns are written by hand in JSON, where a key pattern is an array and a
 * route pattern is a string. Keeping the authored form that terse matters more
 * than symmetry — `["user", "*"]` and `"GET /api/users/*"` both read as what
 * they are, where a tagged object would read as neither.
 *
 * A type pattern is the one that has to be tagged: `{"name": "RealtimePayload"}`
 * is neither an array nor a path, and spelling it as a bare string would make
 * it indistinguishable from a route that forgot its leading slash.
 */
export type TargetPatternJson = unknown[] | string | { name: string }

export function parseTargetPattern(raw: TargetPatternJson): TargetPattern {
  if (Array.isArray(raw)) return { kind: 'key', key: raw }
  if (typeof raw === 'string') return { kind: 'route', ...parseRoutePattern(raw) }
  if (raw && typeof raw === 'object') {
    const { name } = raw as { name?: unknown }
    if (typeof name === 'string' && name.trim() !== '') {
      return { kind: 'type', name: name.trim() }
    }
    throw new Error('a {"name": …} pattern needs a non-empty name')
  }
  throw new Error(
    'a pattern must be an array (query key), a string (route), or {"name": …} (type)',
  )
}

export function serializeTargetPattern(
  pattern: TargetPattern,
): TargetPatternJson {
  if (pattern.kind === 'key') return pattern.key
  if (pattern.kind === 'type') return { name: pattern.name }
  return formatRoutePattern(pattern)
}

/** The same two-form rule for refs, used by fixtures and the bridge. */
export type TargetRefJson =
  | { kind: 'key'; key: unknown[] }
  | { kind: 'route'; method: string; url: string }

export function parseTargetRef(raw: unknown): TargetRef {
  if (Array.isArray(raw)) return { kind: 'key', key: raw }
  if (!raw || typeof raw !== 'object') {
    throw new Error('a target must be an object or a query key array')
  }
  const candidate = raw as Partial<TargetRefJson>
  if (candidate.kind === 'route') {
    if (typeof candidate.url !== 'string') {
      throw new Error('a route target needs a url')
    }
    return {
      kind: 'route',
      method: (candidate.method ?? 'GET').toUpperCase(),
      url: candidate.url,
    }
  }
  if (candidate.kind === 'key') {
    if (!Array.isArray(candidate.key)) {
      throw new Error('a key target needs a key array')
    }
    return { kind: 'key', key: candidate.key }
  }
  throw new Error(`unknown target kind: ${String(candidate.kind)}`)
}
