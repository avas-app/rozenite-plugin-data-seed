---
name: query-seed
description: "Put a running React Native app's TanStack Query cache into a chosen state through the @avasapp/rozenite-plugin-query-seed DevTools plugin — apply committed fixtures, seed arbitrary JSON, or generate data from the app's own TypeScript types — via the `avasapp/query-seed` Rozenite agent domain. Use whenever a screen needs specific data to test against: an empty list, a huge list, an error, a union variant, or any state that is tedious to reach against a real backend."
---

# Seeding the TanStack Query cache

`@avasapp/rozenite-plugin-query-seed` hooks a live `QueryClient` and exposes it
as the **`avasapp/query-seed`** Rozenite agent domain. Use it to reach a UI state
directly instead of driving the app there through its own flows.

A seed survives refetching, invalidation and app focus until you withdraw it, so
you can seed once and then interact normally.

Prerequisite: the app must mount `useQuerySeeder(queryClient)` in a development
build. If the domain is missing from `npx rozenite agent list-domains`, that hook
is not mounted (or the client is null) — say so rather than reaching for a
substitute. See **Setup**.

## Calling the tools

Run from the app root where Metro is started. Create a session once and pass
`-s` on every call.

```bash
npx rozenite agent session create
npx rozenite agent avasapp/query-seed call -s <id> \
  --tool '@avasapp/rozenite-plugin-query-seed.list-queries'
```

Tool names are fully qualified with the package name. Arguments go in `--args`
as JSON.

## Tools

| Tool | Notes |
| --- | --- |
| `list-queries` | Every cached query, summarised. Filters: `search`, `onlySeeded`, `limit`. **No values** — use `read-query`. |
| `read-query` | One query's value by `queryKey`. Returns `found: false` for an absent key rather than erroring. |
| `apply-seed` | `{queryKey, data}`. Works for keys never fetched. |
| `clear-seed` | `{queryKey}`. Withdraws and refetches. |
| `clear-all-seeds` | Withdraws every seed. |
| `list-fixtures` | Committed fixtures, plus files that failed to parse. |
| `apply-fixture` | `{fixture}` — id or name from `list-fixtures`. |
| `generate-seed` | `{queryKey, items?, variant?, seed?, dryRun?}` from the query's extracted schema. |

## Choosing an approach

**Prefer `apply-fixture`.** Committed fixtures are named, reviewed states that
the team shares. Check `list-fixtures` before inventing data.

**`generate-seed` for volume or variants.** `items` controls array length, so
`{"items": 200}` produces a long list without a fixture file. `variant` picks a
branch of a discriminated union by index. `dryRun: true` returns the value
without touching the cache.

**`apply-seed` when the exact bytes matter** — reproducing a specific payload
from a bug report, for instance.

## Reading the results

**`persistent: false` on any write is a real problem.** It means the
`QueryClient` could not be hooked, so the seed is a one-shot write that the next
refetch erases. Report it rather than continuing; assertions after it are
unreliable.

**`warnings` from `generate-seed` name what could not be produced.** A field
typed `any` or `unknown` generates `null` and warns, because there is nothing to
generate from. If a screen needs that field, seed it explicitly instead.

**`problems` from `list-fixtures`** are malformed fixture files, reported by name
so a typo is visible rather than silently absent.

## Cleaning up

Seeds outlive the panel and the agent session — that is deliberate, so a reload
does not silently revert the app under you. Call `clear-all-seeds` when done, or
the next person to look at the app sees fake data with no indication why.

## Setup

If the domain is absent, the app is missing the hook:

```ts
import { useQuerySeeder } from '@avasapp/rozenite-plugin-query-seed'

useQuerySeeder(queryClient, {
  fixtures: require.context('./seeds', false, /\.json$/),
  schemas: require('./query-seed.schemas.json'),
})
```

`fixtures` is what makes `apply-fixture` work; `schemas` is what makes
`generate-seed` work. Neither is required for `apply-seed`. Schemas come from
`npx query-seed extract`, which reads `query-seed.config.json`.
