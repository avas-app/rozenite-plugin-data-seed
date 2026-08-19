/**
 * Agent tool contracts for `rozenite agent`.
 *
 * These are the wire contract for the *agent* surface, in the same way that
 * `QuerySeedEventMap` is the contract for the panel. They live in `shared/`
 * because both ends need them: the device registers handlers against them
 * (`sdk/use-query-seed-agent-tools.ts`) and `@rozenite/agent-sdk` consumers get
 * them as typed descriptors (the package's `./sdk` entry point).
 *
 * This is what makes the plugin usable without a DevTools window — an E2E run
 * can put the cache into a known state before driving the UI, which is the
 * whole point of having fixtures in the first place.
 *
 * Two rules shape the design:
 *
 *  - **List tools never return cache values.** A cache entry is unbounded app
 *    state; a page of twenty would be useless in an agent's context. Lists
 *    return rows with a size and a summary, and `read-query` returns the value
 *    for exactly one of them.
 *  - **Writes are addressed by query key, not hash.** A hash is meaningless to
 *    a caller writing a test, and the key is what appears in their source.
 */

import { defineAgentToolContract } from '@rozenite/agent-shared'

import type { FetchStatus, QueryStatus } from './types'

// ------------------------------------------------------------------- rows

/**
 * One row in `list-queries`. Deliberately not `QuerySnapshot`: the preview is
 * replaced by a summary and a size, so a page stays small enough to read.
 */
export type QueryRow = {
  queryHash: string
  /** The key as JSON, which is how it appears in the caller's source. */
  queryKey: unknown[]
  status: QueryStatus
  fetchStatus: FetchStatus
  observerCount: number
  seeded: boolean
  /** Approximate size of the cached value in bytes. */
  bytes: number
  /** One-line description of the value, e.g. `Array(50)`. */
  summary: string
  error?: string
}

export type FixtureRow = {
  id: string
  name: string
  queryKey: unknown[]
  bytes: number
}

// ------------------------------------------------------------------- args

export type ListQueriesArgs = {
  /** Substring match on the JSON-rendered query key. */
  search?: string
  /** Only queries that currently have a seed. Defaults to false. */
  onlySeeded?: boolean
  limit?: number
}
export type ListQueriesResult = {
  items: QueryRow[]
  /** True when `limit` cut the list short. */
  truncated: boolean
}

export type ReadQueryArgs = {
  /** The query key, e.g. `["user", 7]`. */
  queryKey: unknown[]
}
export type ReadQueryResult = {
  queryKey: unknown[]
  found: boolean
  seeded: boolean
  data: unknown
  /** Set when the value was clipped for transport. */
  truncated?: boolean
}

export type ApplySeedArgs = {
  queryKey: unknown[]
  /** Any JSON value. Replaces whatever is in the cache. */
  data: unknown
}
export type ApplySeedResult = {
  queryKey: unknown[]
  queryHash: string
  /**
   * False when the client could not be hooked, meaning the seed is a one-shot
   * write that the next refetch will overwrite. Worth failing a test over.
   */
  persistent: boolean
}

export type ClearSeedArgs = { queryKey: unknown[] }
export type ClearSeedResult = { queryKey: unknown[]; cleared: boolean }

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
  queryKey: unknown[]
  persistent: boolean
}

export type GenerateSeedArgs = {
  queryKey: unknown[]
  /** Elements per array. Defaults to 3. */
  items?: number
  /** Which branch of a union to produce. Defaults to seed-chosen. */
  variant?: number
  /** Any string; the same seed reproduces the same value. */
  seed?: string
  /** Generate without writing it to the cache. Defaults to false. */
  dryRun?: boolean
}
export type GenerateSeedResult = {
  queryKey: unknown[]
  /** The TypeScript type the schema came from. */
  type: string
  data: unknown
  applied: boolean
  persistent: boolean
  /** Paths the generator could not produce data for. */
  warnings: Array<{ path: string; reason: string }>
}

// -------------------------------------------------------------- contracts

const queryKeyProperty = {
  queryKey: {
    type: 'array',
    description: 'The TanStack query key, e.g. ["user", 7].',
  },
} as const

export const querySeedToolDefinitions = {
  listQueries: defineAgentToolContract<ListQueriesArgs, ListQueriesResult>({
    name: 'list-queries',
    description:
      'List every query in the TanStack Query cache, with its status, observer count and whether a seed is currently overriding it. Values are summarised, not returned — use read-query for one.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Substring match on the JSON-rendered query key.',
        },
        onlySeeded: {
          type: 'boolean',
          description: 'Only queries that currently have a seed.',
        },
        limit: { type: 'number', description: 'Maximum rows. Defaults to 50.' },
      },
    },
    readOnly: true,
    idempotent: true,
  }),

  readQuery: defineAgentToolContract<ReadQueryArgs, ReadQueryResult>({
    name: 'read-query',
    description:
      "Read one query's cached value. Returns found: false rather than an error when the key is not in the cache, since an absent query is a normal state to assert on.",
    inputSchema: {
      type: 'object',
      properties: { ...queryKeyProperty },
      required: ['queryKey'],
    },
    readOnly: true,
    idempotent: true,
  }),

  applySeed: defineAgentToolContract<ApplySeedArgs, ApplySeedResult>({
    name: 'apply-seed',
    description:
      'Put a value into the cache for a query key and keep it there through refetches and invalidation, until cleared. Works for keys that have never been fetched.',
    inputSchema: {
      type: 'object',
      properties: {
        ...queryKeyProperty,
        data: { description: 'Any JSON value to seed the query with.' },
      },
      required: ['queryKey', 'data'],
    },
  }),

  clearSeed: defineAgentToolContract<ClearSeedArgs, ClearSeedResult>({
    name: 'clear-seed',
    description:
      'Withdraw the seed on a query key and refetch it, so real data comes back.',
    inputSchema: {
      type: 'object',
      properties: { ...queryKeyProperty },
      required: ['queryKey'],
    },
    idempotent: true,
  }),

  clearAllSeeds: defineAgentToolContract<ClearAllSeedsArgs, ClearAllSeedsResult>({
    name: 'clear-all-seeds',
    description: 'Withdraw every active seed and refetch the affected queries.',
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
      'Seed a query from a committed fixture, by id or name. This is the intended way to put the app into a known state before driving its UI.',
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
      "Generate a value from the query's extracted TypeScript schema and seed it. Use items to produce a long list, variant to choose a union branch, and dryRun to see the value without writing it.",
    inputSchema: {
      type: 'object',
      properties: {
        ...queryKeyProperty,
        items: { type: 'number', description: 'Elements per array. Defaults to 3.' },
        variant: {
          type: 'number',
          description: 'Index of the union branch to produce.',
        },
        seed: {
          type: 'string',
          description: 'Any string; the same seed reproduces the same value.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Generate without writing to the cache.',
        },
      },
      required: ['queryKey'],
    },
  }),
}
