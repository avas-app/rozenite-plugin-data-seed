/**
 * Regenerates the `dev.presets` block in `rozenite.config.ts`.
 *
 * Run with `bun run presets`.
 *
 * The presets are literal payloads because `rozenite.config.ts` cannot import
 * anything — Rozenite evaluates it with `new Function('module','exports',code)`
 * and no `require` in scope. Hand-maintaining them meant they silently drifted
 * from the wire types the moment those changed, and a panel developed against a
 * stale preset looks fine right up until a device connects.
 *
 * So they are *produced* here, by driving the real adapters against a real
 * `QueryClient` and a stubbed `fetch` and dumping the resulting snapshot. If the
 * wire shape changes, re-running this is the whole migration.
 */

import fs from 'node:fs'
import path from 'node:path'
import { QueryClient } from '@tanstack/react-query'

import { installHttpAdapter } from '../src/sdk/adapters/http'
import type { QueryClientLike } from '../src/sdk/adapters/react-query'
import { installReactQueryAdapter } from '../src/sdk/adapters/react-query'
import { loadFixtures } from '../src/sdk/fixtures'
import { Session } from '../src/sdk/session'
import { parseSchemasFile } from '../src/shared/schema'
import { keyTarget, routeTarget } from '../src/shared/target'
import type { Snapshot } from '../src/shared/types'

const ROOT = path.resolve(import.meta.dir, '..')
const SEEDS = path.join(ROOT, 'example/seeds')
const SCHEMAS = path.join(ROOT, 'example/data-seed.schemas.json')
const CONFIG = path.join(ROOT, 'rozenite.config.ts')

/** Canned responses for the stubbed fetch, by path. */
const RESPONSES: Record<string, { status: number; body: unknown }> = {
  '/v1/profile': { status: 503, body: { error: 'upstream unavailable' } },
  '/v1/feed': {
    status: 200,
    body: { items: [{ id: 1, headline: 'Ship the adapter split' }], cursor: null },
  },
}

function stubFetch(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    const match = Object.entries(RESPONSES).find(([route]) => url.includes(route))
    const { status, body } = match?.[1] ?? { status: 200, body: {} }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function readFixtures(): Record<string, unknown> {
  return Object.fromEntries(
    fs
      .readdirSync(SEEDS)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [
        `./${name}`,
        JSON.parse(fs.readFileSync(path.join(SEEDS, name), 'utf8')),
      ]),
  )
}

/**
 * Zeroes every clock-derived field.
 *
 * Without this the config churns on every run and every diff is noise, which is
 * how a generated file stops being regenerated.
 */
function stabilize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, inner) =>
      key === 'updatedAt' || key === 'appliedAt' ? 0 : inner,
    ),
  ) as T
}

async function buildSnapshot(): Promise<Snapshot> {
  const restore = stubFetch()

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session = new Session()

  const disposeQuery = installReactQueryAdapter(
    client as unknown as QueryClientLike,
    session,
  )
  const disposeHttp = installHttpAdapter(session)

  await client.fetchQuery({
    queryKey: ['todos'],
    queryFn: async () => ({
      data: [{ id: 1, title: 'Wire up the bridge', done: true }],
      meta: { requestId: 'req_1', durationMs: 400 },
    }),
  })
  await client
    .fetchQuery({
      queryKey: ['notifications'],
      queryFn: async () => {
        throw new Error('Request failed with status 500')
      },
    })
    .catch(() => {})
  // Left in flight on purpose, so one row renders as `fetching`.
  void client.fetchQuery({
    queryKey: ['settings'],
    queryFn: () => new Promise(() => {}),
  })

  session.apply(keyTarget(['user', 7]), {
    data: { id: 7, name: 'Seeded User', email: 'seeded@example.com' },
    meta: { requestId: 'req_seed', durationMs: 0 },
  })

  await fetch('https://api.example.invalid/v1/profile').catch(() => {})
  await fetch('https://api.example.invalid/v1/feed?page=1')
  session.apply(routeTarget('GET', '/v1/profile'), { error: 'upstream unavailable' }, {
    status: 503,
  })
  // Give the background body capture a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 10))

  session.setFixtures(loadFixtures(readFixtures()))
  session.setSchemas(parseSchemasFile(JSON.parse(fs.readFileSync(SCHEMAS, 'utf8'))).entries)

  const snapshot = stabilize(session.snapshot())

  disposeHttp()
  disposeQuery()
  session.dispose()
  restore()
  return snapshot
}

