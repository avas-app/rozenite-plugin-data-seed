---
name: data-seed
description: "Put a running React Native app into a chosen data state through the @avasapp/rozenite-plugin-data-seed DevTools plugin — seed TanStack Query cache entries or intercept HTTP responses, apply committed fixtures, or generate data from the app's own TypeScript types — via the `avasapp/data-seed` Rozenite agent domain. Use whenever a screen needs specific data to test against: an empty list, a huge list, a 500, a union variant, or any state that is tedious to reach against a real backend."
---

# Seeding a running app

`@avasapp/rozenite-plugin-data-seed` exposes a live app as the
**`avasapp/data-seed`** Rozenite agent domain. Use it to reach a UI state
directly instead of driving the app there through its own flows.

A seed survives refetching, invalidation and app focus until you withdraw it, so
you can seed once and then interact normally.

Prerequisite: the app must mount `useSeeder(...)` in a development build. If the
domain is missing from `npx rozenite agent list-domains`, that hook is not
mounted — say so rather than reaching for a substitute. See **Setup**.

## Two kinds of target

Every tool names what it acts on with **exactly one** of these:

| Field | Example | Seeds |
| --- | --- | --- |
| `queryKey` | `["user", 7]` | A TanStack Query cache entry |
| `route` | `"GET /api/users/*"` | The response to a matching HTTP request |

Passing both is an error, and so is passing neither.

**Which to use.** Seeding the **cache** bypasses everything below it and is
addressed by the app's own key, so it reads like the source. Seeding the
**route** runs the app's real parsing, transform and error handling on the way
up, and is the only option for `fetch` calls no query library sees.

If the goal is "make this screen show 200 items", use `queryKey`. If it is "make
this screen handle what the server actually returns", use `route`.

Route globs: `*` matches within one path segment, `**` crosses segments. So
`GET /api/users/*` covers `/api/users/7` but **not** `/api/users/7/posts`. An
omitted method matches any method.

Routes cover `fetch` and `XMLHttpRequest` (so axios) automatically. `expo/fetch`
is native and reaches neither, so it only works if the app wrapped it with
`seedableFetch` — if a route seed applies but an `expo/fetch` call still hits the
network, that is the missing piece. See **Setup**.

## Calling the tools

Run from the app root where Metro is started. Create a session once and pass
`-s` on every call.

```bash
npx rozenite agent session create
npx rozenite agent avasapp/data-seed call -s <id> \
  --tool '@avasapp/rozenite-plugin-data-seed.list-targets'
```

Tool names are fully qualified with the package name. Arguments go in `--args`
as JSON.

## Tools

| Tool | Notes |
| --- | --- |
| `list-targets` | Everything seedable, summarised. Filters: `search`, `adapter`, `onlySeeded`, `limit`. **No values** — use `read-target`. Also returns `adapters`. |
| `read-target` | One target's value. Returns `found: false` when there is nothing there rather than erroring. |
| `apply-seed` | `{queryKey|route, data, status?}`. Works for targets never used. |
| `clear-seed` | `{queryKey|route}`. A seeded query refetches; a seeded route just stops being intercepted. |
| `clear-all-seeds` | Withdraws every seed across every adapter. |
| `list-fixtures` | Committed fixtures, plus files that failed to parse. |
| `apply-fixture` | `{fixture}` — id or name from `list-fixtures`. |
| `generate-seed` | `{queryKey|route, items?, variant?, seed?, status?, dryRun?}` from the target's extracted schema. |

## Choosing an approach

**Prefer `apply-fixture`.** Committed fixtures are named, reviewed states that
the team shares. Check `list-fixtures` before inventing data.

**`generate-seed` for volume or variants.** `items` controls array length, so
`{"items": 200}` produces a long list without a fixture file. `variant` picks a
branch of a discriminated union by index. `dryRun: true` returns the value
without applying it.

**`apply-seed` when the exact bytes matter** — reproducing a specific payload
from a bug report, for instance.

**`status` to test failure paths.** Routes only. `{"route": "GET /api/me",
"data": {}, "status": 500}` is the cleanest way to make a screen show its error
state, and it is the one thing a real backend will not do on request.

## HTTP routes only appear once used

`list-targets` can enumerate the whole query cache, but an HTTP route is only
known after a request has gone out. An empty HTTP section means "nothing has been
requested yet", not "there is nothing to seed".

You can still seed a route that has never been called — `apply-seed` with a
`route` works regardless, and the seeded pattern then shows up in `list-targets`
with `hits: 0`. That is the right move for an endpoint behind an error path you
cannot otherwise reach.

## Reading the results

**`persistent: false` on any write is a real problem.** It means the adapter
could not be hooked, so the seed is a one-shot write that the next fetch erases.
Report it rather than continuing; assertions after it are unreliable.

**"No adapter handles …" means the source is not installed.** Seeding a `route`
in an app that mounted `useSeeder({ queryClient })` without `http: true` fails
this way. The error names what *is* installed.

**`warnings` from `generate-seed` name what could not be produced.** A field
typed `any` or `unknown` generates `null` and warns, because there is nothing to
generate from. If a screen needs that field, seed it explicitly instead.

An `unknown @fake token` warning means the app's own source has a bad
annotation. `npx data-seed tokens` prints the whole vocabulary with examples;
the warning also names the closest match. The tag is `@fake` — `@faker` is the
original spelling and still works, but no faker library is involved and only the
listed tokens exist.

**`problems` from `list-fixtures`** are malformed fixture files, reported by name
so a typo is visible rather than silently absent.

## Cleaning up

Seeds outlive the panel and the agent session — that is deliberate, so a reload
does not silently revert the app under you. Call `clear-all-seeds` when done, or
the next person to look at the app sees fake data with no indication why.

## Setup

If the domain is absent, the app is missing the hook:

```ts
import { useSeeder } from '@avasapp/rozenite-plugin-data-seed'

useSeeder({
  queryClient,
  http: true,
  fixtures: require.context('./seeds', false, /\.json$/),
  schemas: require('./data-seed.schemas.json'),
})
```

For `expo/fetch`, the app also has to wrap it once at its import site, because
its module export cannot be patched:

```ts
import { fetch as expoFetch } from 'expo/fetch'
import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'

export const fetch = seedableFetch(expoFetch)
```

`queryClient` enables `queryKey` targets; `http: true` enables `route` targets
for `fetch` and axios;
`fixtures` is what makes `apply-fixture` work; `schemas` is what makes
`generate-seed` work. None is required for a plain `apply-seed` against an
installed adapter. Schemas come from `npx data-seed extract`, which reads
`data-seed.config.json`.

Field-level values are controlled by `@fake` JSDoc tags in the app's own types
(`/** @fake person.fullName */`). `npx data-seed tokens` lists every one.
