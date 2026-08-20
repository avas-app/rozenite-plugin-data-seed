/**
 * Deep-clones a seed value before handing it to the app.
 *
 * Seeds arrive from the panel as plain JSON, so the JSON fallback is lossless
 * here — `structuredClone` is preferred only because it is faster and does not
 * choke on values a future non-panel caller might pass in.
 *
 * Every adapter needs this for the same reason: the app owns what it receives
 * and is free to mutate it, which would otherwise corrupt the seed for every
 * later read.
 */
export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // Fall through: structuredClone rejects functions and class instances.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}
