import type { Fixture, FixtureSummary } from '../../shared/fixture'

/**
 * Where named fixtures live.
 *
 * Deliberately an interface with one implementation today. Rozenite gives
 * plugins no Node-side execution — the Metro config hook is a no-op as of 2.2 —
 * so the only zero-install way to reach the user's repo is the browser's File
 * System Access API. That works for the local-dev workflow this feature is for,
 * but it cannot run headlessly, so a CLI-backed store is the obvious second
 * implementation once fixtures need to load in CI. Keeping the panel behind
 * this interface is what makes that a new file rather than a rewrite.
 */
export type FixtureStore = {
  /** True once the store can actually read and write. */
  readonly ready: boolean
  /** Human-readable location, shown in the UI (e.g. the directory name). */
  readonly label: string | null
  list: () => Promise<FixtureSummary[]>
  read: (fileName: string) => Promise<Fixture>
  write: (fixture: Fixture) => Promise<FixtureSummary>
  remove: (fileName: string) => Promise<void>
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
