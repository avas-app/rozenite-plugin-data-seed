import type { TargetSnapshot } from '../../shared/types'
import { ADAPTER_REACT_QUERY } from '../../shared/target'
import type { TargetRef } from '../../shared/target'
import { serialize } from '../serialize'
import type { SeedAdapter, Session } from '../session'
import { clone } from '../clone'

/**
 * Hooks a TanStack `QueryClient` so the panel can both watch the cache and put
 * values into it that survive refetching.
 *
 * There is no `@tanstack/react-query` dependency anywhere in this package — the
 * client is typed structurally, so the plugin works against whatever v5 minor
 * the host app has installed and adds nothing to its dependency graph. That is
 * also why every field below is optional-checked before use: a version that
 * renames something should degrade, not crash the app it is meant to debug.
 */

type QueryState = {
  status?: 'pending' | 'success' | 'error'
  fetchStatus?: 'fetching' | 'paused' | 'idle'
  data?: unknown
  error?: unknown
  dataUpdatedAt?: number
}

export type QueryLike = {
  queryHash: string
  /**
   * `readonly` throughout, because TanStack's own `QueryKey` is
   * `readonly unknown[]`. A mutable array here compiles fine against a fake
   * client and then rejects a real `QueryClient` at the call site — which is
   * the entire point of typing this structurally, so it has to match exactly.
   */
  queryKey: readonly unknown[]
  state: QueryState
  options?: ResolvedOptions
  getObserversCount?: () => number
}

/**
 * `Query.setOptions`, reached through a cast rather than declared on
 * `QueryLike`.
 *
 * Its real signature is generic over the query's own types, so any concrete
 * parameter type we write here is narrower than TanStack's and makes the whole
 * of `QueryLike` fail to describe a real `Query` — the read model would break
 * to accommodate one write. Confining the looseness to the one call site that
 * needs it keeps `QueryLike` assignable from an unmodified `QueryClient`.
 */
type SeedableQuery = QueryLike & {
  setOptions?: (options: ResolvedOptions) => void
}

export type QueryCacheLike = {
  getAll: () => QueryLike[]
  subscribe: (listener: () => void) => () => void
  get?: (queryHash: string) => QueryLike | undefined
}

/** The surface of `QueryClient` this plugin touches. */
export type QueryClientLike = {
  getQueryCache: () => QueryCacheLike
  /**
   * Parameter deliberately `any`, return type deliberately not.
   *
   * The real signature is generic over six type parameters, and under
   * `strictFunctionTypes` the parameter is contravariant — so *any* concrete
   * type written here has to be assignable to TanStack's, which in practice
   * means reproducing their entire generic signature or failing. Pinning the
   * return type is what actually protects the code below, since that is the
   * side this plugin reads.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultQueryOptions: (options: any) => ResolvedOptions
  setQueryData: (queryKey: readonly unknown[], data: unknown) => unknown
  invalidateQueries: (filters?: {
    queryKey?: readonly unknown[]
    exact?: boolean
  }) => Promise<unknown>
  cancelQueries?: (filters?: {
    queryKey?: readonly unknown[]
    exact?: boolean
  }) => Promise<unknown>
}

type ResolvedOptions = {
  queryKey?: readonly unknown[]
  queryHash?: string
  queryFn?: unknown
  staleTime?: unknown
  gcTime?: unknown
  retry?: unknown
  refetchInterval?: unknown
  refetchOnMount?: unknown
  refetchOnWindowFocus?: unknown
  refetchOnReconnect?: unknown
  /**
   * Deliberately no `[key: string]: unknown` catch-all. An index signature
   * looks harmless — nothing here reads an unknown field — but TanStack's own
   * `QueryOptions` does not declare one, so adding it makes a real `Query` fail
   * to satisfy `QueryLike` and forces every caller into a cast.
   */
}

/**
 * Memo of seeded option objects, keyed by the resolved object TanStack handed
 * us. Weak so it cannot retain options for queries that have been collected.
 */
const seededCache = new WeakMap<
  ResolvedOptions,
  { appliedAt: number; options: ResolvedOptions }
>()

