/**
 * Metro supports `require.context`, but React Native ships no type for it.
 *
 * Copy this file into your own app if you use the `fixtures` option — it is
 * three lines and it keeps the call site free of casts.
 */
declare var require: {
  (id: string): unknown
  context: (
    directory: string,
    useSubdirectories?: boolean,
    regExp?: RegExp,
  ) => { keys: () => string[]; (id: string): unknown }
}
