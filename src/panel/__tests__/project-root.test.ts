import { describe, expect, test } from 'bun:test'

import { resolveProjectRoot } from '../fixtures/project-root'

const FRAMES = [
  { file: 'http://localhost:8081/index.bundle', lineNumber: 1, column: 1 },
]

function framesFor(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    file: `http://localhost:8081/chunk${i}.bundle`,
    lineNumber: i + 1,
    column: 1,
  }))
}

/**
 * Answers one frame per call, in order — mirroring the real endpoint, which is
 * now asked about a single frame at a time. `null` entries stand for a frame
 * Metro refuses (HTTP 500), which is what lazy sub-bundles produce.
 */
function respond(files: Array<string | null>): typeof fetch {
  let call = 0
  return (async () => {
    const file = files[call++]
    if (file === null || file === undefined) return { ok: false }
    return { ok: true, json: async () => ({ stack: [{ file }] }) }
  }) as unknown as typeof fetch
}

describe('resolveProjectRoot', () => {
  test('returns the directory of the first app frame', async () => {
    const root = await resolveProjectRoot(
      FRAMES,
      respond(['/Users/me/repo/example/App.tsx']),
    )
    expect(root).toBe('/Users/me/repo/example')
  })

  test('skips node_modules — those frames are the plugin, not the app', async () => {
    const root = await resolveProjectRoot(
      framesFor(2),
      respond([
        '/Users/me/repo/node_modules/react/index.js',
        '/Users/me/repo/src/App.tsx',
      ]),
    )
    expect(root).toBe('/Users/me/repo/src')
  })

  test('skips frames that failed to map and came back as the bundle URL', async () => {
    const root = await resolveProjectRoot(
      framesFor(2),
      respond([
        'http://localhost:8081/index.bundle?platform=ios',
        '/Users/me/repo/App.tsx',
      ]),
    )
    expect(root).toBe('/Users/me/repo')
  })

  test('handles Windows paths', async () => {
    const root = await resolveProjectRoot(
      FRAMES,
      respond(['C:\\Users\\me\\repo\\App.tsx']),
    )
    expect(root).toBe('C:\\Users\\me\\repo')
  })

  test('returns null rather than a guess when nothing maps', async () => {
    expect(await resolveProjectRoot(FRAMES, respond([null]))).toBeNull()
    expect(await resolveProjectRoot(FRAMES, respond([]))).toBeNull()
  })

  test('no frames means no request at all', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return { ok: true, json: async () => ({ stack: [] }) }
    }) as unknown as typeof fetch
    expect(await resolveProjectRoot([], spy)).toBeNull()
    expect(called).toBe(false)
  })

  test('a failing symbolicate is not an error, just no hint', async () => {
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await resolveProjectRoot(FRAMES, failing)).toBeNull()

    const notOk = (async () => ({ ok: false })) as unknown as typeof fetch
    expect(await resolveProjectRoot(FRAMES, notOk)).toBeNull()
  })

  test('a frame Metro refuses does not abort the search', async () => {
    // Exactly the Expo lazy-bundling case: the plugin's own chunk 500s, the
    // app's chunk resolves.
    const root = await resolveProjectRoot(
      framesFor(2),
      respond([null, '/Users/me/repo/example/App.tsx']),
    )
    expect(root).toBe('/Users/me/repo/example')
  })
})
