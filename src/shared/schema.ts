/**
 * The extracted-schema file format, and how a query key finds its schema.
 *
 * Written by `query-seed extract`, committed, and bundled with the app exactly
 * like fixtures are — the panel cannot read the repo, but Metro can bundle it.
 */

/** A JSON Schema node, kept loose because it comes from a generator. */
export type SchemaNode = {
  type?: string | string[]
  properties?: Record<string, SchemaNode>
  required?: string[]
  items?: SchemaNode | SchemaNode[]
  additionalProperties?: boolean | SchemaNode
  anyOf?: SchemaNode[]
  oneOf?: SchemaNode[]
  allOf?: SchemaNode[]
  enum?: unknown[]
  const?: unknown
  $ref?: string
  format?: string
  description?: string
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  /** Our `@faker` JSDoc tag, surfaced by ts-json-schema-generator's extraTags. */
  faker?: string
  [key: string]: unknown
}

export type SchemaDocument = SchemaNode & {
  definitions?: Record<string, SchemaNode>
}

export const SCHEMAS_VERSION = 1

/**
 * One query key pattern and the type its response has.
 *
 * `pattern` is a query key with `"*"` standing for any single element, so
 * `["user", "*"]` covers `["user", 7]` without an entry per user. Nothing infers
 * this mapping — TypeScript has no idea which type belongs to which key — so it
 * is written by hand in `query-seed.config.json` and is the one piece of this
 * feature that cannot be derived.
 */
export type SchemaEntry = {
  pattern: unknown[]
  /** The TypeScript type name, for display. */
  type: string
  schema: SchemaDocument
}

export type SchemasFile = {
  version: number
  generatedAt: string
  entries: SchemaEntry[]
}

/** The wildcard element in a pattern. */
export const WILDCARD = '*'

/**
 * Matches a concrete query key against a pattern.
 *
 * Length must match exactly. A pattern shorter than the key would make
 * `["user"]` capture `["user", 7, "posts"]`, which is how a list schema ends up
 * generating data for a detail route.
 */
export function matchesPattern(pattern: unknown[], queryKey: unknown[]): boolean {
  if (pattern.length !== queryKey.length) return false
  return pattern.every((part, index) => {
    if (part === WILDCARD) return true
    try {
      return JSON.stringify(part) === JSON.stringify(queryKey[index])
    } catch {
      return false
    }
  })
}

/**
 * Finds the entry whose pattern covers a key.
 *
 * Generic over the entry shape because the panel holds only `{pattern, type}`
 * summaries while the device holds full schemas, and both need the same
 * matching rules — duplicating them is how the two ends drift apart.
 *
 * Exact patterns win over wildcards, so a hand-written entry for one specific
 * key can override the general one without depending on file order.
 */
export function findByPattern<T extends { pattern: unknown[] }>(
  entries: T[],
  queryKey: unknown[],
): T | null {
  const matches = entries.filter((entry) => matchesPattern(entry.pattern, queryKey))
  if (matches.length === 0) return null
  return matches.reduce((best, entry) =>
    wildcardCount(entry.pattern) < wildcardCount(best.pattern) ? entry : best,
  )
}


function wildcardCount(pattern: unknown[]): number {
  return pattern.filter((part) => part === WILDCARD).length
}

export function parseSchemasFile(raw: unknown): SchemasFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('schemas file must be a JSON object')
  }
  const candidate = raw as Partial<SchemasFile>
  if (!Array.isArray(candidate.entries)) {
    throw new Error('schemas file is missing an entries array')
  }
  if (typeof candidate.version === 'number' && candidate.version > SCHEMAS_VERSION) {
    throw new Error(
      `schemas file was written by a newer plugin (v${candidate.version}); upgrade to read it`,
    )
  }
  return {
    version: candidate.version ?? SCHEMAS_VERSION,
    generatedAt: candidate.generatedAt ?? '',
    entries: candidate.entries,
  }
}
