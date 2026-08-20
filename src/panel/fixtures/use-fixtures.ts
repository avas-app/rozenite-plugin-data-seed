import { useCallback, useEffect, useMemo, useState } from 'react'

import { createFixture } from '../../shared/fixture'
import type { TargetRef } from '../../shared/target'
import type { SeedMeta } from '../../shared/types'
import {
  createDirectoryStore,
  ensureAccess,
  forgetSavedDirectory,
  isFileSystemAccessSupported,
  loadSavedDirectory,
  pickFixtureDirectory,
} from './directory-store'

type Handle = Awaited<ReturnType<typeof pickFixtureDirectory>>

/**
 * Write access to the fixtures folder.
 *
 * Reading is deliberately not here — bundled fixtures arrive over the Rozenite
 * bridge from the app, which needs no permission and works for anyone who
 * clones the repo. This hook covers only the one thing the bundle cannot do,
 * which is create a new file.
 */
export type FixturesState = {
  supported: boolean
  /** A folder was chosen before but access lapsed and needs a click. */
  needsReconnect: boolean
  ready: boolean
  label: string | null
  error: string | null
  busy: boolean
}

export type FixturesActions = {
  connect: () => Promise<boolean>
  reconnect: () => Promise<void>
  forget: () => Promise<void>
  save: (
    name: string,
    target: TargetRef,
    data: unknown,
    meta?: SeedMeta,
  ) => Promise<void>
}

export function useFixtures(): {
  state: FixturesState
  actions: FixturesActions
} {
  const supported = isFileSystemAccessSupported()

  const [handle, setHandle] = useState<Handle | null>(null)
  const [granted, setGranted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const store = useMemo(
    () => createDirectoryStore(handle, granted),
    [handle, granted],
  )

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

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    try {
      const result = await work()
      setError(null)
      return result
    } catch (cause) {
      // An abort is the user closing the folder picker, which is a decision,
      // not a failure — surfacing it as an error would be noise.
      if (!isAbort(cause)) setError(describe(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const actions = useMemo<FixturesActions>(
    () => ({
      connect: async () => {
        // Re-picking starts where the current folder is, so "change" lands next
        // to the old choice rather than back at square one.
        const picked = await run(() => pickFixtureDirectory(handle ?? undefined))
        if (!picked) return false
        setHandle(picked)
        setGranted(true)
        return true
      },

      reconnect: async () => {
        if (!handle) return
        const ok = await run(() => ensureAccess(handle, true))
        setGranted(Boolean(ok))
      },

      forget: async () => {
        await run(() => forgetSavedDirectory())
        setHandle(null)
        setGranted(false)
      },

      save: async (name, target, data, meta) => {
        await run(() =>
          store.write(
            createFixture(name, target, data, new Date().toISOString(), meta),
          ),
        )
      },
    }),
    [handle, run, store],
  )

  return {
    state: {
      supported,
      needsReconnect: Boolean(handle) && !granted,
      ready: store.ready,
      label: store.label,
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
