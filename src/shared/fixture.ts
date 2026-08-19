/**
 * The on-disk fixture format.
 *
 * These files are committed to the consuming repo and reviewed in pull
 * requests, so the shape is a stable contract rather than an implementation
 * detail — it is versioned, and it is exported from this package so the schema
 * generator planned for milestone 3 can read the same files without
 * reimplementing the parse.
 *
 * Everything here is plain JSON by construction: `data` has already crossed the
 * Rozenite bridge, which structured-clones, so it cannot contain functions,
 * class instances, or cycles by the time it lands here.
 */

/** Bumped only for a breaking change to the file layout. */
export const FIXTURE_VERSION = 1

export type Fixture = {
  version: number
  /** Human-readable name as typed. The filename is a slug of this. */
  name: string
  /** The query key this fixture seeds. */
  queryKey: unknown[]
  /** ISO 8601. Written by the panel, which is the only thing that saves. */
  savedAt: string
  data: unknown
}

/** What the fixture list shows without reading every file's `data`. */
export type FixtureSummary = {
  name: string
  fileName: string
  queryKey: unknown[]
  savedAt: string
  byteLength: number
}

export const FIXTURE_EXTENSION = '.json'

/**
 * Derives a filename from a display name.
 *
 * Deliberately strict — these become real files in someone's repo, and a name
 * that round-trips through a shell, a git path, and a Windows checkout is worth
 * more than preserving the user's punctuation.
 */
export function toFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return `${slug || 'fixture'}${FIXTURE_EXTENSION}`
}

export function isFixtureFile(fileName: string): boolean {
  return fileName.endsWith(FIXTURE_EXTENSION)
}

export function createFixture(
  name: string,
  queryKey: unknown[],
  data: unknown,
  savedAt: string,
): Fixture {
  return { version: FIXTURE_VERSION, name: name.trim(), queryKey, savedAt, data }
}

export function serializeFixture(fixture: Fixture): string {
  // Trailing newline and two-space indent: these are committed files, and a
  // diff-friendly format is the whole point of putting them in the repo.
  return `${JSON.stringify(fixture, null, 2)}\n`
}

export class FixtureParseError extends Error {
  constructor(fileName: string, reason: string) {
    super(`${fileName}: ${reason}`)
    this.name = 'FixtureParseError'
  }
}

/**
 * Parses a fixture file.
 *
 * Throws rather than returning null so the panel can name the offending file —
 * a fixture directory is hand-editable, and "one of your fixtures is broken" is
 * a much worse message than "cart.json: queryKey must be an array".
 */
export function parseFixture(fileName: string, text: string): Fixture {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new FixtureParseError(
      fileName,
      error instanceof Error ? error.message : 'invalid JSON',
    )
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FixtureParseError(fileName, 'expected a JSON object')
  }

  const candidate = raw as Partial<Fixture>

  if (!Array.isArray(candidate.queryKey)) {
    throw new FixtureParseError(fileName, 'queryKey must be an array')
  }
  if (!('data' in candidate)) {
    throw new FixtureParseError(fileName, 'missing data')
  }
  if (typeof candidate.version === 'number' && candidate.version > FIXTURE_VERSION) {
    throw new FixtureParseError(
      fileName,
      `written by a newer plugin (v${candidate.version}); upgrade to read it`,
    )
  }

  return {
    version: candidate.version ?? FIXTURE_VERSION,
    // Fall back to the filename so a hand-written fixture without a name still
    // shows up in the list rather than rendering as blank.
    name: candidate.name?.trim() || fileName.replace(FIXTURE_EXTENSION, ''),
    queryKey: candidate.queryKey,
    savedAt: candidate.savedAt ?? '',
    data: candidate.data,
  }
}

/** Structural equality for query keys, used to match a fixture to a live seed. */
export function sameQueryKey(a: unknown[], b: unknown[]): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
