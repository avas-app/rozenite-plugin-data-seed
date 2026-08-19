import type {
  BundledFixture,
  Capabilities,
  FixtureProblem,
  QuerySnapshot,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
  SourceFrame,
} from '../shared/types'
import type { LoadedFixtures } from './fixtures'
import { approximateSize, serialize } from './serialize'

/**
 * Everything the panel can observe or drive, held independently of the bridge.
 *
 * The session outlives any particular panel connection on purpose: DevTools can
 * be closed and reopened, or reload itself, and seeds must survive that. A seed
 * that vanished because you refreshed the inspector would be worse than no seed
 * at all, because you would not notice.
 */

export type Seed = {
  queryKey: readonly unknown[]
  /** The value handed back to the app, already plain JSON from the panel. */
  data: unknown
  appliedAt: number
}

/**
 * The cache operations the session needs, supplied by `instrumentClient`.
 *
 * Keeping these behind an interface is what lets the session be tested without
 * a real `QueryClient`, and keeps every TanStack-shaped assumption in one file.
 */
export type SeedDriver = {
  /** Resolves a key to the hash TanStack itself would compute for it. */
  hashKey: (queryKey: readonly unknown[]) => string
  listQueries: () => QuerySnapshot[]
  /** Reads one query's current data, unclipped, for the panel's editor. */
  readData: (queryHash: string) => SerializedPayload
  /** Writes a seed into the cache immediately and stops any in-flight fetch. */
  push: (queryKey: readonly unknown[], data: unknown) => void
  /** Forces a real refetch, used after a seed is withdrawn. */
  invalidate: (queryKey: readonly unknown[]) => void
}

export type SessionSink = {
  queries: (queries: QuerySnapshot[]) => void
  seeds: (seeds: SeedSnapshot[]) => void
  fixtures: (fixtures: BundledFixture[], problems: FixtureProblem[]) => void
}

/** Coalescing window for cache events. */
const FLUSH_MS = 100

export class Session {
  #seeds = new Map<string, Seed>()
  #driver: SeedDriver | null = null
  #sink: SessionSink | null = null
  #capabilities: Capabilities = { intercept: false, fixtures: false }
  #fixtures: LoadedFixtures = { summaries: [], problems: [], byId: new Map() }
  #frames: SourceFrame[] = []
  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false

  // ---- wiring ----

  /**
   * Capabilities are merged rather than replaced: interception is discovered by
   * `instrumentClient`, fixtures are supplied by the hook, and neither should
   * be able to clear the other's finding by attaching later.
   */
  attachDriver(driver: SeedDriver | null, capabilities: Partial<Capabilities>): void {
    this.#driver = driver
    this.#capabilities = { ...this.#capabilities, ...capabilities }
  }

  setFrames(frames: SourceFrame[]): void {
    this.#frames = frames
  }

  setFixtures(fixtures: LoadedFixtures): void {
    this.#fixtures = fixtures
    this.#capabilities = { ...this.#capabilities, fixtures: true }
    const sink = this.#sink
    if (sink) sink.fixtures(fixtures.summaries, fixtures.problems)
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

  attachSink(sink: SessionSink | null): void {
    this.#sink = sink
  }

  dispose(): void {
    this.#disposed = true
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = null
    this.#sink = null
    this.#driver = null
    this.#seeds.clear()
    this.#fixtures = { summaries: [], problems: [], byId: new Map() }
  }

  // ---- seed registry (read by the interceptor on every query resolution) ----

  /**
   * Hot path: called for every option resolution TanStack performs, which is
   * several times per render for a busy screen. A plain `Map` lookup is the
   * entire cost, which is why seeds are keyed by hash rather than matched.
   */
  getSeed(queryHash: string): Seed | undefined {
    return this.#seeds.get(queryHash)
  }

  get seedCount(): number {
    return this.#seeds.size
  }

  apply(queryKey: readonly unknown[], data: unknown): void {
    const driver = this.#driver
    if (!driver) return

    const queryHash = driver.hashKey(queryKey)
    this.#seeds.set(queryHash, { queryKey, data, appliedAt: Date.now() })

    // Register before pushing: `push` writes through the cache, which triggers
    // the subscription and re-resolves options. If the seed were not in the map
    // yet, that pass would miss it and the very first refetch would win.
    driver.push(queryKey, data)
    this.flush()
  }

  clear(queryHash: string): void {
    const seed = this.#seeds.get(queryHash)
    if (!seed) return
    this.#seeds.delete(queryHash)
    // Withdrawing a seed leaves stale fake data sitting in the cache, so the
    // query has to go back to the network to become honest again.
    this.#driver?.invalidate(seed.queryKey)
    this.flush()
  }

  clearAll(): void {
    const seeds = Array.from(this.#seeds.values())
    this.#seeds.clear()
    for (const seed of seeds) this.#driver?.invalidate(seed.queryKey)
    this.flush()
  }

  readData(queryHash: string): SerializedPayload {
    // Prefer the seed itself: what you opened for editing should be what you
    // last applied, not the cache's copy, which an app mutation may have moved.
    const seed = this.#seeds.get(queryHash)
    if (seed) return serialize(seed.data)
    return this.#driver?.readData(queryHash) ?? { kind: 'undefined' }
  }

  // ---- snapshots ----

  snapshot(): Snapshot {
    return {
      frames: this.#frames,
      queries: this.#driver?.listQueries() ?? [],
      seeds: this.seedList(),
      fixtures: this.#fixtures.summaries,
      fixtureProblems: this.#fixtures.problems,
      capabilities: this.#capabilities,
    }
  }

  seedList(): SeedSnapshot[] {
    return Array.from(this.#seeds.entries(), ([queryHash, seed]) => ({
      queryHash,
      // Copied to a mutable array: the wire contract is plain JSON, and a
      // `readonly` type does not survive the bridge in any meaningful sense.
      queryKey: [...seed.queryKey],
      appliedAt: seed.appliedAt,
      byteLength: approximateSize(seed.data),
    }))
  }

  /**
   * Schedules a push to the panel.
   *
   * Cache events arrive in bursts — a single screen mount can produce dozens
   * across a few milliseconds — and each flush walks the whole cache. Coalescing
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
    const driver = this.#driver
    if (!sink || !driver) return
    sink.queries(driver.listQueries())
    sink.seeds(this.seedList())
  }
}
