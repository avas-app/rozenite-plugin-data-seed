# Changelog

## 0.2.0 — 2026-09-23

### Upgrading from 0.1.0

**Install the Rozenite bridges yourself.** `@rozenite/agent-bridge`,
`@rozenite/agent-shared` and `@rozenite/plugin-bridge` moved from
`dependencies` to required `peerDependencies` (`^2.2.0`), so the plugin now
binds to your app's copy instead of installing its own:

```bash
npm install --save-dev @rozenite/agent-bridge @rozenite/agent-shared @rozenite/plugin-bridge
```

Use the versions that match the Rozenite your app already runs. **Rozenite 2.2
is now the minimum**. 0.1.0 accepted 2.1, so apps still on 2.1 need to upgrade
Rozenite first.

Why: 0.1.0 pinned two of the bridges at exactly 2.1.0, so an app on a newer
Rozenite ended up with two copies. Two agent bridges mean two tool registries,
and the plugin could register its tools into the one the CLI was not talking
to. When that happened the plugin loaded fine but showed no agent tools.

**Deep imports into `dist/` must change.** The build output was renamed:

| 0.1.0                          | 0.2.0                                                |
| ------------------------------ | ---------------------------------------------------- |
| `dist/react-native/index.js`   | `dist/react-native/react-native.js`                  |
| `dist/react-native/index.cjs`  | `dist/react-native/cjs/react-native.js`              |
| `dist/react-native/index.d.ts` | `dist/react-native/react-native.d.ts`                |
| `dist/sdk/index.js`            | `dist/sdk/sdk.js` (CommonJS only, no ESM build)      |
| `dist/sdk/index.cjs`           | `dist/sdk/sdk.js`                                    |
| `dist/sdk/index.d.ts`          | `dist/sdk/sdk.d.ts`                                  |

Imports through the package name (`@avasapp/rozenite-plugin-data-seed`,
`…/sdk`, `…/expo`) resolve through the `exports` map and need no change.
`import { … } from '@avasapp/rozenite-plugin-data-seed/sdk'` still works from
Node ESM, because Node picks up the CommonJS entry's named exports.

### Added

- **Targets for types with no query key and no route.** A
  `data-seed.config.json` target can be `{ "name": "RealtimePayload", "type":
  "RealtimePayload<PresenceEvent>" }`. Use it for a payload that arrives over
  a websocket or a realtime channel. Its schema is extracted under a tagged
  `{ "name": … }` pattern so other tooling can read it. It is never seeded,
  never shown in the panel and never matched against a request. Each target
  sets exactly one of `key`, `route` or `name`. The schemas file stays at
  version 2, and an older plugin skips such an entry with a warning.
- **`parseSchemasFile` and `generate` from `./sdk`**, plus the
  `GenerateOptions`, `GenerateResult` and `GenerateWarning` types. Node
  callers such as test scripts and agent rigs can now read a schemas file
  and generate a payload without importing from `src/`. The entry still
  pulls in no React or React Native.

### Changed

- **`date.*` tokens are documented as epoch-relative.** They are offset from a
  fixed `2026-01-01` epoch, not from the current time, so a given seed always
  produces the same value. This is not a behaviour change: the docs used to
  say "within the last week", which was wrong. `docs/tokens.md` and
  `data-seed tokens` now explain this. Assert on ordering or format, not on
  closeness to the clock.
- **`data-seed tokens` finds the built SDK through the `exports` map** instead
  of a hardcoded `dist/sdk/index.js`. When the SDK is present but fails to load
  (for example, a missing peer), it prints the load error instead of reporting
  that the package is not built.

## 0.1.0 — 2026-08-20

First release.

- A DevTools panel that seeds TanStack Query cache entries, which survive
  refetches and invalidation. It can also seed HTTP responses by intercepting
  `fetch`, `XMLHttpRequest` (and so axios) and, through the `./expo` entry,
  `expo/fetch`.
- Named fixtures, saved to the consuming repo and bundled with the app.
- `data-seed extract` generates JSON Schemas from the app's TypeScript types,
  with `@fake` JSDoc tags to control values. `data-seed tokens` lists every
  token.
- An agent tool domain and typed descriptors on `./sdk`, for seeding without
  DevTools open, plus a bundled agent skill.
