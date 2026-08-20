import { wrapFetch } from './fetch'

/**
 * Makes one `fetch` implementation seedable.
 *
 * Only needed for a fetch that is **not** `globalThis.fetch`, because that one
 * is patched for you by `useSeeder({ http: true })`. The case this exists for is
 * `expo/fetch`:
 *
 * ```ts
 * import { fetch as expoFetch } from 'expo/fetch'
 * import { seedableFetch } from '@avasapp/rozenite-plugin-data-seed'
 *
 * export const fetch = seedableFetch(expoFetch)
 * ```
 *
 * `expo/fetch` is a native implementation — it goes through neither
 * `globalThis.fetch` nor `XMLHttpRequest`, so neither patch reaches it. Nor can
 * its module export be replaced: Metro compiles the re-export to a getter with
 * `configurable: false`, so assignment silently does nothing and
 * `Object.defineProperty` throws. Patching would mean reaching into
 * `expo/src/...`, which would make Expo a bundle-time dependency of this
 * package and break every bare React Native app that installed it.
 *
 * So this is the honest version: one line, at the import site, where it is
 * visible. It is inert until `useSeeder` mounts and inert again after it
 * unmounts, and it resolves the session per call — so it is safe at module
 * scope, which is where you want it.
 *
 * The returned function keeps the signature of what you passed in.
 */
export function seedableFetch<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends (...args: any[]) => Promise<any>,
>(impl: T): T {
  return wrapFetch(impl as never) as unknown as T
}
