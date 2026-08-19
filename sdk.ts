/**
 * Agent SDK entry point.
 *
 * Built to `dist/sdk/index.{js,cjs,d.ts}` and consumed as
 * `import { querySeedTools } from '@avasapp/rozenite-plugin-query-seed/sdk'`,
 * which gives `@rozenite/agent-sdk` callers typed descriptors instead of
 * stringly-typed tool names:
 *
 * ```ts
 * await session.callTool(querySeedTools.applyFixture, {
 *   fixture: 'cart with 50 items',
 * })
 * ```
 *
 * This entry deliberately pulls in nothing from `src/sdk/` or `src/panel/` — it
 * is imported from Node, where React and the React Native bridge do not exist.
 */

import { defineAgentToolDescriptors } from '@rozenite/agent-shared'

import { querySeedToolDefinitions } from './src/shared/agent-tools'
import { PLUGIN_ID } from './src/shared/types'

export { querySeedToolDefinitions, PLUGIN_ID }

/** Tool descriptors bound to this plugin's domain, for `session.callTool`. */
export const querySeedTools = defineAgentToolDescriptors(
  PLUGIN_ID,
  querySeedToolDefinitions,
)

export type {
  ApplyFixtureArgs,
  ApplyFixtureResult,
  ApplySeedArgs,
  ApplySeedResult,
  ClearAllSeedsResult,
  ClearSeedArgs,
  ClearSeedResult,
  FixtureRow,
  GenerateSeedArgs,
  GenerateSeedResult,
  ListFixturesResult,
  ListQueriesArgs,
  ListQueriesResult,
  QueryRow,
  ReadQueryArgs,
  ReadQueryResult,
} from './src/shared/agent-tools'

export type {
  BundledFixture,
  Capabilities,
  FetchStatus,
  QuerySnapshot,
  QueryStatus,
  SchemaSummary,
  SeedSnapshot,
} from './src/shared/types'

export type { Fixture, FixtureSummary } from './src/shared/fixture'
export type { SchemaDocument, SchemaEntry, SchemasFile } from './src/shared/schema'
