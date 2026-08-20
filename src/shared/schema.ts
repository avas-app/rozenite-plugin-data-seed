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
 */
export const SCHEMAS_VERSION = 2

/**
 * One target pattern and the type its response has.
 *
 * `pattern` is either a query key with `"*"` standing for any single element
 * (`["user", "*"]` covers `["user", 7]`), or a route (`"GET /api/users/*"`).
 * Nothing infers this mapping — TypeScript has no idea which type belongs to
 * which key or URL — so it is written by hand in `data-seed.config.json` and is
 * the one piece of this feature that cannot be derived.
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
}

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
  return {
    version: candidate.version ?? SCHEMAS_VERSION,
    generatedAt: candidate.generatedAt ?? '',
    entries: (candidate.entries as SchemaEntryJson[]).map((entry, index) => {
      try {
        return { ...entry, pattern: parseTargetPattern(entry.pattern) }
      } catch (error) {
        throw new Error(
          `schemas file entry ${index}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }),
  }
}

export function serializeSchemaEntry(entry: SchemaEntry): SchemaEntryJson {
  return { ...entry, pattern: serializeTargetPattern(entry.pattern) }
}
