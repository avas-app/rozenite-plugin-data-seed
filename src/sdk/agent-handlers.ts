import { generate } from '../shared/generate'
import type { SchemaDocument } from '../shared/schema'
import type {
  ApplyFixtureArgs,
  ApplyFixtureResult,
  ApplySeedArgs,
  ApplySeedResult,
  ClearAllSeedsResult,
  ClearSeedArgs,
  ClearSeedResult,
  GenerateSeedArgs,
  GenerateSeedResult,
  ListFixturesResult,
  ListQueriesArgs,
  ListQueriesResult,
  QueryRow,
  ReadQueryArgs,
  ReadQueryResult,
} from '../shared/agent-tools'
import type { Session } from './session'

/**
 * The agent surface, as plain functions over a `Session`.
 *
 * Kept free of React and of `@rozenite/agent-bridge` so each one is directly
 * testable: `use-query-seed-agent-tools.ts` is only wiring.
 *
 * Every write reports `persistent`, because a seed applied to a client that
 * could not be hooked is a one-shot write the next refetch erases. A test that
 * seeds and then asserts would otherwise fail somewhere far away from the
 * cause.
 */

const DEFAULT_LIMIT = 50

export function listQueries(
  session: Session,
  args: ListQueriesArgs = {},
): ListQueriesResult {
  const limit = args.limit ?? DEFAULT_LIMIT
  const search = args.search?.toLowerCase()

  let queries = session.listQueries()
  if (args.onlySeeded) queries = queries.filter((query) => query.seeded)
  if (search) {
    queries = queries.filter((query) =>
      JSON.stringify(query.queryKey).toLowerCase().includes(search),
    )
  }

  const items: QueryRow[] = queries.slice(0, limit).map((query) => ({
    queryHash: query.queryHash,
    queryKey: query.queryKey,
    status: query.status,
    fetchStatus: query.fetchStatus,
    observerCount: query.observerCount,
    seeded: query.seeded,
    bytes: query.preview?.byteLength ?? 0,
    summary: summarize(query.preview?.value),
    error: query.error,
  }))

  return { items, truncated: queries.length > items.length }
}

export function readQuery(session: Session, args: ReadQueryArgs): ReadQueryResult {
  const hash = session.hashKey(args.queryKey)
  const payload = hash ? session.readData(hash) : { kind: 'undefined' as const }
  const found = payload.kind !== 'undefined'
  return {
    queryKey: args.queryKey,
    found,
    seeded: Boolean(hash && session.getSeed(hash)),
    data: payload.value ?? null,
    truncated: payload.truncated,
  }
}

export function applySeed(session: Session, args: ApplySeedArgs): ApplySeedResult {
  requireDriver(session)
  session.apply(args.queryKey, args.data)
  return {
    queryKey: args.queryKey,
    queryHash: session.hashKey(args.queryKey) ?? '',
    persistent: session.capabilities.intercept,
  }
}

export function clearSeed(session: Session, args: ClearSeedArgs): ClearSeedResult {
  requireDriver(session)
  return { queryKey: args.queryKey, cleared: session.clearByKey(args.queryKey) }
}

export function clearAllSeeds(session: Session): ClearAllSeedsResult {
  requireDriver(session)
  const cleared = session.seedCount
  session.clearAll()
  return { cleared }
}

export function listFixtures(session: Session): ListFixturesResult {
  return {
    items: session.fixtureSummaries.map((fixture) => ({
      id: fixture.id,
      name: fixture.name,
      queryKey: fixture.queryKey,
      bytes: fixture.byteLength,
    })),
    problems: session.fixtureProblems,
  }
}

export function applyFixture(
  session: Session,
  args: ApplyFixtureArgs,
): ApplyFixtureResult {
  requireDriver(session)
  const fixture = session.findFixture(args.fixture)
  if (!fixture) {
    const available = session.fixtureSummaries.map((item) => item.name)
    throw new Error(
      available.length === 0
        ? 'No fixtures are bundled with this app. Pass `fixtures: require.context(...)` to useQuerySeeder.'
        : `No fixture "${args.fixture}". Available: ${available.join(', ')}`,
    )
  }
  session.apply(fixture.queryKey, fixture.data)
  return {
    fixture: fixture.name,
    queryKey: [...fixture.queryKey],
    persistent: session.capabilities.intercept,
  }
}

export function generateSeed(
  session: Session,
  args: GenerateSeedArgs,
): GenerateSeedResult {
  requireDriver(session)
  const entry = session.schemaEntryFor(args.queryKey)
  if (!entry) {
    throw new Error(
      `No schema covers ${JSON.stringify(args.queryKey)}. ` +
        'Add it to query-seed.config.json and re-run `npx query-seed extract`.',
    )
  }

  const result = generate(entry.schema as SchemaDocument, {
    seed: args.seed ?? JSON.stringify(args.queryKey),
    arrayLength: args.items,
    variant: args.variant,
  })

  const applied = args.dryRun !== true
  if (applied) session.apply(args.queryKey, result.value)

  return {
    queryKey: args.queryKey,
    type: entry.type,
    data: result.value,
    applied,
    persistent: applied && session.capabilities.intercept,
    warnings: result.warnings,
  }
}

/**
 * Fails with a sentence rather than a null dereference.
 *
 * An agent calling a tool against an app that never mounted the hook — or
 * mounted it in a release build, where it is inert — should be told that.
 */
function requireDriver(session: Session): void {
  if (session.hashKey(['probe']) === null) {
    throw new Error(
      'Query Seed is not attached. useQuerySeeder() must be mounted with a QueryClient, in a development build.',
    )
  }
}

function summarize(value: unknown): string {
  if (value === null || value === undefined) return 'no data'
  if (Array.isArray(value)) return `Array(${value.length})`
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    return `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }`
  }
  return String(value).slice(0, 60)
}