function schemaPreset(name: string, ref: unknown, entryType: string) {
  const file = parseSchemasFile(JSON.parse(fs.readFileSync(SCHEMAS, 'utf8')))
  const entry = file.entries.find((candidate) => candidate.type === entryType)
  if (!entry) throw new Error(`no schema entry for ${entryType}`)
  return { name, type: 'seed:schema', payload: { ref, schema: entry.schema } }
}

const HEADER = `/**
 * IMPORTANT: this file must be entirely self-contained.
 *
 * Rozenite loads it by transpiling the single file to CJS and evaluating it via
 * \`new Function('module', 'exports', code)\` — with no \`require\` in scope (see
 * \`@rozenite/vite-plugin/src/load-config.ts\`). Any \`import\` here becomes a
 * \`require(...)\` call at runtime and fails with "require is not defined".
 *
 * That is why the presets below are literal payloads. They are GENERATED — run
 * \`bun run presets\` to rebuild them from the real adapters (see
 * \`scripts/build-dev-presets.ts\`). Editing them by hand is how they drifted
 * from the wire types last time.
 *
 * The presets exist so the panel can be developed — and reviewed — without a
 * device attached. \`rozenite dev\` serves the real panel and injects these as if
 * they had arrived over the bridge.
 */
`

const full = await buildSnapshot()

/**
 * The same state, with nothing hookable.
 *
 * Derived rather than simulated: reproducing an unhookable `QueryClient`
 * faithfully means defeating a private field, and what the panel actually
 * renders from is this flag — so this is the honest fixture of that wire state.
 */
const degraded: Snapshot = {
  ...full,
  capabilities: {
    ...full.capabilities,
    adapters: full.capabilities.adapters.map((adapter) => ({
      ...adapter,
      intercept: false,
    })),
  },
}

const presets = [
  { name: 'Everything: queries, routes, fixtures, schemas', type: 'seed:snapshot', payload: full },
  schemaPreset('Schema for ["todos"]', { kind: 'key', key: ['todos'] }, 'ApiResponse<Todo[]>'),
  schemaPreset(
    'Schema for GET /v1/profile',
    { kind: 'route', method: 'GET', url: '/v1/profile' },
    'Profile',
  ),
  {
    name: 'Value for ["todos"]',
    type: 'seed:data',
    payload: {
      id: 'react-query:["todos"]',
      data: {
        kind: 'json',
        byteLength: 96,
        value: {
          data: [{ id: 1, title: 'Wire up the bridge', done: true }],
          meta: { requestId: 'req_1', durationMs: 400 },
        },
      },
    },
  },
  { name: 'Interception unavailable', type: 'seed:snapshot', payload: degraded },
  {
    name: 'Nothing seeded yet',
    type: 'seed:snapshot',
    payload: {
      frames: [],
      targets: [],
      seeds: [],
      fixtures: [],
      fixtureProblems: [],
      schemas: [],
      capabilities: {
        adapters: [
          { id: 'react-query', label: 'React Query', intercept: true, enumerable: true },
          { id: 'http', label: 'HTTP', intercept: true, enumerable: false },
        ],
        fixtures: false,
        schemas: false,
      },
    },
  },
]

const body = `${HEADER}export default {
  panels: [
    {
      name: 'Data Seed',
      source: './src/panel/index.tsx',
    },
  ],

  dev: {
    presets: ${JSON.stringify(presets, null, 6).replace(/\n/g, '\n    ')},
  },
}
`

fs.writeFileSync(CONFIG, body, 'utf8')

const adapters = full.capabilities.adapters.map((a) => a.id).join(', ')
console.log(
  `Wrote ${presets.length} presets to rozenite.config.ts` +
    ` (${full.targets.length} targets across ${adapters}, ${full.fixtures.length} fixtures)`,
)
