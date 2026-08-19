import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Fixture, FixtureSummary } from '../../shared/fixture'
import { createFixture } from '../../shared/fixture'
import {
  createDirectoryStore,
  ensureAccess,
  forgetSavedDirectory,
  isFileSystemAccessSupported,
  loadSavedDirectory,
  pickFixtureDirectory,
} from './directory-store'

type Handle = Awaited<ReturnType<typeof pickFixtureDirectory>>

export type FixturesState = {
  supported: boolean
  /** A folder was chosen previously but access has lapsed and needs a click. */
  needsReconnect: boolean
  ready: boolean
  label: string | null
  fixtures: FixtureSummary[]
  error: string | null
  busy: boolean
}

export type FixturesActions = {
  connect: () => Promise<void>
  reconnect: () => Promise<void>
  forget: () => Promise<void>
  refresh: () => Promise<void>
  save: (name: string, queryKey: unknown[], data: unknown) => Promise<void>
  load: (fileName: string) => Promise<Fixture | null>
  remove: (fileName: string) => Promise<void>
}

export function useFixtures(): {
  state: FixturesState
  actions: FixturesActions
} {
  const supported = isFileSystemAccessSupported()

  const [handle, setHandle] = useState<Handle | null>(null)
  const [granted, setGranted] = useState(false)
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const store = useMemo(
    () => createDirectoryStore(handle, granted),
    [handle, granted],
  )

  const refresh = useCallback(async () => {
    if (!store.ready) return
    try {
      setFixtures(await store.list())
      setError(null)
    } catch (cause) {
      setError(describe(cause))
    }
  }, [store])

  // Re-attach to a previously chosen folder. Silent by design: a permission
  // prompt on panel open, before the user has asked for anything, reads as the
  // devtools being broken.
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    void (async () => {
      const saved = await loadSavedDirectory().catch(() => undefined)
      if (cancelled || !saved) return
      setHandle(saved)
      setGranted(await ensureAccess(saved, false).catch(() => false))
    })()
    return () => {
      cancelled = true
    }
  }, [supported])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
      setError(null)
    } catch (cause) {
      // An abort is the user closing the folder picker, which is a decision,
      // not a failure — surfacing it as an error would be noise.
      if (!isAbort(cause)) setError(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const actions = useMemo<FixturesActions>(
    () => ({
      connect: () =>
        run(async () => {
          const picked = await pickFixtureDirectory()
          setHandle(picked)
          setGranted(true)
        }),

      reconnect: () =>
        run(async () => {
          if (!handle) return
          setGranted(await ensureAccess(handle, true))
        }),

      forget: () =>
        run(async () => {
          await forgetSavedDirectory()
          setHandle(null)
          setGranted(false)
          setFixtures([])
        }),

      refresh,

      save: (name, queryKey, data) =>
        run(async () => {
          await store.write(
            createFixture(name, queryKey, data, new Date().toISOString()),
          )
          setFixtures(await store.list())
        }),

      load: async (fileName) => {
        try {
          return await store.read(fileName)
        } catch (cause) {
          setError(describe(cause))
          return null
        }
      },

      remove: (fileName) =>
        run(async () => {
          await store.remove(fileName)
          setFixtures(await store.list())
        }),
    }),
    [handle, refresh, run, store],
  )

  return {
    state: {
      supported,
      needsReconnect: Boolean(handle) && !granted,
      ready: store.ready,
      label: store.label,
      fixtures,
      error,
      busy,
    },
    actions,
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}
