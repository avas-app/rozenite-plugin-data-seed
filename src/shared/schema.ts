/**
 * The extracted-schema file format, and how a target finds its schema.
 *
 * Written by `data-seed extract`, committed, and bundled with the app exactly
 * like fixtures are — the panel cannot read the repo, but Metro can bundle it.
 */

import type { TargetPattern, TargetPatternJson } from './target'
import { parseTargetPattern, serializeTargetPattern } from './target'

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
  /** Our `@fake` JSDoc tag, surfaced by ts-json-schema-generator's extraTags. */
  fake?: string
  /** The original spelling of `@fake`, still read so old annotations work. */
  faker?: string
  [key: string]: unknown
}

export type SchemaDocument = SchemaNode & {
  definitions?: Record<string, SchemaNode>
}

/**
 * Bumped to 2 when patterns stopped being query-key arrays only.
 *
 * A v1 file still reads correctly — its array patterns mean exactly what they
 * always did — but a v2 file may contain route strings, which a v1 reader would
 * silently fail to match rather than reject.
 *
 * Not bumped for `{"name": …}` patterns: an older reader rejects just that
 * entry and loads the rest.
 */
export const SCHEMAS_VERSION = 2

/**
 * One target pattern and the type its response has.
 *
 * `pattern` is a query key with `"*"` standing for any single element
 * (`["user", "*"]` covers `["user", 7]`), a route (`"GET /api/users/*"`), or
 * `{"name": …}` for a type that has no address at all. Nothing infers this
 * mapping — TypeScript has no idea which type belongs to which key or URL — so
 * it is written by hand in `data-seed.config.json` and is the one piece of this
 * feature that cannot be derived.
 */
export type SchemaEntry = {
  pattern: TargetPattern
  /** The TypeScript type name, for display. */
  type: string
  schema: SchemaDocument
}

/** The entry as it appears on disk, where a pattern is an array or a string. */
export type SchemaEntryJson = {
  pattern: TargetPatternJson
  type: string
  schema: SchemaDocument
}

export type SchemasFile = {
  version: number
  generatedAt: string
  entries: SchemaEntry[]
  /** Entries that could not be read, described. Never a reason to drop the rest. */
  problems: string[]
}

/**
 * Reads the schemas file, keeping every entry it can.
 *
 * Only a file that is unusable as a whole throws — wrong shape, or written by a
 * newer plugin. A single malformed entry is skipped and described, because the
 * alternative is that one bad pattern in a fifty-target file silently costs you
 * generation for all fifty.
 */
export function parseSchemasFile(raw: unknown): SchemasFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('schemas file must be a JSON object')
  }
  const candidate = raw as {
    version?: number
    generatedAt?: string
    entries?: unknown
  }
  if (!Array.isArray(candidate.entries)) {
    throw new Error('schemas file is missing an entries array')
  }
  if (typeof candidate.version === 'number' && candidate.version > SCHEMAS_VERSION) {
    throw new Error(
      `schemas file was written by a newer plugin (v${candidate.version}); upgrade to read it`,
    )
  }

  const entries: SchemaEntry[] = []
  const problems: string[] = []

  ;(candidate.entries as unknown[]).forEach((raw, index) => {
    const entry = raw as Partial<SchemaEntryJson> | null
    if (!entry || typeof entry !== 'object') {
      problems.push(`entry ${index}: must be an object`)
      return
    }
    if (!entry.schema || typeof entry.schema !== 'object') {
      // Generation reads this document directly, so a missing one is not a
      // schema that produces nothing — it is a crash at seed time.
      problems.push(`entry ${index}: has no schema object`)
      return
    }
    try {
      entries.push({
        ...(entry as SchemaEntryJson),
        type: typeof entry.type === 'string' ? entry.type : 'unknown',
        pattern: parseTargetPattern(entry.pattern as TargetPatternJson),
      })
    } catch (error) {
      problems.push(
        `entry ${index}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  return {
    version: candidate.version ?? SCHEMAS_VERSION,
    generatedAt: candidate.generatedAt ?? '',
    entries,
    problems,
  }
}

export function serializeSchemaEntry(entry: SchemaEntry): SchemaEntryJson {
  return { ...entry, pattern: serializeTargetPattern(entry.pattern) }
}
