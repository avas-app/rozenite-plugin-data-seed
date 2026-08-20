/**
 * Agent tool contracts for `rozenite agent`.
 *
 * These are the wire contract for the *agent* surface, in the same way that
 * `SeedEventMap` is the contract for the panel. They live in `shared/` because
 * both ends need them: the device registers handlers against them
 * (`sdk/use-seed-agent-tools.ts`) and `@rozenite/agent-sdk` consumers get them
 * as typed descriptors (the package's `./sdk` entry point).
 *
 * This is what makes the plugin usable without a DevTools window — an E2E run
 * can put the app into a known state before driving the UI, which is the whole
 * point of having fixtures in the first place.
 *
 * Three rules shape the design:
 *
 *  - **List tools never return values.** A cache entry or a response body is
 *    unbounded app state; a page of twenty would be useless in an agent's
 *    context. Lists return rows with a size and a summary, and `read-target`
 *    returns the value for exactly one of them.
 *  - **Writes are addressed the way the caller writes them.** A query key or a
 *    route string is what appears in their source; an internal id is not.
 *  - **A target is named by exactly one of `queryKey` or `route`.** Two optional
 *    fields rather than a tagged object, because `{"route": "GET /api/todos"}`
 *    is what a caller would have typed anyway.
 */

import { defineAgentToolContract } from '@rozenite/agent-shared'

import type { FetchStatus, TargetStatus } from './types'

// ------------------------------------------------------------------- target

/**
 * How every tool names what it is acting on. Exactly one field must be set.
 *
 * `route` accepts a glob: `GET /api/users/*` seeds every user, where a query
 * key seed covers exactly one key. An omitted method means any method.
 */
export type TargetArgs = {
  /** A TanStack query key, e.g. `["user", 7]`. */
  queryKey?: unknown[]
  /** An HTTP route, e.g. `GET /api/users/*`. */
  route?: string
}

const targetProperties = {
  queryKey: {
    type: 'array',
    description: 'A TanStack query key, e.g. ["user", 7]. Omit if using route.',
  },
  route: {
    type: 'string',
    description:
      'An HTTP route, e.g. "GET /api/users/*". * matches within a path segment, ** crosses segments. Omit if using queryKey.',
  },
} as const

// ------------------------------------------------------------------- rows

/**
 * One row in `list-targets`. Deliberately not `TargetSnapshot`: the preview is
 * replaced by a summary and a size, so a page stays small enough to read.
 */
export type TargetRow = {
  /** Opaque id, stable for as long as the target exists. */
  id: string
  /** Which adapter owns it: `react-query`, `http`, … */
  adapter: string
  /** One-line rendering, e.g. `["user",7]` or `GET /api/users/7`. */
  label: string
  queryKey?: unknown[]
  route?: string
  status: TargetStatus
  fetchStatus: FetchStatus
  seeded: boolean
  /** Approximate size of the value in bytes. */
  bytes: number
  /** One-line description of the value, e.g. `Array(50)`. */
  summary: string
  /** Live subscribers. Cache-shaped adapters only. */
  observerCount?: number
  /** Times this route has been requested. HTTP only. */
  hits?: number
  error?: string
}

export type FixtureRow = {
  id: string
  name: string
  /** One-line rendering of what this fixture seeds. */
  label: string
  queryKey?: unknown[]
  route?: string
  bytes: number
}

export type AdapterRow = {
  id: string
  label: string
  /** False means seeds are one-shot writes the next fetch overwrites. */
  intercept: boolean
  /** False means targets only appear once they have been used. */
  enumerable: boolean
}

// ------------------------------------------------------------------- args

export type ListTargetsArgs = {
  /** Substring match on the rendered label. */
  search?: string
  /** Restrict to one adapter, e.g. `http`. */
  adapter?: string
  /** Only targets that currently have a seed. Defaults to false. */
  onlySeeded?: boolean
  limit?: number
}
export type ListTargetsResult = {
  items: TargetRow[]
  /** Every installed adapter, so a caller can see what is available. */
  adapters: AdapterRow[]
  /** True when `limit` cut the list short. */
  truncated: boolean
}

export type ReadTargetArgs = TargetArgs
export type ReadTargetResult = {
  label: string
  found: boolean
  seeded: boolean
  data: unknown
  /** Set when the value was clipped for transport. */
  truncated?: boolean
}

export type ApplySeedArgs = TargetArgs & {
  /** Any JSON value. For a route this is the response body. */
  data: unknown
  /** HTTP status to respond with. Routes only; defaults to 200. */
  status?: number
}
export type ApplySeedResult = {
  id: string
  label: string
  adapter: string
  /**
   * False when the adapter could not be hooked, meaning the seed is a one-shot
   * write that the next fetch will overwrite. Worth failing a test over.
   */
  persistent: boolean
}

export type ClearSeedArgs = TargetArgs
export type ClearSeedResult = { label: string; cleared: boolean }

export type ClearAllSeedsArgs = undefined
export type ClearAllSeedsResult = { cleared: number }

export type ListFixturesArgs = undefined
export type ListFixturesResult = {
  items: FixtureRow[]
  /** Fixture files that failed to parse, so a typo is not silently invisible. */
  problems: Array<{ id: string; reason: string }>
}

