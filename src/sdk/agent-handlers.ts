import { generate } from '../shared/generate'
import type { SchemaDocument } from '../shared/schema'
import type {
  AdapterRow,
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
  ListTargetsArgs,
  ListTargetsResult,
  TargetArgs,
  TargetRow,
  ReadTargetArgs,
  ReadTargetResult,
} from '../shared/agent-tools'
import type { SeedMeta } from '../shared/types'
import type { SeedTarget, TargetRef } from '../shared/target'
import { formatRef, keyTarget, parseRoutePattern, routeTarget } from '../shared/target'
import type { Session } from './session'

/**
 * The agent surface, as plain functions over a `Session`.
 *
 * Kept free of React and of `@rozenite/agent-bridge` so each one is directly
 * testable: `use-seed-agent-tools.ts` is only wiring.
 *
 * Every write reports `persistent`, because a seed applied through an adapter
 * that could not be hooked is a one-shot write the next fetch erases. A test
 * that seeds and then asserts would otherwise fail somewhere far away from the
 * cause.
 */

const DEFAULT_LIMIT = 50

/**
 * Turns the caller's `queryKey` or `route` into a target.
 *
 * Rejects both-or-neither rather than picking one. An agent that sent both
 * probably means something different from whatever we would have guessed, and
 * a silent choice would show up as a seed that quietly did not apply.
 */
function toTarget(args: TargetArgs): SeedTarget {
  const hasKey = Array.isArray(args.queryKey)
  const hasRoute = typeof args.route === 'string' && args.route.trim() !== ''
  if (hasKey && hasRoute) {
    throw new Error('Pass either queryKey or route, not both.')
  }
  if (hasKey) return keyTarget(args.queryKey as unknown[])
  if (hasRoute) {
    const pattern = parseRoutePattern(args.route as string)
    return routeTarget(pattern.method, pattern.glob)
  }
  throw new Error('Pass a queryKey (e.g. ["user", 7]) or a route (e.g. "GET /api/users/7").')
}

/** The inverse, for rows: whichever field applies, so output mirrors input. */
function refFields(ref: TargetRef): { queryKey?: unknown[]; route?: string } {
  return ref.kind === 'key'
    ? { queryKey: [...ref.key] }
    : { route: `${ref.method} ${ref.url}` }
}

export function listTargets(
  session: Session,
  args: ListTargetsArgs = {},
): ListTargetsResult {
  const limit = args.limit ?? DEFAULT_LIMIT
  const search = args.search?.toLowerCase()

  let targets = session.listTargets()
  if (args.adapter) targets = targets.filter((t) => t.adapter === args.adapter)
  if (args.onlySeeded) targets = targets.filter((t) => t.seeded)
  if (search) {
    targets = targets.filter((t) => t.label.toLowerCase().includes(search))
  }

  const items: TargetRow[] = targets.slice(0, limit).map((target) => ({
    id: target.id,
    adapter: target.adapter,
    label: target.label,
    ...refFields(target.ref),
    status: target.status,
    fetchStatus: target.fetchStatus,
    seeded: target.seeded,
    bytes: target.preview?.byteLength ?? 0,
    summary: summarize(target.preview?.value),
    observerCount: target.observerCount,
    hits: target.hits,
    error: target.error,
  }))

  const adapters: AdapterRow[] = session.adapters.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    intercept: adapter.intercept,
    enumerable: adapter.enumerable,
  }))

  return { items, adapters, truncated: targets.length > items.length }
}

export function readTarget(session: Session, args: ReadTargetArgs): ReadTargetResult {
  requireAdapters(session)
  const target = toTarget(args)
  const label = formatRef(target.ref)
  const id = session.identify(target)
  const payload = id ? session.readData(id) : { kind: 'undefined' as const }
  return {
    label,
    found: payload.kind !== 'undefined',
    seeded: Boolean(id && session.findSeed(id)),
    data: payload.value ?? null,
    truncated: payload.truncated,
  }
}

