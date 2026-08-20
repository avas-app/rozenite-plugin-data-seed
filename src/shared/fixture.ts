/**
 * The on-disk fixture format.
 *
 * These files are committed to the consuming repo and reviewed in pull
 * requests, so the shape is a stable contract rather than an implementation
 * detail — it is versioned, and it is exported from this package so tooling can
 * read the same files without reimplementing the parse.
 *
 * Everything here is plain JSON by construction: `data` has already crossed the
 * Rozenite bridge, which structured-clones, so it cannot contain functions,
 * class instances, or cycles by the time it lands here.
 */

import type { SeedMeta } from './types'
import type { TargetRef } from './target'
import { formatRef, parseTargetRef } from './target'

/**
 * Bumped to 2 when `queryKey` became `target`.
 *
 * v1 files still read: a bare `queryKey` array is exactly a `key` target, so
 * `parseFixture` accepts either and existing committed fixtures keep working
 * without a migration step.
 */
export const FIXTURE_VERSION = 2

export type Fixture = {
  version: number
  /** Human-readable name as typed. The filename is a slug of this. */
  name: string
  /** What this fixture seeds — a query key, or an HTTP route. */
  target: TargetRef
  /** ISO 8601. Written by the panel, which is the only thing that saves. */
  savedAt: string
  data: unknown
  /** Transport detail, such as the HTTP status to respond with. */
  meta?: SeedMeta
}

/** What the fixture list shows without reading every file's `data`. */
export type FixtureSummary = {
  name: string
  fileName: string
  target: TargetRef
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
  target: TargetRef,
  data: unknown,
  savedAt: string,
  meta?: SeedMeta,
): Fixture {
  return {
    version: FIXTURE_VERSION,
    name: name.trim(),
    target,
    savedAt,
    data,
    ...(meta ? { meta } : {}),
  }
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
 * a much worse message than "cart.json: target must be a query key or a route".
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

  const candidate = raw as Partial<Fixture> & { queryKey?: unknown }

  // `queryKey` is the v1 spelling and is still accepted, so a repo full of
  // committed fixtures does not need rewriting to upgrade the plugin.
  const rawTarget = candidate.target ?? candidate.queryKey
  if (rawTarget === undefined) {
    throw new FixtureParseError(fileName, 'missing target')
  }

  let target: TargetRef
  try {
    target = parseTargetRef(rawTarget)
  } catch (error) {
    throw new FixtureParseError(
      fileName,
      error instanceof Error ? error.message : 'invalid target',
    )
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
    target,
    savedAt: candidate.savedAt ?? '',
    data: candidate.data,
    ...(candidate.meta ? { meta: candidate.meta } : {}),
  }
}

/** Structural equality for targets, used to match a fixture to a live seed. */
export function sameTarget(a: TargetRef, b: TargetRef): boolean {
  return formatRef(a) === formatRef(b) && a.kind === b.kind
}