export function installReactQueryAdapter(
  client: QueryClientLike,
  session: Session,
): () => void {
  const disposers: Array<() => void> = []
  const seeds = session.seedReader(ADAPTER_REACT_QUERY)

  // ---- interception ----

  const original = client.defaultQueryOptions
  let intercept = false

  if (typeof original === 'function') {
    /**
     * `defaultQueryOptions` is the one place every query resolution passes
     * through, and — critically — it runs *after* observer options have been
     * merged over `setQueryDefaults`.
     *
     * That ordering is the whole reason for patching here. TanStack resolves
     * options as `{...queryDefaults, ...observerOptions}`, so a `queryFn`
     * registered through `setQueryDefaults` is shadowed by the one every
     * `useQuery` call passes inline, and a seed installed that way would be
     * silently ignored the moment anything refetched. Overriding the resolved
     * result is what makes a seed actually stick.
     */
    const patched = function patchedDefaultQueryOptions(
      this: unknown,
      options: ResolvedOptions,
    ): ResolvedOptions {
      const resolved = original.call(client, options)
      const hash = resolved?.queryHash
      if (!hash) return resolved

      const seed = seeds.get(hash)
      if (!seed) return resolved

      // Preserve identity for repeat resolutions of the same options object.
      // TanStack short-circuits when `_defaulted` is already set and hands back
      // the same object; returning a fresh one each time would make observers
      // look changed on every render.
      const memoized = seededCache.get(resolved)
      if (memoized && memoized.appliedAt === seed.appliedAt) return memoized.options

      const fallback = resolved.queryFn

      const seeded: ResolvedOptions = {
        ...resolved,
        /**
         * Reads the seed at *call* time and falls through to the app's own
         * `queryFn` when there is none.
         *
         * That indirection is what makes these options safe to leave installed
         * on a long-lived query: withdrawing a seed does not require finding
         * and un-patching every query it touched, because this function simply
         * starts delegating again. It also means updating a seed's value takes
         * effect on the next fetch without re-resolving any options.
         *
         * Clone per call — the app owns what it receives and is free to mutate
         * it, which would otherwise corrupt the seed for every later refetch.
         */
        queryFn: (context: unknown) => {
          const current = seeds.get(hash)
          if (current) return Promise.resolve(clone(current.data))
          if (typeof fallback === 'function') {
            return (fallback as (ctx: unknown) => unknown)(context)
          }
          return Promise.reject(
            new Error(`[data-seed] no queryFn to fall back to for ${hash}`),
          )
        },
        // A seed is authoritative until withdrawn. Left stale, background
        // refetches would fire constantly and re-resolve to the same value —
        // correct, but a needless render storm.
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchInterval: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      }

      seededCache.set(resolved, { appliedAt: seed.appliedAt, options: seeded })
      return seeded
    }

    client.defaultQueryOptions = patched as QueryClientLike['defaultQueryOptions']
    intercept = true

    disposers.push(() => {
      // Only restore if nothing else wrapped us afterwards; clobbering another
      // tool's patch would be worse than leaving ours in place.
      if (client.defaultQueryOptions === patched) {
        client.defaultQueryOptions = original
      }
    })
  }

  // ---- addressing ----

  const hashKey = (queryKey: readonly unknown[]): string => {
    // Ask the library rather than reimplementing its hashing, so this stays
    // correct across versions and honours any custom `queryKeyHashFn`.
    //
    // Guarded, because this is reached on the degraded path too: if
    // `defaultQueryOptions` was missing we still list and address queries, and
    // calling a non-function here would turn "seeds will not persist" into a
    // crash in the tool that was meant to explain it.
    if (typeof original !== 'function') return JSON.stringify(queryKey)
    try {
      return original.call(client, { queryKey })?.queryHash ?? JSON.stringify(queryKey)
    } catch {
      return JSON.stringify(queryKey)
    }
  }

  const findQuery = (queryHash: string): QueryLike | undefined => {
    const cache = client.getQueryCache()
    return cache.get?.(queryHash) ?? cache.getAll().find((q) => q.queryHash === queryHash)
  }

  const adapter: SeedAdapter = {
    id: ADAPTER_REACT_QUERY,
    label: 'React Query',
    intercept,
    enumerable: true,

    identify: (ref) => (ref.kind === 'key' ? hashKey(ref.key) : null),

    listTargets: () =>
      client
        .getQueryCache()
        .getAll()
        .map((query) => toSnapshot(query, Boolean(seeds.get(query.queryHash)))),

    readData: (identity) => {
      const query = findQuery(identity)
      return query ? serialize(query.state.data) : { kind: 'undefined' }
    },

    push: (ref, data) => {
      if (ref.kind !== 'key') return
      const queryKey = ref.key

      // A fetch already in flight would resolve *after* this write and
      // overwrite the seed with real data — a race that shows up exactly when
      // you seed a screen as it mounts, which is the common case.
      void client.cancelQueries?.({ queryKey, exact: true })
      client.setQueryData(queryKey, clone(data))

      /**
       * Retrofit the seed onto a query that was already built.
       *
       * Patching `defaultQueryOptions` only covers *resolution*, and a query
       * created before the seed existed has its resolved options stored on it
       * already. `refetchQueries` fetches with those stored options and never
       * re-resolves, so without this the seed is silently skipped for exactly
       * the queries most likely to be seeded — the ones already on screen.
       *
       * Re-running the (patched) resolver over the query's own options is
       * what folds the seed in; the delegating `queryFn` above keeps the
       * result correct after the seed is withdrawn.
       */
      const query = findQuery(hashKey(queryKey)) as SeedableQuery | undefined
      if (query?.setOptions && query.options) {
        try {
          query.setOptions(client.defaultQueryOptions(query.options))
        } catch {
          // Older or patched builds may not accept this; the seed still
          // applies on the next resolution, which is the common path.
        }
      }
    },

    invalidate: (ref) => {
      if (ref.kind !== 'key') return
      void client.invalidateQueries({ queryKey: ref.key, exact: true })
    },
  }

  disposers.push(session.registerAdapter(adapter))

  // ---- cache observation ----

  disposers.push(client.getQueryCache().subscribe(() => session.scheduleFlush()))

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

function toSnapshot(query: QueryLike, seeded: boolean): TargetSnapshot {
  const state = query.state ?? {}
  const ref: TargetRef = {
    kind: 'key',
    key: (serialize(query.queryKey).value as unknown[]) ?? [],
  }
  return {
    id: `${ADAPTER_REACT_QUERY}:${query.queryHash}`,
    adapter: ADAPTER_REACT_QUERY,
    ref,
    // TanStack's hash is already the JSON rendering of the key, and it is what
    // appears in the caller's source — no point re-deriving a second form.
    label: query.queryHash,
    status: state.status ?? 'pending',
    fetchStatus: state.fetchStatus ?? 'idle',
    observerCount: query.getObserversCount?.() ?? 0,
    updatedAt: state.dataUpdatedAt ?? 0,
    seeded,
    preview: serialize(state.data, { preview: true }),
    error: state.error ? errorMessage(state.error) : undefined,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
