import type { BundledFixture, FixtureProblem } from '../shared/types'
import { parseFixture } from '../shared/fixture'
import type { Fixture } from '../shared/fixture'
import { approximateSize } from './serialize'

/**
 * Reads fixtures that shipped inside the app bundle.
 *
 * The consuming app hands us a Metro `require.context` over its fixtures
 * directory:
 *
 * ```ts
 * useQuerySeeder(queryClient, {
 *   fixtures: require.context('./seeds', false, /\.json$/),
 * })
 * ```
 *
 * That indirection is what makes fixtures work for a teammate who just cloned
 * the repo. The panel runs in a browser and can only reach the filesystem
 * through a folder the user personally clicked on, and Metro's dev server does
 * not serve arbitrary project files — but Metro *does* bundle them, so routing
 * reads through the app is the one path that needs no setup at all.
 *
 * The path has to be a literal at the call site because Metro resolves
 * `require.context` statically. That is also why there is no `dir` option here:
 * changing the directory means changing that literal, and an option that
 * silently did nothing would be worse than no option.
 */

/** The shape Metro's `require.context` returns. Structural, so it is testable. */
export type FixtureContext = {
  keys: () => string[]
  (id: string): unknown
}

/** Also accepts a plain map, for apps that would rather list fixtures by hand. */
export type FixtureSource = FixtureContext | Record<string, unknown>

export type LoadedFixtures = {
  summaries: BundledFixture[]
  problems: FixtureProblem[]
  /** Full values, kept on the device until the panel asks for one. */
  byId: Map<string, Fixture>
}

const EMPTY: LoadedFixtures = { summaries: [], problems: [], byId: new Map() }

export function loadFixtures(source: FixtureSource | undefined): LoadedFixtures {
  if (!source) return EMPTY

  const entries = readEntries(source)
  const summaries: BundledFixture[] = []
  const problems: FixtureProblem[] = []
  const byId = new Map<string, Fixture>()

  for (const [id, raw] of entries) {
    try {
      const fixture = normalize(id, raw)
      byId.set(id, fixture)
      summaries.push({
        id,
        name: fixture.name,
        queryKey: fixture.queryKey,
        savedAt: fixture.savedAt,
        byteLength: approximateSize(fixture.data),
      })
    } catch (error) {
      // Reported rather than skipped. A fixtures directory is hand-editable and
      // committed, so a malformed file is something a person needs to see —
      // silently dropping it looks identical to never having saved it.
      problems.push({
        id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name))
  problems.sort((a, b) => a.id.localeCompare(b.id))

  return { summaries, problems, byId }
}

function readEntries(source: FixtureSource): Array<[string, unknown]> {
  if (typeof source === 'function' && typeof source.keys === 'function') {
    const context = source as FixtureContext
    return context.keys().map((id) => [id, safeRequire(context, id)])
  }
  return Object.entries(source as Record<string, unknown>)
}

function safeRequire(context: FixtureContext, id: string): unknown {
  try {
    return context(id)
  } catch (error) {
    return { __loadError: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Normalizes one bundled module into a `Fixture`.
 *
 * Metro parses `.json` for us, so what arrives is already an object rather than
 * text — but it may be wrapped in `default` depending on how the file was
 * imported, and it has not been validated. Re-serializing lets the shared
 * parser do the validation, so bundled and on-disk fixtures are held to exactly
 * the same contract.
 */
function normalize(id: string, raw: unknown): Fixture {
  const value =
    raw && typeof raw === 'object' && 'default' in (raw as Record<string, unknown>)
      ? (raw as { default: unknown }).default
      : raw

  if (value && typeof value === 'object' && '__loadError' in value) {
    throw new Error(String((value as { __loadError: unknown }).__loadError))
  }

  const fileName = id.replace(/^\.\//, '')
  return parseFixture(fileName, JSON.stringify(value))
}
