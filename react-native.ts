/**
 * React Native entry point.
 *
 * Built to `dist/react-native/index.{js,cjs,d.ts}` and consumed as
 * `import { useSeeder } from '@avasapp/rozenite-plugin-data-seed'`.
 *
 * Note there is no `@tanstack/react-query` dependency anywhere in this package —
 * the client is typed structurally, so the plugin works against whatever v5
 * minor the host app has installed, and adds nothing to its dependency graph.
 */

export { useSeeder } from './src/sdk/use-seeder'
export type { SeederOptions } from './src/sdk/use-seeder'
export type { FixtureContext, FixtureSource } from './src/sdk/fixtures'
export type { QueryClientLike } from './src/sdk/adapters/react-query'
export type { HttpAdapterOptions } from './src/sdk/adapters/http'
export type { Fixture, FixtureSummary } from './src/shared/fixture'
export type { SeedTarget, TargetRef } from './src/shared/target'
export type {
  AdapterInfo,
  BundledFixture,
  Capabilities,
  SeedMeta,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
  TargetSnapshot,
} from './src/shared/types'
