/**
 * Agent SDK entry point.
 *
 * Built to `dist/sdk/index.{js,cjs,d.ts}` and consumed as
 * `import { seedTools } from '@avasapp/rozenite-plugin-data-seed/sdk'`,
 * which gives `@rozenite/agent-sdk` callers typed descriptors instead of
 * stringly-typed tool names:
 *
 * ```ts
 * await session.callTool(seedTools.applyFixture, {
 *   fixture: 'cart with 50 items',
 * })
 * ```
 *
 * This entry deliberately pulls in nothing from `src/sdk/` or `src/panel/` — it
 * is imported from Node, where React and the React Native bridge do not exist.
 */

import { defineAgentToolDescriptors } from '@rozenite/agent-shared'

import { seedToolDefinitions } from './src/shared/agent-tools'
import { PLUGIN_ID } from './src/shared/types'

export { seedToolDefinitions, PLUGIN_ID }

/** Tool descriptors bound to this plugin's domain, for `session.callTool`. */
export const seedTools = defineAgentToolDescriptors(
  PLUGIN_ID,
  seedToolDefinitions,
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
  ListTargetsArgs,
  ListTargetsResult,
  AdapterRow,
  TargetArgs,
  TargetRow,
  ReadTargetArgs,
  ReadTargetResult,
} from './src/shared/agent-tools'

export type {
  AdapterInfo,
  BundledFixture,
  Capabilities,
  FetchStatus,
  SchemaSummary,
  SeedMeta,
  SeedSnapshot,
  TargetSnapshot,
  TargetStatus,
} from './src/shared/types'

export type { SeedTarget, TargetPattern, TargetRef } from './src/shared/target'

export type { Fixture, FixtureSummary } from './src/shared/fixture'
export type { SchemaDocument, SchemaEntry, SchemasFile } from './src/shared/schema'
