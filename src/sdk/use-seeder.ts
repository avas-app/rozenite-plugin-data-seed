import { useEffect, useRef } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type { SeedEventMap } from '../shared/types'
import { PLUGIN_ID } from '../shared/types'
import type { FixtureSource } from './fixtures'
import { loadFixtures } from './fixtures'
import { parseSchemasFile } from '../shared/schema'
import type { QueryClientLike } from './adapters/react-query'
import { installReactQueryAdapter } from './adapters/react-query'
import type { HttpAdapterOptions } from './adapters/http'
import { installHttpAdapter } from './adapters/http'
import { captureFrames } from './origin'
import { useSeedAgentTools } from './use-seed-agent-tools'
import { Session } from './session'

export type SeederOptions = {
  /**
   * A TanStack `QueryClient`. Seeds go into the cache and survive refetching.
   *
   * Typed structurally, so this package takes no dependency on
   * `@tanstack/react-query` and works against whatever v5 minor you have.
   */
  queryClient?: QueryClientLike | null
  /**
   * Intercept `fetch`, so responses can be seeded below whatever data layer
   * sits above them.
   *
   * Worth turning on even when `queryClient` is set: a seeded response still
   * runs the app's real parsing, transform and error handling on the way up,
   * where a seeded cache entry bypasses all of it. Pass an object to narrow
   * what is watched.
   *
   * ```ts
   * useSeeder({ queryClient, http: true })
   * ```
   */
  http?: boolean | HttpAdapterOptions
  /**
   * Fixtures bundled with the app, so everyone who clones the repo sees the
   * same list with no setup:
   *
   * ```ts
   * useSeeder({
   *   fixtures: require.context('./seeds', false, /\.json$/),
   * })
   * ```
   *
   * `./seeds` is the documented default, but the path is yours — it has to be a
   * literal here because Metro resolves `require.context` statically.
   */
  fixtures?: FixtureSource
  /**
   * Schemas extracted from your TypeScript types by `npx data-seed extract`,
   * so the panel can generate data rather than making you type it:
   *
   * ```ts
   * useSeeder({ schemas: require('./data-seed.schemas.json') })
   * ```
   */
  schemas?: unknown
  /** Escape hatch. The plugin is already inert outside `__DEV__`. */
  enabled?: boolean
}

declare const __DEV__: boolean

function isDev(): boolean {
  return typeof __DEV__ === 'undefined' ? false : __DEV__
}

/**
 * Lets the DevTools panel put arbitrary data into your app.
 *
 * Safe to call unconditionally: it is a no-op outside `__DEV__`, and a no-op
 * while every source is absent, so it can sit above the provider that creates
 * the query client.
 *
 * ```ts
 * useSeeder({ queryClient, http: true })
 * ```
 *
 * Instrumentation and bridge wiring are deliberately split across two effects.
 * The panel connects late and can disconnect at any time; keeping the session
 * alive independently means active seeds survive a DevTools reload rather than
 * silently reverting to live data underneath you.
 */
export function useSeeder(options: SeederOptions = {}): void {
  const { queryClient, http, fixtures, schemas, enabled = true } = options
  const active = enabled && isDev() && Boolean(queryClient || http)

  const sessionRef = useRef<Session | null>(null)

  const devToolsClient = useRozeniteDevToolsClient<SeedEventMap>({
    pluginId: PLUGIN_ID,
  })

  // Agent tools read the same session as the panel, and register independently
  // of it — `rozenite agent` works with no DevTools window open, which is what
  // lets a test put the app into a known state before driving the UI.
  useSeedAgentTools({ sessionRef, enabled: active })

  // `http` is commonly written as an inline object literal, which would be a
  // new value on every render and re-run the effect forever. Only its identity
  // is unstable; the options inside it are read once at install time.
  const httpRef = useRef(http)
  httpRef.current = http
  const httpEnabled = Boolean(http)

  // ---- instrumentation lifecycle (independent of the panel) ----
  useEffect(() => {
    if (!active) return

    const session = new Session()
    sessionRef.current = session
    const disposers: Array<() => void> = []

    if (queryClient) {
      disposers.push(installReactQueryAdapter(queryClient, session))
    }
    if (httpEnabled) {
      const current = httpRef.current
      disposers.push(
        installHttpAdapter(session, typeof current === 'object' ? current : {}),
      )
    }

    // Captured here rather than at module scope: this runs inside the app's own
    // call stack, so the frames above us belong to the consuming project — which
    // is exactly what the panel needs to locate it on disk.
    session.setFrames(captureFrames())
    // Loaded once per session rather than per panel connection: the modules are
    // already in the bundle, so this is a parse, but it is a parse over every
    // fixture in the directory.
    if (fixtures) session.setFixtures(loadFixtures(fixtures))
    if (schemas) {
      try {
        const parsed = parseSchemasFile(schemas)
        session.setSchemas(parsed.entries)
        // Individually broken entries are skipped rather than discarding the
        // file, so say which ones — otherwise "no schema covers this target" is
        // the only symptom, and it points at the config instead of the file.
        for (const problem of parsed.problems) {
          console.warn(`[data-seed] skipped a schema entry — ${problem}`)
        }
      } catch (error) {
        // A stale or hand-broken schemas file must not take the panel down with
        // it — everything except generation still works.
        console.warn(
          `[data-seed] ignoring schemas: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    return () => {
      for (const dispose of disposers.reverse()) dispose()
      session.dispose()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [active, queryClient, httpEnabled, fixtures, schemas])

  // ---- bridge wiring (re-runs whenever the panel attaches or detaches) ----
  useEffect(() => {
    const session = sessionRef.current
    if (!active || !session || !devToolsClient) return

    session.attachSink({
      targets: (targets) => devToolsClient.send('seed:targets', { targets }),
      seeds: (seeds) => devToolsClient.send('seed:seeds', { seeds }),
      fixtures: (list, problems) =>
        devToolsClient.send('seed:fixtures', { fixtures: list, problems }),
      capabilities: (capabilities) =>
        devToolsClient.send('seed:capabilities', capabilities),
    })

    devToolsClient.send('seed:snapshot', session.snapshot())

    const subscriptions = [
      devToolsClient.onMessage('seed:request-snapshot', () => {
        devToolsClient.send('seed:snapshot', session.snapshot())
      }),
      devToolsClient.onMessage('seed:apply', ({ target, data, meta }) => {
        session.apply(target, data, meta)
      }),
      devToolsClient.onMessage('seed:clear', ({ id }) => {
        session.clear(id)
      }),
      devToolsClient.onMessage('seed:clear-all', () => {
        session.clearAll()
      }),
      devToolsClient.onMessage('seed:read-data', ({ id }) => {
        devToolsClient.send('seed:data', { id, data: session.readData(id) })
      }),
      devToolsClient.onMessage('seed:read-fixture', ({ id }) => {
        devToolsClient.send('seed:fixture-data', {
          id,
          data: session.readFixture(id),
        })
      }),
      devToolsClient.onMessage('seed:read-schema', ({ ref }) => {
        devToolsClient.send('seed:schema', { ref, schema: session.schemaFor(ref) })
      }),
    ]

    return () => {
      subscriptions.forEach((subscription) => subscription.remove())
      session.attachSink(null)
    }
    // `sessionRef.current` is populated by the effect above, which React runs
    // first; `active`/`queryClient` changing re-runs both in order.
  }, [active, queryClient, httpEnabled, devToolsClient])
}
