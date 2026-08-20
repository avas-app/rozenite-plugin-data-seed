import type {
  AdapterInfo,
  BundledFixture,
  Capabilities,
  FixtureProblem,
  TargetSnapshot,
  SeedMeta,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
  SchemaSummary,
  SourceFrame,
} from '../shared/types'
import { splitTargetId, targetId } from '../shared/types'
import type { LoadedFixtures } from './fixtures'
import type { Fixture } from '../shared/fixture'
import type { SchemaEntry } from '../shared/schema'
import type { SeedTarget, TargetRef } from '../shared/target'
import { findByTarget, formatRef } from '../shared/target'
import { approximateSize, serialize } from './serialize'

/**
 * Everything the panel can observe or drive, held independently of the bridge.
 *
 * The session outlives any particular panel connection on purpose: DevTools can
 * be closed and reopened, or reload itself, and seeds must survive that. A seed
 * that vanished because you refreshed the inspector would be worse than no seed
 * at all, because you would not notice.
 *
 * It is also the only place that knows more than one adapter exists. Adapters
 * register themselves, own their identity scheme, and read their own seeds; the
 * session routes between them and owns nothing transport-specific.
 */

export type Seed = {
  target: SeedTarget
  /** The value handed back to the app, already plain JSON from the panel. */
  data: unknown
  /** Transport detail an adapter may read, such as an HTTP status. */
  meta?: SeedMeta
  appliedAt: number
}

/**
 * An adapter's view of its own seeds.
 *
 * Two access patterns, because the adapters genuinely differ: React Query looks
 * up a resolved `queryHash` on every option resolution and needs a single Map
 * hit with no allocation, while the HTTP adapter has to match an observed URL
 * against every stored *pattern* and therefore scans. Requests are orders of
 * magnitude rarer than renders, so the scan is not on a hot path.
 */
export type SeedReader = {
  get: (identity: string) => Seed | undefined
  entries: () => Array<[string, Seed]>
  readonly size: number
}

/**
 * One way of seeding, contributed by `adapters/*`.
 *
 * `push` and `invalidate` are optional on purpose. They describe a *cache* —
 * write a value in now, force a real fetch when the seed is withdrawn — and the
 * HTTP adapter has neither. It only intercepts, so its seed takes effect on the
 * next request and withdrawing it needs no cleanup. Making them optional is
 * what keeps that honest rather than stubbing them out.
 */
export type SeedAdapter = {
  id: string
  label: string
  /** True when seeds survive refetching rather than being one-shot writes. */
  intercept: boolean
  /** True when targets can be listed before anything has used them. */
  enumerable: boolean
  /**
   * This adapter's stable identity for a ref, or null when it cannot address
   * it — which is how a ref is routed to the adapter that owns it.
   */
  identify: (ref: TargetRef) => string | null
  listTargets: () => TargetSnapshot[]
  /** Reads one target's current data, unclipped, for the panel's editor. */
  readData: (identity: string) => SerializedPayload
  /** Writes a seed into the cache immediately and stops any in-flight fetch. */
  push?: (ref: TargetRef, data: unknown) => void
  /** Forces a real fetch, used after a seed is withdrawn. */
  invalidate?: (ref: TargetRef) => void
}

export type SessionSink = {
  targets: (targets: TargetSnapshot[]) => void
  seeds: (seeds: SeedSnapshot[]) => void
  fixtures: (fixtures: BundledFixture[], problems: FixtureProblem[]) => void
  capabilities: (capabilities: Capabilities) => void
}

/** Coalescing window for cache events. */
const FLUSH_MS = 100

export class Session {
  /** adapter id -> identity -> seed. Nested so an adapter reads only its own. */
  #seeds = new Map<string, Map<string, Seed>>()
  #adapters = new Map<string, SeedAdapter>()
  #sink: SessionSink | null = null
  #fixtures: LoadedFixtures = { summaries: [], problems: [], byId: new Map() }
  #frames: SourceFrame[] = []
  #schemas: SchemaEntry[] = []
  #hasFixtures = false
  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false

  // ---- adapters ----

