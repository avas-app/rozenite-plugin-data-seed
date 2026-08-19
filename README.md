# @avasapp/rozenite-plugin-query-seed

An interactive seeder for [TanStack Query](https://tanstack.com/query) in React
Native DevTools, built on [Rozenite](https://www.rozenite.dev).

Stop committing sample data to see a screen. Open DevTools, pick a query key,
paste JSON, and it lands in the cache — and **stays** there through refetches,
invalidation, and app focus, until you take it out.

## Install

```bash
npm install --save-dev @avasapp/rozenite-plugin-query-seed
```

Requires **Rozenite 2.1 or later** and **TanStack Query v5**. Rozenite discovers
the plugin automatically — no `metro.config` change is needed beyond having
Rozenite itself set up.

## Usage

Call the hook once, anywhere in your component tree, with your `QueryClient`:

```ts
import { useQuerySeeder } from '@avasapp/rozenite-plugin-query-seed'

function DevTools() {
  useQuerySeeder(queryClient)
  return null
}
```

It is a no-op outside `__DEV__`, and a no-op while the client is `null`, so it is
safe to call before the client exists:

```ts
useQuerySeeder(isReady ? queryClient : null)
```

Then open React Native DevTools (`j` from the Metro terminal) and pick the
**Query Seed** tab.

## Why seeds stick

The obvious implementation is `queryClient.setQueryData(key, fake)`. It works
for about four seconds — the next window focus, remount, or `invalidateQueries`
refetches the key and silently replaces your data with whatever the server says.

The next idea is `setQueryDefaults(key, { queryFn })`. That does not work at all:
TanStack resolves options as `{ ...queryDefaults, ...observerOptions }`, so the
`queryFn` every `useQuery` call passes inline shadows the defaulted one, and the
seed never fires.

This plugin wraps `queryClient.defaultQueryOptions` instead, which runs *after*
that merge and is therefore the first point where an override actually wins. A
seeded key resolves to a `queryFn` that returns your data, with `staleTime` and
`gcTime` pinned to `Infinity` and background refetching switched off.

Two consequences worth knowing:

- **Seeds are exact-key, not prefix.** Seeding `["todos"]` does not affect
  `["todos", "detail", 1]`. `setQueryDefaults` would have matched both.
- **Withdrawing a seed refetches.** Removing it leaves stale fake data in the
  cache, so the plugin invalidates the key to force real data back in.

## What the panel shows

The query list carries only a **preview** of each cache entry — the SDK never
sends full values unprompted, so a 40k-row feed costs the same as a settings
object. Opening a query fetches its real value into the editor on demand.

Rows are annotated with observer count: `inactive` means nothing on screen is
subscribed, which is worth knowing before you seed it and wonder why nothing
changed.

## Fixtures

A seed you have to retype is a seed you will not reuse. Switch the left rail to
**Fixtures**, point it at a folder once (`seeds/` in your repo is a good
default), and every seed can be saved under a name and restored in one click.

Fixtures are plain, diff-friendly JSON — commit them and the whole team gets
them:

```json
{
  "version": 1,
  "name": "cart with 50 items",
  "queryKey": ["cart", { "userId": 7 }],
  "savedAt": "2026-08-19T10:00:00.000Z",
  "data": { "items": [] }
}
```

A fixture carries its own `queryKey`, so restoring one seeds the right query
even if that screen has never been opened and the query is not in the cache yet.
Hand-written fixtures work too — `queryKey` and `data` are the only required
fields.

The folder is reached through the browser's File System Access API, which means
no extra install and no config, but two things follow from it:

- **Chrome only.** Fine in practice, since React Native DevTools *is* Chrome.
- **Access needs re-granting after a browser restart.** Chrome downgrades the
  saved permission to `prompt`, so the panel shows a *Reconnect folder* button
  rather than failing silently.

## Limitations

- **v1 is raw JSON.** You paste a value; there is no generation from types yet.
  See [Roadmap](#roadmap).
- **Fixtures are not scriptable yet.** Because the store runs in the browser,
  CI and E2E runs cannot load fixtures. The store sits behind a `FixtureStore`
  interface so a CLI-backed implementation can be added without touching the UI.
- **`queryFn`-level only.** This seeds what a query *resolves to*. It does not
  mock mutations, sequence responses, or simulate latency — that is a mock
  server's job, and [MSW](https://mswjs.io) already does it well.

## Roadmap

1. **Transport** — push arbitrary JSON at a key, make it stick. *(done)*
2. **Fixtures** — name a seed, write it to the repo, restore it in one click.
3. **Typed generation** — extract JSON Schema from the app's TypeScript types
   via `ts-json-schema-generator`, annotate fields in-source with JSDoc
   (`/** @faker person.fullName */`), and generate from that. Annotations live
   next to the field deliberately: a sidecar keyed by type path silently rots
   the moment someone renames something.
4. **Headless access** — an agent domain plus a CLI-backed fixture store, so a
   test run can seed a known cache state with no DevTools window open.

## Example app

`example/` is a real Expo app with a real `QueryClient` and a fake API — no
network, no API key, no account. That is the point: the plugin exists so you do
not have to manufacture backend state to see a screen.

```bash
bun install && bun run build   # repo root
cd example && bun install && bun run ios
```

Seed `["todos"]`, then press **Break the API**. The screen keeps rendering your
data while every request behind it fails.

Its types are also deliberately hostile — a generic `ApiResponse<T>` envelope,
an `any` leak, a self-recursive comment tree, a discriminated union, and ISO
dates carried as `string`. Those are the five shapes that break naive
TypeScript-to-JSON-Schema extraction, and they are in the repo from day one so
milestone 3 has something real to fail against.

## License

MIT
