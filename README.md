# @avasapp/rozenite-plugin-data-seed

An interactive data seeder for React Native DevTools, built on
[Rozenite](https://www.rozenite.dev).

Stop committing sample data to see a screen. Open DevTools, pick a target, paste
JSON, and it lands in your app — and **stays** there until you take it out.

Two things can be seeded:

- **TanStack Query cache entries**, which survive refetches, invalidation, and
  app focus.
- **HTTP responses**, by intercepting `fetch`, `XMLHttpRequest` (so, axios) and
  `expo/fetch`. Works with no query cache at all, and lets you force a 500.

Plus:

- **Committed fixtures** that ride in the app bundle, so teammates get them with
  no setup.
- **Generate from your TypeScript types**, annotated in-source with JSDoc.
- **Drive it headlessly** from a script or an E2E run, with no DevTools open.

## Install

```bash
npm install --save-dev @avasapp/rozenite-plugin-data-seed
```

Requires **Rozenite 2.1 or later**. Rozenite discovers the plugin automatically —
no `metro.config` change is needed beyond having Rozenite itself set up. TanStack
Query v5 is optional; so is having a query library at all.

## Usage

Call the hook once, anywhere in your component tree:

```ts
import { useSeeder } from '@avasapp/rozenite-plugin-data-seed'

function DevTools() {
  useSeeder({ queryClient, http: true })
  return null
}
```

Both sources are optional and independent. `{ queryClient }` alone seeds the
cache; `{ http: true }` alone seeds responses and needs no query library.

It is a no-op outside `__DEV__`, and a no-op while everything is absent, so it is
safe to call before the client exists:

```ts
useSeeder({ queryClient: isReady ? queryClient : null })
```

Then open React Native DevTools (`j` from the Metro terminal) and pick the
**Data Seed** tab.

That is enough to seed by hand. Two more options unlock the rest —
[`fixtures`](#fixtures) for committed states and [`schemas`](#generating-from-your-types)
for generation:

```ts
useSeeder({
  queryClient,
  http: true,
  fixtures: require.context('./seeds', false, /\.json$/),
  schemas: require('./data-seed.schemas.json'),
})
```

## Which layer to seed

Both adapters can cover the same screen, and they are not equivalent.

**Seed the cache** when you want to bypass everything below it, or when the data
never came from HTTP in the first place. Identity is your own query key, so it
reads like your source and does not care what the URL is.

**Seed the response** when you want the app's real code to run. A seeded response
still goes through your parsing, your `select`, your transform, and your error
handling on the way up — all of which a seeded cache entry skips. It is also the
only option for `fetch` calls that no query library ever sees.

If you are testing "does this screen render 200 items", seed the cache. If you
are testing "does this screen survive what the server actually sends", seed the
response.

### Why cache seeds stick

The obvious implementation is `queryClient.setQueryData(key, fake)`. It works for
about four seconds — the next window focus, remount, or `invalidateQueries`
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

## Seeding HTTP

`http: true` patches `globalThis.fetch` **and** `XMLHttpRequest`. A seeded route
is answered locally and never reaches the network; everything else passes
through untouched and is recorded so you can see what your app actually calls.

```ts
useSeeder({ http: true })
```

That covers `fetch`, everything built on it (ky, ofetch, graphql-request), and
everything built on XHR — **axios** being the one that matters. React Native's
`fetch` is itself a polyfill over XHR, so a single request would otherwise be
recorded twice; it is counted once, at the fetch layer.

`expo/fetch` needs one extra line — see [below](#expofetch-needs-one-line).

Routes are matched by pattern, so one seed covers a family of URLs:

| Pattern | Matches |
| --- | --- |
| `GET /api/todos` | that path on any host, with or without a query string |
| `/api/todos` | that path, any method |
| `GET /api/users/*` | `/api/users/7` — but **not** `/api/users/7/posts` |
| `GET /api/**` | everything under `/api`, across segments |
| `GET https://api.example.com/**` | only that host |

`*` stays inside one path segment and `**` crosses them, for the same reason key
patterns must match length exactly: without the distinction, a list schema
quietly starts generating data for a detail route.

**Set the status** next to the Apply button to answer with a 500, a 404, or a
429. Forcing an error is most of the reason to seed a request rather than a cache
entry, and it is the one state a real backend will not give you on demand.

### The route list is observed, not enumerated

A query cache can be listed before anything happens. HTTP cannot — a route only
becomes known once a request has gone out. So the panel shows what it has *seen*,
with a hit count, plus any seeded pattern nothing has matched yet.

To seed something that has never been requested — an endpoint behind an error
path you cannot reach — type it into the box at the top of the HTTP section. That
is the case the observed list cannot cover on its own.

### `expo/fetch` needs one line

`expo/fetch` is a **native** implementation — it goes through neither
`globalThis.fetch` nor `XMLHttpRequest`, so neither patch reaches it. Nor can its
module export be replaced: Metro compiles the re-export to a getter with
`configurable: false`, so assignment silently does nothing and
`Object.defineProperty` throws. Patching it would mean reaching into
`expo/src/...`, which would make Expo a bundle-time dependency of this package
and break every bare React Native app that installed it.

So it is wrapped explicitly, once, at your import site:

```ts
import { fetch as expoFetch } from 'expo/fetch'
import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'

export const fetch = seedableFetch(expoFetch)
```

Everything downstream then behaves exactly like a patched global — same route
patterns, same status control, same observed list. The wrapper resolves the
session per call, so it is safe at module scope, and it is inert outside
`__DEV__` and after the hook unmounts.

### What it still does not intercept

- **WebSockets**, and anything using a native networking module directly.
- **A `fetch` you captured before the hook mounted.** `const f = fetch` at module
  scope keeps the original. Call `fetch(...)` normally, or wrap it with
  `seedableFetch`.

Metro's own dev endpoints (`/symbolicate`, `/hot`, `/inspector/**`) are excluded
by default so they do not flood the list. The exclusions are deliberately narrow
paths rather than "anything on localhost", since plenty of people develop against
a local API. Override with `include` / `exclude`:

```ts
useSeeder({ http: { include: ['https://api.example.com/**'] } })
```

`xhr: false` leaves `XMLHttpRequest` alone, if another tool already owns it.

## What the panel shows

The target list carries only a **preview** of each value — the SDK never sends
full values unprompted, so a 40k-row feed costs the same as a settings object.
Opening a target fetches its real value into the editor on demand.

Rows are grouped by adapter once you have more than one. Query rows are annotated
with observer count: `inactive` means nothing on screen is subscribed, which is
worth knowing before you seed it and wonder why nothing changed. HTTP rows show a
hit count instead.

## Fixtures

A seed you have to retype is a seed you will not reuse. Point the hook at a
folder and every JSON file in it becomes a named fixture you can restore in one
click:

```ts
useSeeder({
  queryClient,
  fixtures: require.context('./seeds', false, /\.json$/),
})
```

`./seeds` is the documented default — change it by changing that path. It has to
be a literal, because Metro resolves `require.context` statically.

**That one line is the whole setup, and only one person has to write it.**
Fixtures ride in the app bundle, so a teammate who clones the repo opens the
panel and sees the same list with nothing to configure. Add a fixture file and
Metro re-bundles it in.

React Native ships no type for `require.context`; `example/require-context.d.ts`
is three lines you can copy.

### The file format

Plain, diff-friendly JSON — commit them and the whole team gets them:

```json
{
  "version": 2,
  "name": "cart with 50 items",
  "target": ["cart", { "userId": 7 }],
  "savedAt": "2026-08-19T10:00:00.000Z",
  "data": { "items": [] }
}
```

A route fixture names its route instead, and may carry a status:

```json
{
  "version": 2,
  "name": "profile — 503 outage",
  "target": { "kind": "route", "method": "GET", "url": "/v1/profile" },
  "savedAt": "2026-08-20T10:00:00.000Z",
  "meta": { "status": 503 },
  "data": { "error": "upstream unavailable" }
}
```

A fixture carries its own target, so restoring one seeds the right thing even if
that screen has never been opened. Hand-written fixtures work too — `target` and
`data` are the only required fields, and a malformed file is reported in the
panel by name rather than silently skipped.

Files written by v1 used `queryKey` instead of `target`. Those still read
correctly, so an existing `seeds/` directory needs no migration.

### Saving new fixtures

Reading needs nothing. *Writing* is the one thing a bundle cannot do, so the
first time you save, the panel asks for access to the folder — once, through
Chrome's directory picker, remembered afterwards. Two consequences:

- **Saving is Chrome-only.** Fine in practice, since React Native DevTools *is*
  Chrome. Reading works regardless.
- **Access needs re-granting after a browser restart.** Chrome downgrades the
  saved permission to `prompt`, so the panel shows a *Reconnect* button rather
  than failing silently.

The picker cannot be pre-navigated to your repo — `showDirectoryPicker` takes a
well-known folder or a handle, never a path, because letting a page steer the
dialog would leak your filesystem layout. Two things soften that: the picker has
a stable id, so Chrome reopens wherever it was last used, and the panel shows
your project's absolute path next to the button, which pastes into the dialog
with ⇧⌘G. The path is resolved through Metro's `/symbolicate`; if that fails, no
hint is shown rather than a wrong one.

You can also just write the file yourself. Nothing about a fixture requires the
panel to have created it.

## Generating from your types

Typing JSON by hand is still typing sample data. Point the extractor at your
TypeScript types once and the panel can generate a whole response instead.

```bash
npm install --save-dev ts-json-schema-generator   # optional peer, only for this
npx data-seed extract
```

It reads `data-seed.config.json`:

```json
{
  "tsconfig": "./tsconfig.json",
  "source": "./api.ts",
  "out": "./data-seed.schemas.json",
  "targets": [
    { "key": ["todos"],          "type": "ApiResponse<Todo[]>" },
    { "key": ["user", "*"],      "type": "ApiResponse<User>" },
    { "route": "GET /v1/profile", "type": "Profile" }
  ]
}
```

Then pass the result to the hook, alongside your fixtures:

```ts
useSeeder({
  queryClient,
  http: true,
  fixtures: require.context('./seeds', false, /\.json$/),
  schemas: require('./data-seed.schemas.json'),
})
```

Select a target and a **Generate** button appears, with controls for array length
and which union variant to produce.

### Seeing the shape

Click the type name next to **Generate** and the panel renders the type back as
TypeScript, so you can check what a response looks like without going to find it
in the source:

```ts
type ApiResponse<Todo[]> = {
  data: {
    id: number
    title: string  // @faker lorem.sentence
    done: boolean
    createdAt: string  // @faker date.recent
  }[]
  meta: {
    requestId: string
    durationMs: number
  }
}
```

Two things it shows that the source does not, at least not at a glance: which
fields carry a `@faker` annotation, and which are `any` — the second matters
because those are exactly the fields generation has to leave `null`.

Types used once are inlined to keep it short. Shared, recursive and union types
keep their names, so a comment tree ends at `replies: Comment[]` rather than
expanding forever, and a discriminated union reads the way it was written:

```ts
type Notification =
  | { kind: 'mention'; … }
  | { kind: 'system'; … }
```

### The target map is the part nothing can infer

`"key"` / `"route"` → `"type"` is written by hand, and there is no way around it:
TypeScript has no idea that `["user", 7]` returns a `User`, or that
`GET /v1/profile` returns a `Profile`.

For keys, `"*"` matches any single element, so one entry covers every user, and
patterns must match the key's length — `["todos"]` never captures
`["todos", "detail", 1]`. For routes, the glob rules
[above](#seeding-http) apply. In both cases an exact pattern beats a wildcard, so
`["user", 7]` can have its own schema without depending on file order.

Generic instantiations work directly. `ApiResponse<Todo[]>` is not a named type
and cannot be requested from a schema generator, so the CLI writes a temporary
module that names it, extracts, and deletes it.

### Controlling the values

An unannotated `string` becomes lorem text, because a bare `string` genuinely
could be a name, a URL, or an ISO date. Say which with a JSDoc tag on the field
itself:

```ts
export type User = {
  /** @faker number.int({min: 1, max: 9999}) */
  id: number
  /** @faker person.fullName */
  name: string
  /** @faker internet.email */
  email: string
  /** @faker date.past */
  createdAt: string
}
```

Annotations live in the source **deliberately**. A sidecar file keyed by type
path rots silently the moment someone renames a field; a JSDoc tag cannot
desync, gets reviewed in the same diff as the field, and survives refactors.

Available tokens: `person.*` (firstName, lastName, fullName), `internet.*`
(email, userName, url), `image.avatar`, `string.*` (uuid, alpha), `lorem.*`
(words, sentence, paragraph), `date.*` (recent, past, soon, future), `number.*`
(int, float), `datatype.boolean`, `phone.number`, `location.*` (city, country,
streetAddress). Arguments are JSON: `number.int({min: 1, max: 10})`.

There is no `@faker-js/faker` dependency — it is several megabytes for perhaps
thirty generators. The token syntax is faker-shaped so it reads the way you
expect; the implementations are local.

### What it tells you it could not do

Generation is reported honestly rather than papered over:

- **`any` and `unknown` fields** produce `null` and a warning naming the path.
  There is nothing to generate from, and inventing a shape would be worse.
- **Numbers are whole by default.** TypeScript has one numeric type, so an id, a
  count and a price all extract identically; most API numbers are integers, and
  `"id": 839.05` reads as broken data. Use `@faker number.float` for decimals.
- **Recursive types stop at a depth cap**, so a comment tree terminates.
- **Unknown `@faker` tokens** warn instead of silently substituting something.

Generation is seeded, so the same target and roll always produce the same value —
pressing **Generate** again is what rerolls it.

## Driving it without DevTools

Everything the panel does is also a `rozenite agent` tool, so a test or a script
can put the app into a known state with no DevTools window open. That is the
point of having committed fixtures — reaching the state is the slow part of an
E2E run, not asserting on it.

```bash
npx rozenite agent targets
npx rozenite agent session create
npx rozenite agent avasapp/data-seed tools -s <session>

npx rozenite agent avasapp/data-seed call -s <session> \
  --tool '@avasapp/rozenite-plugin-data-seed.apply-fixture' \
  --args '{"fixture": "cart with 50 items"}'
```

| Tool | What it does |
| --- | --- |
| `list-targets` | Everything seedable, summarised — values are not returned |
| `read-target` | One target's value; `found: false` rather than an error when absent |
| `apply-seed` | Seed a target and keep it seeded |
| `clear-seed` / `clear-all-seeds` | Withdraw seeds; seeded queries refetch |
| `list-fixtures` | Bundled fixtures, plus files that failed to parse |
| `apply-fixture` | Seed from a committed fixture, by id or name |
| `generate-seed` | Generate from the target's schema; `dryRun` to preview |

Every tool names its target with **exactly one** of `queryKey` or `route`:

```bash
--args '{"queryKey": ["user", 7], "data": {"name": "Ada"}}'
--args '{"route": "GET /api/users/*", "data": {}, "status": 500}'
```

Writes report `persistent`. It is `false` when the adapter could not be hooked,
meaning the seed is a one-shot write the next fetch erases — worth failing a test
over, and far easier to diagnose here than three assertions later.

For typed calls from Node, the descriptors are exported:

```ts
import { seedTools } from '@avasapp/rozenite-plugin-data-seed/sdk'

await session.callTool(seedTools.applyFixture, {
  fixture: 'cart with 50 items',
})
```

## Limitations

- **SWR is not supported yet.** The adapter seam exists for it; SWR's `use`
  middleware is the equivalent hook point.
- **`expo/fetch` is opt-in**, for the reasons in
  [`expo/fetch` needs one line](#expofetch-needs-one-line). It is the only
  transport that cannot be reached without touching app code.
- **Authoring fixtures is not scriptable.** Applying them is — see
  [Driving it without DevTools](#driving-it-without-devtools) — but *creating* a
  file goes through the browser, so CI cannot write new ones. The write path sits
  behind a `FixtureStore` interface so a CLI-backed implementation can be added
  without touching the UI.
- **Responses, not conversations.** This seeds what a request or a query
  *resolves to*. It does not sequence responses across calls, mock mutations, or
  simulate latency — that is a mock server's job, and [MSW](https://mswjs.io)
  already does it well.

## Example app

`example/` is a real Expo app with a real `QueryClient` and a fake API — no
network, no API key, no account. That is the point: the plugin exists so you do
not have to manufacture backend state to see a screen.

```bash
bun install && bun run build   # repo root
cd example && bun install && bun run ios
```

Two things worth trying:

- Seed `["todos"]`, then press **Break the API**. The screen keeps rendering your
  data while every request behind it fails.
- The last three cards have no React Query in them at all, and each uses a
  different one of React Native's three networking paths — `fetch`, axios over
  `XMLHttpRequest`, and native `expo/fetch`. All three point at a `.invalid`
  host, so they start broken by construction. Seed `GET /v1/profile`,
  `GET /v1/orders` or `GET /v1/invoice` and they render; set the status to 503
  and they break again.

It ships a `seeds/` directory covering the states that are tedious to reach
against a real backend — an empty list, 200 items, every variant of a
discriminated union, a 15-level-deep comment tree, a route outage — plus one
deliberately malformed file, so the panel's error surface is exercised too. One
fixture is left in the v1 format on purpose, so the compatibility claim above is
demonstrated rather than asserted.

Its types are also deliberately hostile — a generic `ApiResponse<T>` envelope, an
`any` leak, a self-recursive comment tree, a discriminated union, and ISO dates
carried as `string`. Those are the five shapes that break naive
TypeScript-to-JSON-Schema extraction.

## Development

```bash
bun install
bun test        # 176 tests
bun typecheck
bun run build
bun run presets # regenerate rozenite.config.ts dev presets
```

`bun dev` starts Rozenite's browser dev host on
[localhost:8888](http://localhost:8888) for quick panel iteration, using the
presets in `rozenite.config.ts`. Those are **generated** — that file cannot
import anything, since Rozenite evaluates it with `new Function` and no `require`
in scope, so `scripts/build-dev-presets.ts` drives the real adapters and writes
the literals. Editing them by hand is how they drifted from the wire types last
time.

## License

MIT
