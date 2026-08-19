/**
 * React Native entry point.
 *
 * Built to `dist/react-native/index.{js,cjs,d.ts}` and consumed as
 * `import { useQuerySeeder } from '@avasapp/rozenite-plugin-query-seed'`.
 *
 * Note there is no `@tanstack/react-query` dependency anywhere in this package —
 * the client is typed structurally, so the plugin works against whatever v5
 * minor the host app has installed, and adds nothing to its dependency graph.
 */

export { useQuerySeeder } from './src/sdk/use-query-seeder'
export type { QuerySeederOptions } from './src/sdk/use-query-seeder'
export type { QueryClientLike } from './src/sdk/instrument'
export type {
  Capabilities,
  QuerySnapshot,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
} from './src/shared/types'
