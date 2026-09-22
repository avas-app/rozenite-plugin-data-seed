/**
 * Agent SDK entry point.
 *
 * Built to `dist/sdk/` by the Rozenite builder, which owns the output filenames
 * and the `exports` map that points at them, and consumed as
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

/**
 * The `@fake` token catalogue, and a way to see what each one produces.
 *
 * Exported from the Node entry because `data-seed tokens` prints it — the CLI
 * is plain `.mjs` and cannot read the TypeScript source, and duplicating the
 * list there is exactly the drift this catalogue exists to prevent.
 */
export { TOKENS, TOKEN_NAMES, sampleToken } from './src/shared/generate'
export type { TokenDoc } from './src/shared/generate'

/**
 * Reading a committed schemas file and generating from it, outside the app.
 *
 * The panel and the device already do this internally; these are the same two
 * functions, exported so a Node caller can do it too. The case they exist for
 * is a target this plugin cannot seed — a `{"name": …}` entry, extracted for a
 * type that arrives over a transport with no query key and no URL. Whatever
 * owns that transport generates the payload here, on the host, and hands it
 * over already built.
 *
 * Generating host-side rather than on-device is the point. The alternative
 * puts both the schema document and the generator in the app's bundle and
 * makes this package a runtime dependency of any app that wants payloads for
 * some other transport, which is a lot of weight for data the device did not
 * need to produce.
 *
 * Node-safe, and a test pins that: this entry reaches nothing under `src/sdk/`
 * or `src/panel/`, so importing it pulls in no React and no React Native.
 */
export { parseSchemasFile } from './src/shared/schema'
export { generate } from './src/shared/generate'
export type {
  GenerateOptions,
  GenerateResult,
  GenerateWarning,
} from './src/shared/generate'

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