export type ApplyFixtureArgs = {
  /** Fixture id or name, as reported by `list-fixtures`. */
  fixture: string
}
export type ApplyFixtureResult = {
  fixture: string
  label: string
  adapter: string
  persistent: boolean
}

export type GenerateSeedArgs = TargetArgs & {
  /** Elements per array. Defaults to 3. */
  items?: number
  /** Which branch of a union to produce. Defaults to seed-chosen. */
  variant?: number
  /** Any string; the same seed reproduces the same value. */
  seed?: string
  /** HTTP status to respond with. Routes only; defaults to 200. */
  status?: number
  /** Generate without applying it. Defaults to false. */
  dryRun?: boolean
}
export type GenerateSeedResult = {
  label: string
  /** The TypeScript type the schema came from. */
  type: string
  data: unknown
  applied: boolean
  persistent: boolean
  /** Paths the generator could not produce data for. */
  warnings: Array<{ path: string; reason: string }>
}

// -------------------------------------------------------------- contracts

export const seedToolDefinitions = {
  listTargets: defineAgentToolContract<ListTargetsArgs, ListTargetsResult>({
    name: 'list-targets',
    description:
      'List everything that can be seeded: queries in the TanStack cache, and HTTP routes that have been observed. Values are summarised, not returned — use read-target for one. HTTP routes only appear once a request has gone out, but you can still seed a route that has never been requested.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Substring match on the rendered label.',
        },
        adapter: {
          type: 'string',
          description: 'Restrict to one adapter, e.g. "http" or "react-query".',
        },
        onlySeeded: {
          type: 'boolean',
          description: 'Only targets that currently have a seed.',
        },
        limit: { type: 'number', description: 'Maximum rows. Defaults to 50.' },
      },
    },
    readOnly: true,
    idempotent: true,
  }),

  readTarget: defineAgentToolContract<ReadTargetArgs, ReadTargetResult>({
    name: 'read-target',
    description:
      "Read one target's current value — a cached query value, or the last response body seen for a route. Returns found: false rather than an error when there is nothing there, since that is a normal state to assert on.",
    inputSchema: { type: 'object', properties: { ...targetProperties } },
    readOnly: true,
    idempotent: true,
  }),

  applySeed: defineAgentToolContract<ApplySeedArgs, ApplySeedResult>({
    name: 'apply-seed',
    description:
      'Seed a target and keep it seeded until cleared. For a query key the value goes into the cache and survives refetching; for a route it is returned as the response body on every matching request. Works for targets that have never been fetched.',
    inputSchema: {
      type: 'object',
      properties: {
        ...targetProperties,
        data: { description: 'Any JSON value. For a route, the response body.' },
        status: {
          type: 'number',
          description:
            'HTTP status to respond with. Routes only; defaults to 200. Use this to test error handling.',
        },
      },
      required: ['data'],
    },
  }),

  clearSeed: defineAgentToolContract<ClearSeedArgs, ClearSeedResult>({
    name: 'clear-seed',
    description:
      'Withdraw the seed on a target. A seeded query is refetched so real data comes back; a seeded route simply stops being intercepted.',
    inputSchema: { type: 'object', properties: { ...targetProperties } },
    idempotent: true,
  }),

  clearAllSeeds: defineAgentToolContract<ClearAllSeedsArgs, ClearAllSeedsResult>({
    name: 'clear-all-seeds',
    description: 'Withdraw every active seed across every adapter.',
    inputSchema: { type: 'object', properties: {} },
    idempotent: true,
  }),

  listFixtures: defineAgentToolContract<ListFixturesArgs, ListFixturesResult>({
    name: 'list-fixtures',
    description:
      'List the fixtures bundled with the app, plus any fixture files that failed to parse.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    idempotent: true,
  }),

  applyFixture: defineAgentToolContract<ApplyFixtureArgs, ApplyFixtureResult>({
    name: 'apply-fixture',
    description:
      'Seed a target from a committed fixture, by id or name. This is the intended way to put the app into a known state before driving its UI.',
    inputSchema: {
      type: 'object',
      properties: {
        fixture: {
          type: 'string',
          description: 'Fixture id or name from list-fixtures.',
        },
      },
      required: ['fixture'],
    },
  }),

  generateSeed: defineAgentToolContract<GenerateSeedArgs, GenerateSeedResult>({
    name: 'generate-seed',
    description:
      "Generate a value from the target's extracted TypeScript schema and seed it. Use items to produce a long list, variant to choose a union branch, and dryRun to see the value without applying it.",
    inputSchema: {
      type: 'object',
      properties: {
        ...targetProperties,
        items: { type: 'number', description: 'Elements per array. Defaults to 3.' },
        variant: {
          type: 'number',
          description: 'Index of the union branch to produce.',
        },
        seed: {
          type: 'string',
          description: 'Any string; the same seed reproduces the same value.',
        },
        status: {
          type: 'number',
          description: 'HTTP status to respond with. Routes only; defaults to 200.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Generate without applying the seed.',
        },
      },
    },
  }),
}
