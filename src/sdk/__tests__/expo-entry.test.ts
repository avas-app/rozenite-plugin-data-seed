import { afterEach, describe, expect, test } from 'bun:test'

import { FETCH_HOOK_KEY } from '../adapters/http/runtime'
import { installHttpAdapter } from '../adapters/http'
import { routeTarget } from '../../shared/target'
import { Session } from '../session'

/**
 * The `./expo` entry.
 *
 * It cannot be imported here the way an app imports it — the real module
 * `require`s a path inside Expo, which only resolves inside a Metro bundle. So
 * these cover the two things that are actually this repo's to get right: that
 * the global rendezvous the entry hard-codes still matches the SDK's, and that
 * the patch shape it installs behaves correctly against a stand-in for Expo's
 * module pair.
 *
 * The end-to-end proof is the example app, which imports the real entry and
 * seeds a real native `expo/fetch` request.
 */

/** Mirrors the literal in `expo.ts`, which cannot import it. */
const KEY_IN_EXPO_ENTRY = '__rozeniteDataSeedFetchHook__'

let teardown: (() => void) | null = null

afterEach(() => {
  teardown?.()
  teardown = null
})

describe('the rendezvous', () => {
  test('the key hard-coded in expo.ts still matches the SDK', async () => {
    const source = await Bun.file(
      new URL('../../../expo.ts', import.meta.url).pathname,
    ).text()
    const match = /const FETCH_HOOK_KEY = '([^']+)'/.exec(source)
    expect(match?.[1]).toBe(FETCH_HOOK_KEY)
    expect(FETCH_HOOK_KEY).toBe(KEY_IN_EXPO_ENTRY)
  })

  test('installing the adapter publishes a hook, and disposing clears it', () => {
    const scope = globalThis as unknown as Record<string, unknown>
    expect(scope[FETCH_HOOK_KEY] ?? null).toBeNull()

    const session = new Session()
    const dispose = installHttpAdapter(session)
    expect(typeof scope[FETCH_HOOK_KEY]).toBe('function')

    dispose()
    expect(scope[FETCH_HOOK_KEY] ?? null).toBeNull()
  })
})

/**
 * Stands in for Expo's module pair: an inner module with a writable `fetch`,
 * and a public namespace whose getter forwards to it on every read. That
 * forwarding is the entire premise of the approach, so the fake reproduces it
 * exactly — including `configurable: false`, which is what stops the public
 * object being patched directly.
 */
function fakeExpoModules(native: string[]) {
  const inner: Record<string, unknown> = {
    fetch: async (url: unknown) => {
      native.push(String(url))
      return new Response('{"source":"native"}', { status: 200 })
    },
  }
  const publicModule: Record<string, unknown> = {}
  Object.defineProperty(publicModule, 'fetch', {
    enumerable: true,
    get: () => inner.fetch,
  })
  return { inner, publicModule }
}

/** The patch `expo.ts` installs, reproduced against the stand-in. */
function installAgainst(inner: Record<string, unknown>) {
  const impl = inner.fetch as (input: unknown, init?: unknown) => Promise<unknown>
  const patched = function seededExpoFetch(
    this: unknown,
    input: unknown,
    init?: unknown,
  ) {
    const hook = (globalThis as unknown as Record<string, unknown>)[FETCH_HOOK_KEY] as
      | ((
          impl: typeof patched,
          thisArg: unknown,
          input: unknown,
          init?: unknown,
        ) => Promise<unknown>)
      | null
      | undefined
    if (!hook) return impl.call(this, input, init)
    return hook(impl as never, this, input, init)
  }
  inner.fetch = patched
  return () => {
    if (inner.fetch === patched) inner.fetch = impl
  }
}

describe('patching through the inner module', () => {
  test('the public getter sees the patch, which is what makes this work', () => {
    const { inner, publicModule } = fakeExpoModules([])
    const undo = installAgainst(inner)
    expect(publicModule.fetch).toBe(inner.fetch)
    undo()
  })

  test('the public export itself cannot be patched, which is why we go inner', () => {
    const { publicModule } = fakeExpoModules([])
    // Assigning to a getter with no setter throws in strict mode, which module
    // code always is…
    expect(() => {
      publicModule.fetch = () => 'nope'
    }).toThrow(TypeError)
    // …and redefining throws too, because the descriptor is not configurable.
    expect(() =>
      Object.defineProperty(publicModule, 'fetch', { value: () => 'nope' }),
    ).toThrow(TypeError)
  })

  test('a seeded route is served through expo/fetch and never reaches native', async () => {
    const native: string[] = []
    const { inner, publicModule } = fakeExpoModules(native)
    const undoPatch = installAgainst(inner)

    const session = new Session()
    const dispose = installHttpAdapter(session)
    teardown = () => {
      dispose()
      undoPatch()
    }

    session.apply(routeTarget('GET', '/v1/invoice'), { number: 'INV-1' })

    // Called the way a consumer does: read off the public namespace per call.
    const call = publicModule.fetch as (url: string) => Promise<Response>
    const seeded = await call('https://api.example.invalid/v1/invoice')
    expect(await seeded.json()).toEqual({ number: 'INV-1' })
    expect(native).toHaveLength(0)

    const real = await call('https://api.example.invalid/v1/other')
    expect(await real.json()).toEqual({ source: 'native' })
    expect(native).toEqual(['https://api.example.invalid/v1/other'])
  })

  test('order does not matter: the getter is read per call, not captured', async () => {
    const native: string[] = []
    const { inner, publicModule } = fakeExpoModules(native)

    // A consumer that grabbed the namespace *before* the patch — which is the
    // realistic case, since app modules import expo/fetch at startup.
    const namespaceHeldEarly = publicModule

    const undoPatch = installAgainst(inner)
    const session = new Session()
    const dispose = installHttpAdapter(session)
    teardown = () => {
      dispose()
      undoPatch()
    }

    session.apply(routeTarget('GET', '/v1/invoice'), { number: 'INV-2' })
    const call = namespaceHeldEarly.fetch as (url: string) => Promise<Response>
    expect(await (await call('https://x.com/v1/invoice')).json()).toEqual({
      number: 'INV-2',
    })
    expect(native).toHaveLength(0)
  })

  test('with no adapter installed it is a transparent passthrough', async () => {
    const native: string[] = []
    const { inner, publicModule } = fakeExpoModules(native)
    const undo = installAgainst(inner)

    const call = publicModule.fetch as (url: string) => Promise<Response>
    await call('https://x.com/v1/invoice')
    expect(native).toEqual(['https://x.com/v1/invoice'])
    undo()
  })
})