export function applySeed(session: Session, args: ApplySeedArgs): ApplySeedResult {
  requireAdapters(session)
  const target = toTarget(args)
  const applied = session.apply(target, args.data, metaFrom(args))
  if (!applied) throw noAdapterFor(session, target)
  return {
    id: applied.id,
    label: formatRef(target.ref),
    adapter: applied.adapter,
    persistent: applied.persistent,
  }
}

export function clearSeed(session: Session, args: ClearSeedArgs): ClearSeedResult {
  requireAdapters(session)
  const target = toTarget(args)
  return { label: formatRef(target.ref), cleared: session.clearByTarget(target) }
}

export function clearAllSeeds(session: Session): ClearAllSeedsResult {
  requireAdapters(session)
  return { cleared: session.clearAll() }
}

export function listFixtures(session: Session): ListFixturesResult {
  return {
    items: session.fixtureSummaries.map((fixture) => ({
      id: fixture.id,
      name: fixture.name,
      label: fixture.label,
      ...refFields(fixture.target),
      bytes: fixture.byteLength,
    })),
    problems: session.fixtureProblems,
  }
}

export function applyFixture(
  session: Session,
  args: ApplyFixtureArgs,
): ApplyFixtureResult {
  requireAdapters(session)
  const fixture = session.findFixture(args.fixture)
  if (!fixture) {
    const available = session.fixtureSummaries.map((item) => item.name)
    throw new Error(
      available.length === 0
        ? 'No fixtures are bundled with this app. Pass `fixtures: require.context(...)` to useSeeder.'
        : `No fixture "${args.fixture}". Available: ${available.join(', ')}`,
    )
  }
  const target: SeedTarget = { adapter: '', ref: fixture.target }
  const applied = session.apply(target, fixture.data, fixture.meta)
  if (!applied) throw noAdapterFor(session, target)
  return {
    fixture: fixture.name,
    label: formatRef(fixture.target),
    adapter: applied.adapter,
    persistent: applied.persistent,
  }
}

export function generateSeed(
  session: Session,
  args: GenerateSeedArgs,
): GenerateSeedResult {
  requireAdapters(session)
  const target = toTarget(args)
  const label = formatRef(target.ref)

  const entry = session.schemaEntryFor(target.ref)
  if (!entry) {
    throw new Error(
      `No schema covers ${label}. ` +
        'Add it to data-seed.config.json and re-run `npx data-seed extract`.',
    )
  }

  const result = generate(entry.schema as SchemaDocument, {
    seed: args.seed ?? label,
    arrayLength: args.items,
    variant: args.variant,
  })

  let persistent = false
  const applied = args.dryRun !== true
  if (applied) {
    const outcome = session.apply(target, result.value, metaFrom(args))
    if (!outcome) throw noAdapterFor(session, target)
    persistent = outcome.persistent
  }

  return {
    label,
    type: entry.type,
    data: result.value,
    applied,
    persistent,
    warnings: result.warnings,
  }
}

function metaFrom(args: { status?: number }): SeedMeta | undefined {
  return typeof args.status === 'number' ? { status: args.status } : undefined
}

/**
 * Fails with a sentence rather than a null dereference.
 *
 * An agent calling a tool against an app that never mounted the hook — or
 * mounted it in a release build, where it is inert — should be told that.
 */
function requireAdapters(session: Session): void {
  if (session.adapters.length === 0) {
    throw new Error(
      'Data Seed is not attached. useSeeder() must be mounted in a development build.',
    )
  }
}

/**
 * Names what is missing, rather than reporting a generic failure.
 *
 * Asking for a route with no HTTP adapter installed is the realistic case, and
 * "no adapter handles GET /api/todos (installed: react-query)" is the message
 * that tells you to pass `http: true`.
 */
function noAdapterFor(session: Session, target: SeedTarget): Error {
  const installed = session.adapters.map((adapter) => adapter.id).join(', ') || 'none'
  return new Error(
    `No adapter handles ${formatRef(target.ref)} (installed: ${installed}).`,
  )
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
