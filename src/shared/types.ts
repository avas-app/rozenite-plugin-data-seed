/**
 * The wire contract shared by the React Native SDK and the DevTools panel.
 *
 * Everything crossing the Rozenite bridge is structured-clone'd, so every type
 * here must be plain JSON — no class instances, no functions, no cycles. Query
 * data is arbitrary app state and routinely violates all three, so the SDK
 * flattens it through `serialize.ts` before sending.
 */

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

/** Mirrors TanStack's `QueryStatus`. */
export type QueryStatus = 'pending' | 'success' | 'error'

/** Mirrors TanStack's `FetchStatus`. */
export type FetchStatus = 'fetching' | 'paused' | 'idle'

/**
 * One row in the panel's query list.
 *
 * Deliberately carries only a *preview* of the query's data. Cache entries are
 * unbounded app state — a list screen can hold megabytes — and pushing all of
 * it on every cache event would swamp the bridge. The panel asks for the full
 * value with `seed:read-data` only when you open a query to edit it.
 */
export type QuerySnapshot = {
  /**
   * TanStack's own hash of the query key, and the identity used everywhere in
   * this plugin. Computed by the library rather than by us, so it matches
   * whatever key-serialization the host app's version applies.
   */
  queryHash: string
  /** The key itself, for display. Already passed through `serialize`. */
  queryKey: unknown[]
  status: QueryStatus
  fetchStatus: FetchStatus
  /** Live `useQuery` subscribers. Zero means nothing on screen wants this. */
  observerCount: number
  /** `Date.now()` of the last successful write into the cache. */
  dataUpdatedAt: number
  /** True while a seed is intercepting this key. */
  seeded: boolean
  preview?: SerializedPayload
  /** Present when the query is in an error state. */
  error?: string
}

/**
 * A fixture that shipped inside the app bundle.
 *
 * Bundled fixtures are the default source: they come from a directory in the
 * consuming repo, so anyone who clones the project sees the same list with no
 * setup. Only *writing* a new one needs the panel's folder access.
 *
 * Like queries, the summary carries no `data` — a fixtures directory can hold
 * megabytes, and the panel asks for one value at a time with
 * `seed:read-fixture`.
 */
export type BundledFixture = {
  /** Key within the require.context, e.g. `./cart-with-50-items.json`. */
  id: string
  name: string
  queryKey: unknown[]
  savedAt: string
  byteLength: number
}

/** A fixture file that could not be read, surfaced instead of silently hidden. */
export type FixtureProblem = {
  id: string
  reason: string
}

/** An active seed, as the panel lists it. */
export type SeedSnapshot = {
  queryHash: string
  queryKey: unknown[]
  /** `Date.now()` when the seed was applied. */
  appliedAt: number
  /** Approximate size of the seeded value, for the panel's row summary. */
  byteLength: number
}

/**
 * What the SDK managed to hook, so the panel can explain gaps honestly rather
 * than silently doing nothing.
 */
export type Capabilities = {
  /** A fixtures directory was supplied, so the panel can list bundled fixtures. */
  fixtures: boolean
  /**
   * `queryClient.defaultQueryOptions` was wrappable, so seeds survive refetch.
   * When false the plugin degrades to one-shot `setQueryData` writes, which the
   * next refetch overwrites — the panel says so instead of pretending.
   */
  intercept: boolean
}

/**
 * The full state of a session. Sent on connect and on explicit request, so a
 * panel that opens late (or reloads) sees the whole cache rather than only the
 * queries that happened to change since it attached.
 */
export type Snapshot = {
  queries: QuerySnapshot[]
  seeds: SeedSnapshot[]
  fixtures: BundledFixture[]
  fixtureProblems: FixtureProblem[]
  capabilities: Capabilities
}

/**
 * The Rozenite bridge event map. `seed:*` names are prefixed to avoid
 * collisions if this map is ever merged with another plugin's.
 */
export type QuerySeedEventMap = {
  // ---- React Native -> panel ----
  'seed:snapshot': Snapshot
  'seed:queries': { queries: QuerySnapshot[] }
  'seed:seeds': { seeds: SeedSnapshot[] }
  /** Reply to `seed:read-data`. `data` is serialized, not raw. */
  'seed:data': { queryHash: string; data: SerializedPayload }
  'seed:fixtures': {
    fixtures: BundledFixture[]
    problems: FixtureProblem[]
  }
  /** Reply to `seed:read-fixture`. */
  'seed:fixture-data': { id: string; data: SerializedPayload }

  // ---- panel -> React Native ----
  'seed:request-snapshot': Record<string, never>
  /**
   * Apply a seed. Keyed by `queryKey` rather than `queryHash` because the key
   * may not be in the cache yet — seeding a query before its screen has ever
   * mounted is a normal thing to want.
   */
  'seed:apply': { queryKey: unknown[]; data: unknown }
  'seed:clear': { queryHash: string }
  'seed:clear-all': Record<string, never>
  'seed:read-data': { queryHash: string }
  'seed:read-fixture': { id: string }
}

/**
 * Bridge identifier, matched on both ends of the DevTools connection.
 *
 * It only has to agree between the app and the panel, but it must not collide
 * with another plugin — so it mirrors the package name, which is what the
 * official Rozenite plugins do (`@rozenite/mmkv-plugin`, etc.). Keep it in step
 * with `name` in package.json.
 */
export const PLUGIN_ID = '@avasapp/rozenite-plugin-query-seed'
