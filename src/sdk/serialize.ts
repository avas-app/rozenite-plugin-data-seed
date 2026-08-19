import type { SerializedPayload } from '../shared/types'

/**
 * Turns arbitrary query data into something the Rozenite bridge can carry.
 *
 * Query caches hold whatever the app's `queryFn` returned, which in practice
 * means `Date`s, `Map`s, class instances from an SDK, and — often enough to
 * matter — cycles from a normalized store. `postMessage` structured-clone
 * chokes on functions and throws on cycles, so nothing here may reach the
 * bridge unflattened.
 *
 * The output is deliberately lossy in one direction only: what comes back is
 * always valid JSON, so a value the panel round-trips into a seed is a value
 * the app can actually receive.
 */

/** Above this, a preview is clipped. Full reads use `MAX_FULL_BYTES`. */
const MAX_PREVIEW_BYTES = 4 * 1024

/**
 * Ceiling for a full read. Large enough for a realistic list response, small
 * enough that a runaway cache entry cannot wedge the DevTools connection.
 */
const MAX_FULL_BYTES = 512 * 1024

/** Depth cap, so a self-referential structure cannot recurse forever. */
const MAX_DEPTH = 12

/** Element cap per array, so a 100k-row cache entry stays previewable. */
const MAX_ARRAY_LENGTH = 500

type Options = {
  /** Clip to a preview-sized payload rather than a full read. */
  preview?: boolean
}

export function serialize(
  value: unknown,
  options: Options = {},
): SerializedPayload {
  const limit = options.preview ? MAX_PREVIEW_BYTES : MAX_FULL_BYTES

  if (value === undefined) return { kind: 'undefined' }
  if (value === null) return { kind: 'null', value: null }

  const primitive = serializePrimitive(value)
  if (primitive) return primitive

  const notes: string[] = []
  let plain: unknown
  try {
    plain = toPlain(value, 0, new WeakSet(), notes)
  } catch (error) {
    return { kind: 'unserializable', note: describe(error) }
  }

  let encoded: string
  try {
    encoded = JSON.stringify(plain) ?? ''
  } catch (error) {
    // `toPlain` should have removed everything that can throw here, so reaching
    // this means an exotic getter or a `toJSON` that itself blew up.
    return { kind: 'unserializable', note: describe(error) }
  }

  const byteLength = encoded.length

  if (byteLength > limit) {
    // Re-walk with array caps rather than truncating the JSON string: a clipped
    // string is not parseable, and the panel has to be able to render this.
    const clipped = toPlain(value, 0, new WeakSet(), notes, true)
    notes.push(`clipped at ${limit} bytes`)
    return {
      kind: 'json',
      value: clipped,
      truncated: true,
      byteLength,
      note: notes.join('; ') || undefined,
    }
  }

  return {
    kind: 'json',
    value: plain,
    byteLength,
    note: notes.length ? notes.join('; ') : undefined,
  }
}

function serializePrimitive(value: unknown): SerializedPayload | null {
  switch (typeof value) {
    case 'string':
      return { kind: 'string', value, byteLength: value.length }
    case 'number':
      // `NaN` and the infinities are not JSON, and silently becoming `null` on
      // the far side would misrepresent the cache.
      return Number.isFinite(value)
        ? { kind: 'number', value }
        : { kind: 'unserializable', note: `non-finite number (${String(value)})` }
    case 'boolean':
      return { kind: 'boolean', value }
    case 'bigint':
      return { kind: 'unserializable', note: 'bigint' }
    case 'function':
      return { kind: 'unserializable', note: 'function' }
    case 'symbol':
      return { kind: 'unserializable', note: 'symbol' }
    default:
      return null
  }
}

/**
 * Recursively converts a value into JSON-safe plain data.
 *
 * Cycles resolve to a marker string rather than throwing, because a cycle in
 * one corner of a response should not cost you visibility into the rest of it.
 */
function toPlain(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  notes: string[],
  clip = false,
): unknown {
  if (value === null || value === undefined) return null

  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value as number) ? value : null
  if (type === 'bigint') return `[bigint ${String(value)}]`
  if (type === 'function' || type === 'symbol') return undefined

  if (depth >= MAX_DEPTH) {
    note(notes, `depth capped at ${MAX_DEPTH}`)
    return '[max depth]'
  }

  const object = value as object

  if (seen.has(object)) {
    note(notes, 'contains cycles')
    return '[circular]'
  }
  seen.add(object)

  try {
    if (value instanceof Date) return value.toISOString()
    if (value instanceof Error) return { name: value.name, message: value.message }
    if (value instanceof Map) {
      note(notes, 'Map flattened to object')
      return Object.fromEntries(
        Array.from(value.entries(), ([k, v]) => [
          String(k),
          toPlain(v, depth + 1, seen, notes, clip),
        ]),
      )
    }
    if (value instanceof Set) {
      note(notes, 'Set flattened to array')
      return Array.from(value, (v) => toPlain(v, depth + 1, seen, notes, clip))
    }

    if (Array.isArray(value)) {
      const capped = clip && value.length > MAX_ARRAY_LENGTH
      const source = capped ? value.slice(0, MAX_ARRAY_LENGTH) : value
      if (capped) note(notes, `array of ${value.length} clipped to ${MAX_ARRAY_LENGTH}`)
      return source.map((v) => toPlain(v, depth + 1, seen, notes, clip))
    }

    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      // A getter can throw, and one bad property should not lose the object.
      let entry: unknown
      try {
        entry = toPlain(raw, depth + 1, seen, notes, clip)
      } catch (error) {
        entry = `[threw: ${describe(error)}]`
      }
      if (entry !== undefined) out[key] = entry
    }
    return out
  } finally {
    // Released on the way out so a value that legitimately appears twice in
    // different branches is not misreported as circular.
    seen.delete(object)
  }
}

function note(notes: string[], message: string): void {
  if (!notes.includes(message)) notes.push(message)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Best-effort byte size, used for seed row summaries where an exact figure does
 * not matter enough to justify a full serialize pass.
 */
export function approximateSize(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? '').length
  } catch {
    return 0
  }
}
