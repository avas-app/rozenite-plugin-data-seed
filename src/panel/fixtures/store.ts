import type { Fixture, FixtureSummary } from '../../shared/fixture'

/**
 * Where new fixtures get written.
 *
 * Write-only on purpose. Reading goes through the app bundle, which needs no
 * permission and works for anyone who clones the repo; creating a file is the
 * one thing a bundle cannot do, so it is the only thing left here.
 *
 * Still an interface with one implementation, because that one implementation
 * has a real limit: the browser's File System Access API cannot run headlessly,
 * so authoring a fixture from CI needs a CLI-backed store. Keeping the panel
 * behind this makes that a new file rather than a rewrite.
 */
export type FixtureStore = {
  /** True once the store can actually write. */
  readonly ready: boolean
  /** Human-readable location, shown in the UI (e.g. the directory name). */
  readonly label: string | null
  write: (fixture: Fixture) => Promise<FixtureSummary>
}

export class FixtureStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FixtureStoreUnavailableError'
  }
}

export class FixturePermissionError extends Error {
  constructor() {
    super('Access to the fixtures folder was not granted.')
    this.name = 'FixturePermissionError'
  }
}
