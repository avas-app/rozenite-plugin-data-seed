import { ADAPTER_HTTP } from '../../../shared/target'
import type { SeedAdapter, Session } from '../../session'
import { canBuildResponses, patchGlobalFetch } from './fetch'
import { HttpRuntime, clearActiveRuntime, routeIdentity, setActiveRuntime } from './runtime'
import { patchXhr } from './xhr'

export type { HttpAdapterOptions } from './runtime'
export { defaultRoutePattern } from './fetch'
export { seedableFetch } from './public'

/**
 * Seeds HTTP responses, for apps that do not route everything through a query
 * cache — and for cases where seeding *below* the cache is the point, since a
 * response seeded here still runs the app's real parsing, transform and error
 * handling on the way up.
 *
 * This adapter is shaped differently from the cache-backed ones, in three ways
 * that the rest of the plugin has to accommodate:
 *
 *  - **Nothing can be enumerated.** A route only becomes known once a request
 *    has gone out, so `listTargets` reports what has been *observed*, plus any
 *    seeded pattern that has not matched anything yet.
 *  - **Seeds are keyed by pattern, not by target.** `GET /api/users/*` is one
 *    seed covering every user, where a query key seed covers exactly one key.
 *    That is why lookup here scans rather than hashing.
 *  - **There is no cache to write into or invalidate.** A seed takes effect on
 *    the next request and withdrawing it needs no cleanup, which is why this
 *    adapter implements neither `push` nor `invalidate`.
 */
export function installHttpAdapter(
  session: Session,
  options: import('./runtime').HttpAdapterOptions = {},
): () => void {
  const seeds = session.seedReader(ADAPTER_HTTP)
  const runtime = new HttpRuntime(seeds, options, () => session.scheduleFlush())
  const disposers: Array<() => void> = []

  // Registered before any patch, so a `seedableFetch` wrapper created at module
  // scope starts working the moment the hook mounts.
  setActiveRuntime(runtime)
  disposers.push(() => clearActiveRuntime(runtime))

  /**
   * Interception needs a `Response` to hand back. Without one the adapter still
   * installs — observing traffic remains useful — but it reports
   * `intercept: false` so the panel says seeds will not apply rather than
   * letting you write one that silently does nothing.
   */
  const intercept = canBuildResponses()

  if (intercept) {
    disposers.push(patchGlobalFetch())
    if (options.xhr !== false) disposers.push(patchXhr())
  }

  const adapter: SeedAdapter = {
    id: ADAPTER_HTTP,
    label: 'HTTP',
    intercept,
    // A route is only known once it has been requested, which is what drives
    // the panel to offer a "seed a route you have not seen yet" input.
    enumerable: false,

    identify: (ref) =>
      ref.kind === 'route' ? routeIdentity(ref.method, ref.url) : null,

    listTargets: () => runtime.listTargets(),
    readData: (identity) => runtime.readData(identity),

    // No `push`: there is no cache to write into — the seed applies to the next
    // request. No `invalidate`: withdrawing it needs no cleanup for the same
    // reason. Both being absent is what tells the session this adapter only
    // intercepts.
  }

  disposers.push(session.registerAdapter(adapter))

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // A failing disposer must not prevent the rest from running.
      }
    }
  }
}
