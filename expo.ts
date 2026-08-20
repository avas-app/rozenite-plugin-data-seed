/**
 * Expo entry point — makes `expo/fetch` seedable with no other app changes.
 *
 * ```ts
 * // index.ts, once, anywhere before the first request
 * import '@avasapp/rozenite-plugin-data-seed/expo'
 * ```
 *
 * `expo/fetch` is native: it goes through neither `globalThis.fetch` nor
 * `XMLHttpRequest`, so the patches `useSeeder({ http: true })` installs cannot
 * reach it. Its public module export cannot be replaced either — Metro compiles
 * `export * from './fetch'` to a getter with `configurable: false`, so
 * assignment throws in strict mode — which module code always is — and
 * `defineProperty` throws too.
 *
 * But that getter forwards to the *inner* module on every read
 * (`get: () => _fetch[key]`), and the inner module's own export is an ordinary
 * writable property. Patching there is therefore visible through the public
 * path, and — because the forwarding happens per read — it works no matter what
 * order this import lands in relative to code that imports `expo/fetch`.
 *
 * ## Why this is a separate entry point
 *
 * Reaching the inner module means a literal `require` of a path inside Expo,
 * which Metro resolves at *bundle* time. Doing that from the main entry would
 * make Expo a hard build-time dependency of this package and break every bare
 * React Native app that installed it. Nothing pulls this file into a bundle
 * unless the app imports it, so only Expo apps ever pay for it.
 *
 * That is also why this file imports nothing from the rest of the package: it
 * has to stay out of every bundle that does not opt in, and a module-level
 * rendezvous could resolve to a second copy — where the hook the SDK writes is
 * not the hook this file reads. A global has no such ambiguity.
 *
 * ## When it cannot work
 *
 * If a future Expo release moves that internal file, the *build* fails with an
 * unresolved-module error naming it — loud and immediate, not a silent gap.
 * Drop this import and use `seedableFetch` instead, which never touches Expo
 * internals:
 *
 * ```ts
 * import { fetch as expoFetch } from 'expo/fetch'
 * import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'
 * export const fetch = seedableFetch(expoFetch)
 * ```
 */

/**
 * Must match `FETCH_HOOK_KEY` in `src/sdk/adapters/http/runtime.ts`.
 *
 * Duplicated rather than imported, for the reason above. A test asserts the two
 * agree, because a silent mismatch here looks exactly like "seeding does not
 * work for expo/fetch" with nothing to point at.
 */
const FETCH_HOOK_KEY = '__rozeniteDataSeedFetchHook__'

/** Expo's internal implementation module, whose export is writable. */
const INNER_MODULE = 'expo/src/winter/fetch/fetch'
/** The public path, used only to confirm the patch is visible through it. */
const PUBLIC_MODULE = 'expo/fetch'

type FetchLike = (input: unknown, init?: unknown) => Promise<unknown>

type FetchHook = (
  impl: FetchLike,
  thisArg: unknown,
  input: unknown,
  init?: unknown,
) => Promise<unknown>

declare const __DEV__: boolean
declare function require(id: string): Record<string, unknown>

function isDev(): boolean {
  return typeof __DEV__ === 'undefined' ? false : __DEV__
}

function hook(): FetchHook | null {
  return (
    ((globalThis as unknown as Record<string, FetchHook | null | undefined>)[
      FETCH_HOOK_KEY
    ] ?? null) || null
  )
}

/**
 * Patches Expo's fetch, returning the undo.
 *
 * Called for you on import. Exported as well so a test — or an app that wants
 * to control the timing — can install and remove it explicitly.
 *
 * Returns a no-op when it could not patch, having said why. It never throws:
 * failing to install a debugging aid must not take the app down with it.
 */
export function installExpoFetchSeeding(): () => void {
  if (!isDev()) return () => {}

  let inner: Record<string, unknown>
  let publicModule: Record<string, unknown>
  try {
    inner = require(INNER_MODULE)
    publicModule = require(PUBLIC_MODULE)
  } catch (error) {
    warn(`could not load ${INNER_MODULE}: ${describe(error)}`)
    return () => {}
  }

  const original = inner.fetch
  if (typeof original !== 'function') {
    warn(`${INNER_MODULE} has no \`fetch\` export to wrap`)
    return () => {}
  }

  const impl = original as FetchLike
  const patched: FetchLike = function seededExpoFetch(
    this: unknown,
    input: unknown,
    init?: unknown,
  ) {
    const current = hook()
    if (!current) return impl.call(this, input, init)
    return current(impl, this, input, init)
  }

  try {
    inner.fetch = patched
  } catch (error) {
    warn(`${INNER_MODULE}.fetch is not writable: ${describe(error)}`)
    return () => {}
  }

  // The whole approach rests on the public getter forwarding to the inner
  // module. Verified rather than assumed — if Expo ever switches to copying the
  // value at import time, the patch would apply to a module nothing reads, and
  // seeding would quietly do nothing.
  if (publicModule.fetch !== patched) {
    inner.fetch = original
    warn(`${PUBLIC_MODULE} does not forward to ${INNER_MODULE} in this Expo version`)
    return () => {}
  }

  return () => {
    if (inner.fetch === patched) inner.fetch = original
  }
}

function warn(reason: string): void {
  console.warn(
    `[data-seed] expo/fetch is not seedable — ${reason}.\n` +
      '  Remove this import and wrap it explicitly instead:\n' +
      "    import { fetch as expoFetch } from 'expo/fetch'\n" +
      "    import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'\n" +
      '    export const fetch = seedableFetch(expoFetch)',
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

installExpoFetchSeeding()