  /**
   * Registers an adapter and returns the function that removes it.
   *
   * Seeds are deliberately *not* dropped on unregister. Fast Refresh remounts
   * the hook, which disposes and re-instruments; dropping seeds there would
   * silently revert the app to live data on every save.
   */
  registerAdapter(adapter: SeedAdapter): () => void {
    this.#adapters.set(adapter.id, adapter)
    if (!this.#seeds.has(adapter.id)) this.#seeds.set(adapter.id, new Map())
    this.#emitCapabilities()
    this.scheduleFlush()
    return () => {
      if (this.#adapters.get(adapter.id) === adapter) {
        this.#adapters.delete(adapter.id)
        this.#emitCapabilities()
      }
    }
  }

  /** The seed view handed to an adapter at construction. */
  seedReader(adapterId: string): SeedReader {
    if (!this.#seeds.has(adapterId)) this.#seeds.set(adapterId, new Map())
    const map = this.#seeds.get(adapterId) as Map<string, Seed>
    return {
      get: (identity) => map.get(identity),
      entries: () => Array.from(map.entries()),
      get size() {
        return map.size
      },
    }
  }

  get adapters(): AdapterInfo[] {
    return Array.from(this.#adapters.values(), (adapter) => ({
      id: adapter.id,
      label: adapter.label,
      intercept: adapter.intercept,
      enumerable: adapter.enumerable,
    }))
  }

