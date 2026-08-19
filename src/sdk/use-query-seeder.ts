import { useEffect, useRef } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type { QuerySeedEventMap } from '../shared/types'
import { PLUGIN_ID } from '../shared/types'
import type { FixtureSource } from './fixtures'
import { loadFixtures } from './fixtures'
import type { QueryClientLike } from './instrument'
import { instrumentClient } from './instrument'
import { captureFrames } from './origin'
import { Session } from './session'

export type QuerySeederOptions = {
  /**
   * Fixtures bundled with the app, so everyone who clones the repo sees the
   * same list with no setup:
   *
   * ```ts
   * useQuerySeeder(queryClient, {
   *   fixtures: require.context('./seeds', false, /\.json$/),
   * })
   * ```
   *
   * `./seeds` is the documented default, but the path is yours — it has to be a
   * literal here because Metro resolves `require.context` statically.
   */
  fixtures?: FixtureSource
  /** Escape hatch. The plugin is already inert outside `__DEV__`. */
  enabled?: boolean
}

declare const __DEV__: boolean

function isDev(): boolean {
  return typeof __DEV__ === 'undefined' ? false : __DEV__
}

/**
 * Lets the DevTools panel put arbitrary data into your TanStack Query cache.
 *
 * Safe to call unconditionally: it is a no-op outside `__DEV__` and a no-op
 * while `queryClient` is null, so it can sit above the provider that creates it.
 *
 * ```ts
 * useQuerySeeder(queryClient)
 * ```
 *
 * Instrumentation and bridge wiring are deliberately split across two effects.
 * The panel connects late and can disconnect at any time; keeping the session
 * alive independently means active seeds survive a DevTools reload rather than
 * silently reverting to live data underneath you.
 */
export function useQuerySeeder(
  queryClient: QueryClientLike | null | undefined,
  options: QuerySeederOptions = {},
): void {
  const { fixtures, enabled = true } = options
  const active = enabled && isDev() && Boolean(queryClient)

  const sessionRef = useRef<Session | null>(null)

  const devToolsClient = useRozeniteDevToolsClient<QuerySeedEventMap>({
    pluginId: PLUGIN_ID,
  })

  // ---- instrumentation lifecycle (independent of the panel) ----
  useEffect(() => {
    if (!active || !queryClient) return

    const session = new Session()
    sessionRef.current = session
    const dispose = instrumentClient(queryClient, session)
    // Captured here rather than at module scope: this runs inside the app's own
    // call stack, so the frames above us belong to the consuming project — which
    // is exactly what the panel needs to locate it on disk.
    session.setFrames(captureFrames())
    // Loaded once per session rather than per panel connection: the modules are
    // already in the bundle, so this is a parse, but it is a parse over every
    // fixture in the directory.
    if (fixtures) session.setFixtures(loadFixtures(fixtures))

    return () => {
      dispose()
      session.dispose()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [active, queryClient, fixtures])

  // ---- bridge wiring (re-runs whenever the panel attaches or detaches) ----
  useEffect(() => {
    const session = sessionRef.current
    if (!active || !session || !devToolsClient) return

    session.attachSink({
      queries: (queries) => devToolsClient.send('seed:queries', { queries }),
      seeds: (seeds) => devToolsClient.send('seed:seeds', { seeds }),
      fixtures: (list, problems) =>
        devToolsClient.send('seed:fixtures', { fixtures: list, problems }),
    })

    devToolsClient.send('seed:snapshot', session.snapshot())

    const subscriptions = [
      devToolsClient.onMessage('seed:request-snapshot', () => {
        devToolsClient.send('seed:snapshot', session.snapshot())
      }),
      devToolsClient.onMessage('seed:apply', ({ queryKey, data }) => {
        session.apply(queryKey, data)
      }),
      devToolsClient.onMessage('seed:clear', ({ queryHash }) => {
        session.clear(queryHash)
      }),
      devToolsClient.onMessage('seed:clear-all', () => {
        session.clearAll()
      }),
      devToolsClient.onMessage('seed:read-data', ({ queryHash }) => {
        devToolsClient.send('seed:data', {
          queryHash,
          data: session.readData(queryHash),
        })
      }),
      devToolsClient.onMessage('seed:read-fixture', ({ id }) => {
        devToolsClient.send('seed:fixture-data', {
          id,
          data: session.readFixture(id),
        })
      }),
    ]

    return () => {
      subscriptions.forEach((subscription) => subscription.remove())
      session.attachSink(null)
    }
    // `sessionRef.current` is populated by the effect above, which React runs
    // first; `active`/`queryClient` changing re-runs both in order.
  }, [active, queryClient, devToolsClient])
}
