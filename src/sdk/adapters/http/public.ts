import { wrapFetch } from './fetch'

/**
 * Makes one `fetch` implementation seedable.
 *
 * Only needed for a fetch that is **not** `globalThis.fetch`, because that one
 * is patched for you by `useSeeder({ http: true })`.
 *
 * For `expo/fetch`, prefer the dedicated entry — it needs no per-call-site
 * change and works wherever it lands in import order:
 *
 * ```ts
 * import '@avasapp/rozenite-plugin-data-seed/expo'
 * ```
 *
 * This is the fallback for when that cannot be used: a future Expo layout it
 * does not know about, or any other fetch you hold yourself.
 *
 * ```ts
 * import { fetch as expoFetch } from 'expo/fetch'
 * import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'
 *
 * export const fetch = seedableFetch(expoFetch)
 * ```
 *
 * It resolves the session per call rather than capturing it, so it is inert
 * until `useSeeder` mounts, inert again after it unmounts, and safe to call at
 * module scope — which is where you want it.
 *
 * The returned function keeps the signature of what you passed in.
 */
export function seedableFetch<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends (...args: any[]) => Promise<any>,
>(impl: T): T {
  return wrapFetch(impl as never) as unknown as T
}