  /**
   * Finds the adapter that can address a ref.
   *
   * Explicit `adapter` wins; otherwise the first that claims it. Kinds do not
   * overlap between the current adapters, so the search is unambiguous today —
   * `adapter` exists for when SWR lands and two of them answer to `key`.
   */
  #resolve(target: SeedTarget): { adapter: SeedAdapter; identity: string } | null {
    if (target.adapter) {
      const adapter = this.#adapters.get(target.adapter)
      if (!adapter) return null
      const identity = adapter.identify(target.ref)
      return identity === null ? null : { adapter, identity }
    }
    for (const adapter of this.#adapters.values()) {
      const identity = adapter.identify(target.ref)
      if (identity !== null) return { adapter, identity }
    }
    return null
  }

  // ---- wiring ----

  setFrames(frames: SourceFrame[]): void {
    this.#frames = frames
  }

  setSchemas(entries: SchemaEntry[]): void {
    this.#schemas = entries
    this.#emitCapabilities()
  }

  /** The schema for one target, or null when nothing matches it. */
  schemaFor(ref: TargetRef): unknown | null {
    return findByTarget(this.#schemas, ref)?.schema ?? null
  }

  schemaEntryFor(ref: TargetRef): SchemaEntry | null {
    return findByTarget(this.#schemas, ref)
  }

  get schemaSummaries(): SchemaSummary[] {
    return this.#schemas.map((entry) => ({
      pattern: entry.pattern,
      type: entry.type,
    }))
  }

  setFixtures(fixtures: LoadedFixtures): void {
    this.#fixtures = fixtures
    this.#hasFixtures = true
    this.#emitCapabilities()
    this.#sink?.fixtures(fixtures.summaries, fixtures.problems)
  }

  readFixture(id: string): SerializedPayload {
    const fixture = this.#fixtures.byId.get(id)
    return fixture ? serialize(fixture.data) : { kind: 'undefined' }
  }

  get fixtureSummaries(): BundledFixture[] {
    return this.#fixtures.summaries
  }

  get fixtureProblems(): FixtureProblem[] {
    return this.#fixtures.problems
  }

  get capabilities(): Capabilities {
    return {
      adapters: this.adapters,
      fixtures: this.#hasFixtures,
      schemas: this.#schemas.length > 0,
    }
  }

  #emitCapabilities(): void {
    this.#sink?.capabilities(this.capabilities)
  }

  attachSink(sink: SessionSink | null): void {
    this.#sink = sink
  }

  dispose(): void {
    this.#disposed = true
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = null
    this.#sink = null
    this.#adapters.clear()
    this.#seeds.clear()
    this.#fixtures = { summaries: [], problems: [], byId: new Map() }
    this.#schemas = []
  }

  // ---- targets ----

  listTargets(): TargetSnapshot[] {
    const all: TargetSnapshot[] = []
    for (const adapter of this.#adapters.values()) {
      all.push(...adapter.listTargets())
    }
    return all
  }

  /** Resolves a ref the caller wrote to the id the panel and seeds use. */
  identify(target: SeedTarget): string | null {
    const resolved = this.#resolve(target)
    return resolved ? targetId(resolved.adapter.id, resolved.identity) : null
  }

  // ---- seeds ----

  get seedCount(): number {
    let total = 0
    for (const map of this.#seeds.values()) total += map.size
    return total
  }

  /**
   * Applies a seed, returning whether it will survive refetching.
   *
   * Null means no adapter could address the target — a caller asking for an
   * HTTP route with no HTTP adapter installed, which is worth reporting rather
   * than silently accepting.
   */
  apply(
    target: SeedTarget,
    data: unknown,
    meta?: SeedMeta,
  ): { id: string; persistent: boolean } | null {
    const resolved = this.#resolve(target)
    if (!resolved) return null
    const { adapter, identity } = resolved

    const stored: SeedTarget = { adapter: adapter.id, ref: target.ref }
    this.#seedsFor(adapter.id).set(identity, {
      target: stored,
      data,
      meta,
      appliedAt: Date.now(),
    })

    // Register before pushing: `push` writes through the cache, which triggers
    // the subscription and re-resolves options. If the seed were not in the map
    // yet, that pass would miss it and the very first refetch would win.
    adapter.push?.(target.ref, data)
    this.flush()
    return { id: targetId(adapter.id, identity), persistent: adapter.intercept }
  }

  /** Clears by the composed id the panel holds. */
  clear(id: string): boolean {
    const split = splitTargetId(id)
    if (!split) return false
    const map = this.#seeds.get(split.adapter)
    const seed = map?.get(split.identity)
    if (!map || !seed) return false
    map.delete(split.identity)
    // Withdrawing a seed leaves stale fake data sitting in a cache, so the
    // target has to go back to the network to become honest again. Adapters
    // that only intercept have nothing to undo.
    this.#adapters.get(split.adapter)?.invalidate?.(seed.target.ref)
    this.flush()
    return true
  }

  /** Clears by the target a caller wrote, since agents address refs, not ids. */
  clearByTarget(target: SeedTarget): boolean {
    const id = this.identify(target)
    return id ? this.clear(id) : false
  }

  clearAll(): number {
    let cleared = 0
    for (const [adapterId, map] of this.#seeds) {
      const adapter = this.#adapters.get(adapterId)
      for (const seed of map.values()) {
        adapter?.invalidate?.(seed.target.ref)
        cleared += 1
      }
      map.clear()
    }
    this.flush()
    return cleared
  }

  findSeed(id: string): Seed | undefined {
    const split = splitTargetId(id)
    return split ? this.#seeds.get(split.adapter)?.get(split.identity) : undefined
  }

  readData(id: string): SerializedPayload {
    // Prefer the seed itself: what you opened for editing should be what you
    // last applied, not the cache's copy, which an app mutation may have moved.
    const seed = this.findSeed(id)
    if (seed) return serialize(seed.data)
    const split = splitTargetId(id)
    if (!split) return { kind: 'undefined' }
    return (
      this.#adapters.get(split.adapter)?.readData(split.identity) ?? {
        kind: 'undefined',
      }
    )
  }

  #seedsFor(adapterId: string): Map<string, Seed> {
    let map = this.#seeds.get(adapterId)
    if (!map) {
      map = new Map()
      this.#seeds.set(adapterId, map)
    }
    return map
  }

  // ---- snapshots ----

  snapshot(): Snapshot {
    return {
      frames: this.#frames,
      targets: this.listTargets(),
      seeds: this.seedList(),
      fixtures: this.#fixtures.summaries,
      fixtureProblems: this.#fixtures.problems,
      schemas: this.schemaSummaries,
      capabilities: this.capabilities,
    }
  }

  seedList(): SeedSnapshot[] {
    const list: SeedSnapshot[] = []
    for (const [adapterId, map] of this.#seeds) {
      for (const [identity, seed] of map) {
        list.push({
          id: targetId(adapterId, identity),
          adapter: adapterId,
          ref: seed.target.ref,
          label: formatRef(seed.target.ref),
          appliedAt: seed.appliedAt,
          byteLength: approximateSize(seed.data),
          meta: seed.meta,
        })
      }
    }
    return list
  }

  /**
   * Schedules a push to the panel.
   *
   * Cache events arrive in bursts — a single screen mount can produce dozens
   * across a few milliseconds — and each flush walks every adapter. Coalescing
   * turns that burst into one message.
   */
  scheduleFlush(): void {
    if (this.#disposed || this.#flushTimer) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null
      this.flush()
    }, FLUSH_MS)
  }

  flush(): void {
    if (this.#disposed) return
    const sink = this.#sink
    if (!sink) return
    sink.targets(this.listTargets())
    sink.seeds(this.seedList())
  }

  /** Resolves a fixture by id first, then by exact name. */
  findFixture(reference: string): Fixture | null {
    const byId = this.#fixtures.byId.get(reference)
    if (byId) return byId
    const summary = this.#fixtures.summaries.find((item) => item.name === reference)
    return summary ? (this.#fixtures.byId.get(summary.id) ?? null) : null
  }
}
