/**
 * The wire contract shared by the React Native SDK and the DevTools panel.
 *
 * Everything crossing the Rozenite bridge is structured-clone'd, so every type
 * here must be plain JSON — no class instances, no functions, no cycles. Seeded
 * data is arbitrary app state and routinely violates all three, so the SDK
 * flattens it through `serialize.ts` before sending.
 */

import type { TargetPattern, TargetRef } from './target'

/** How a value survived serialization for transport. */
export type PayloadKind =
  | 'json'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'unserializable'

export type SerializedPayload = {
  kind: PayloadKind
  /** Structured value for `json`; the scalar itself for string/number/boolean. */
  value?: unknown
  /** Set when the value exceeded the size cap and was clipped for preview. */
  truncated?: boolean
  /** Approximate encoded size in bytes, measured before any truncation. */
  byteLength?: number
  /** Why serialization failed, or what was dropped when clipped. */
  note?: string
}

/** Borrowed from TanStack, and general enough that HTTP maps onto it cleanly. */
export type TargetStatus = 'pending' | 'success' | 'error'

/** Whether something is in flight right now. */
export type FetchStatus = 'fetching' | 'paused' | 'idle'

/**
 * The composed id the panel and the bridge use to name one seedable thing.
 *
 * A single opaque string rather than a pair, because it is also a React key, a
 * Map key, and the thing an `===` compares — all of which a two-field object
 * makes worse. Adapter ids never contain a colon; identities routinely do,
 * since they are URLs, so only the first colon separates.
 */
export function targetId(adapter: string, identity: string): string {
  return `${adapter}:${identity}`
}

export function splitTargetId(
  id: string,
): { adapter: string; identity: string } | null {
  const at = id.indexOf(':')
  if (at <= 0) return null
  return { adapter: id.slice(0, at), identity: id.slice(at + 1) }
}

/**
 * One row in the panel's target list.
 *
 * Deliberately carries only a *preview* of the data. Cache entries are
 * unbounded app state — a list screen can hold megabytes — and pushing all of
 * it on every event would swamp the bridge. The panel asks for the full value
 * with `seed:read-data` only when you open a target to edit it.
 */
export type TargetSnapshot = {
  /** `targetId(adapter, identity)`. Stable, and the row's React key. */
  id: string
  adapter: string
  ref: TargetRef
  /** Rendered form of `ref`, so the panel does not re-derive it per render. */
  label: string
  status: TargetStatus
  fetchStatus: FetchStatus
  /** `Date.now()` of the last write. */
  updatedAt: number
  /** True while a seed is intercepting this target. */
  seeded: boolean
  preview?: SerializedPayload
  /** Present when the target is in an error state. */
  error?: string
  /** Live subscribers. Cache-shaped adapters only. */
  observerCount?: number
  /** Times this route has been observed. HTTP only. */
  hits?: number
}

/**
 * A fixture that shipped inside the app bundle.
 *
 * Bundled fixtures are the default source: they come from a directory in the
 * consuming repo, so anyone who clones the project sees the same list with no
 * setup. Only *writing* a new one needs the panel's folder access.
 *
 * Like targets, the summary carries no `data` — a fixtures directory can hold
 * megabytes, and the panel asks for one value at a time with
 * `seed:read-fixture`.
 */
export type BundledFixture = {
  /** Key within the require.context, e.g. `./cart-with-50-items.json`. */
  id: string
  name: string
  target: TargetRef
  /** Rendered form of `target`, for the row. */
  label: string
  savedAt: string
  byteLength: number
}

/**
 * One frame of a stack captured on the device, in bundle coordinates.
 *
 * Only useful in combination with Metro's `/symbolicate`, which maps it back to
 * a real source file. The panel uses that to show where the project lives, so
 * the folder picker — which cannot be pre-navigated — at least has a path the
 * user can paste.
 */
export type SourceFrame = {
  file: string
  lineNumber: number
  column: number
}

/** A fixture file that could not be read, surfaced instead of silently hidden. */
export type FixtureProblem = {
  id: string
  reason: string
}

/**
 * A pattern that has an extracted schema, without the schema itself.
 *
 * Schemas are sent on request rather than in the snapshot for the same reason
 * data is: a real app's API surface produces a file far larger than anything
 * the panel needs at once, and it only ever generates for one target.
 */
export type SchemaSummary = {
  pattern: TargetPattern
  type: string
}

/** An active seed, as the panel lists it. */
export type SeedSnapshot = {
  id: string
  adapter: string
  ref: TargetRef
  label: string
  /** `Date.now()` when the seed was applied. */
  appliedAt: number
  /** Approximate size of the seeded value, for the panel's row summary. */
  byteLength: number
  meta?: SeedMeta
}

/**
 * One installed adapter, so the panel can group rows by where they came from
 * and explain per-adapter gaps rather than claiming one global capability.
 */
export type AdapterInfo = {
  id: string
  label: string
  /**
   * Seeds survive refetching. False means one-shot writes that the next fetch
   * overwrites — the panel says so instead of pretending.
   */
  intercept: boolean
  /**
   * Targets can be listed before anything uses them. False for HTTP, where a
   * route is only known once a request has gone out, which is why that adapter
   * needs a "seed a route you have not seen yet" affordance.
   */
  enumerable: boolean
}

/**
 * What the SDK managed to hook, so the panel can explain gaps honestly rather
 * than silently doing nothing.
 */
export type Capabilities = {
  adapters: AdapterInfo[]
  /** A fixtures directory was supplied, so the panel can list bundled fixtures. */
  fixtures: boolean
  /** Extracted schemas were supplied, so the panel can generate data. */
  schemas: boolean
}

/**
 * The full state of a session. Sent on connect and on explicit request, so a
 * panel that opens late (or reloads) sees everything rather than only what
 * happened to change since it attached.
 */
export type Snapshot = {
  /** Bundle-coordinate frames, for locating the project on disk. May be empty. */
  frames: SourceFrame[]
  targets: TargetSnapshot[]
  seeds: SeedSnapshot[]
  fixtures: BundledFixture[]
  fixtureProblems: FixtureProblem[]
  schemas: SchemaSummary[]
  capabilities: Capabilities
}

/** What a seed points at, as it crosses the bridge. */
export type SeedTargetJson = {
  /** Empty string means "whichever adapter claims the ref". */
  adapter: string
  ref: TargetRef
}

/**
 * Transport-level detail that is not part of the value itself.
 *
 * Kept beside `data` rather than wrapped around it so that `data` means the
 * same thing for every adapter — a response body, a cache value, the output of
 * the generator, the contents of a fixture. An envelope would make generated
 * data and seeded data two different shapes.
 *
 * Only the HTTP adapter reads this today; forcing a 500 is most of the reason
 * to seed a route at all.
 */
export type SeedMeta = {
  /** HTTP status to respond with. Defaults to 200. */
  status?: number
}

/**
 * The Rozenite bridge event map. `seed:*` names are prefixed to avoid
 * collisions if this map is ever merged with another plugin's.
 */
export type SeedEventMap = {
  // ---- React Native -> panel ----
  'seed:snapshot': Snapshot
  'seed:targets': { targets: TargetSnapshot[] }
  'seed:seeds': { seeds: SeedSnapshot[] }
  'seed:capabilities': Capabilities
  /** Reply to `seed:read-data`. `data` is serialized, not raw. */
  'seed:data': { id: string; data: SerializedPayload }
  'seed:fixtures': {
    fixtures: BundledFixture[]
    problems: FixtureProblem[]
  }
  /** Reply to `seed:read-fixture`. */
  'seed:fixture-data': { id: string; data: SerializedPayload }
  /** Reply to `seed:read-schema`. `schema` is null if nothing matches the ref. */
  'seed:schema': { ref: TargetRef; schema: unknown | null }

  // ---- panel -> React Native ----
  'seed:request-snapshot': Record<string, never>
  /**
   * Apply a seed. Addressed by `ref` rather than by id because the target may
   * not exist yet — seeding a query before its screen has ever mounted, or a
   * route before it has ever been requested, is a normal thing to want.
   */
  'seed:apply': { target: SeedTargetJson; data: unknown; meta?: SeedMeta }
  'seed:clear': { id: string }
  'seed:clear-all': Record<string, never>
  'seed:read-data': { id: string }
  'seed:read-fixture': { id: string }
  'seed:read-schema': { ref: TargetRef }
}

/**
 * Bridge identifier, matched on both ends of the DevTools connection.
 *
 * It only has to agree between the app and the panel, but it must not collide
 * with another plugin — so it mirrors the package name, which is what the
 * official Rozenite plugins do (`@rozenite/mmkv-plugin`, etc.). Keep it in step
 * with `name` in package.json.
 */
export const PLUGIN_ID = '@avasapp/rozenite-plugin-data-seed'
