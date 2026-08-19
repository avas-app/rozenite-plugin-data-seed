import type { Fixture, FixtureSummary } from '../../shared/fixture'
import { serializeFixture, toFileName } from '../../shared/fixture'
import { idbDelete, idbGet, idbSet } from './idb'
import {
  FixturePermissionError,
  FixtureStoreUnavailableError,
  type FixtureStore,
} from './store'

/**
 * A fixture store backed by a real directory in the user's repo, reached
 * through the File System Access API.
 *
 * The types below are structural rather than imported from `lib.dom`: the
 * permission methods on a handle are not in TypeScript's DOM library, and
 * declaring them globally would conflict on the parts that are. Describing only
 * what this file calls avoids both problems.
 */

type Permission = 'granted' | 'denied' | 'prompt'

type FileHandleLike = {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>
    close: () => Promise<void>
  }>
}

type DirectoryHandleLike = {
  kind: 'directory'
  name: string
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<Permission>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<Permission>
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileHandleLike>
}

const HANDLE_KEY = 'fixtures-directory'

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Chrome keys its remembered picker location on this. */
const PICKER_ID = 'rozenite-query-seed-fixtures'

/**
 * Prompts for a directory. Must be called from a user gesture — the picker is
 * gesture-gated, and so is the permission prompt it implies.
 *
 * The picker cannot be pointed at a path: `startIn` accepts a well-known folder
 * or a handle, never a string, because letting a page pre-navigate the dialog
 * would leak the user's filesystem layout. What *can* be done is give the picker
 * a stable `id`, which Chrome uses to reopen wherever it was last used — so only
 * the very first pick on a machine starts somewhere unhelpful.
 */
export async function pickFixtureDirectory(
  startIn?: DirectoryHandleLike,
): Promise<DirectoryHandleLike> {
  if (!isFileSystemAccessSupported()) {
    throw new FixtureStoreUnavailableError(
      'This browser cannot open a folder. React Native DevTools runs on Chrome, where it works.',
    )
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker: (o?: {
        mode?: 'read' | 'readwrite'
        id?: string
        startIn?: DirectoryHandleLike
      }) => Promise<DirectoryHandleLike>
    }
  ).showDirectoryPicker
  const handle = await picker({ mode: 'readwrite', id: PICKER_ID, startIn })
  await idbSet(HANDLE_KEY, handle)
  return handle
}

/** Returns the remembered directory, or null if none was ever chosen. */
export function loadSavedDirectory(): Promise<DirectoryHandleLike | undefined> {
  return idbGet<DirectoryHandleLike>(HANDLE_KEY)
}

export function forgetSavedDirectory(): Promise<unknown> {
  return idbDelete(HANDLE_KEY)
}

/**
 * Re-checks access to a remembered handle.
 *
 * A persisted handle survives a reload, but its permission does not survive a
 * browser restart — Chrome downgrades it back to `prompt`. `requestPermission`
 * then needs a user gesture, which is why `interactive` is opt-in: the silent
 * path runs on mount, and the prompting path only from a click.
 */
export async function ensureAccess(
  handle: DirectoryHandleLike,
  interactive: boolean,
): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const
  const current = (await handle.queryPermission?.(descriptor)) ?? 'granted'
  if (current === 'granted') return true
  if (!interactive) return false
  const requested = (await handle.requestPermission?.(descriptor)) ?? 'denied'
  return requested === 'granted'
}

export function createDirectoryStore(
  handle: DirectoryHandleLike | null,
  ready: boolean,
): FixtureStore {
  const requireHandle = (): DirectoryHandleLike => {
    if (!handle || !ready) throw new FixturePermissionError()
    return handle
  }

  return {
    ready: Boolean(handle) && ready,
    label: handle?.name ?? null,

    async write(fixture: Fixture) {
      const dir = requireHandle()
      const fileName = toFileName(fixture.name)
      const text = serializeFixture(fixture)
      const entry = await dir.getFileHandle(fileName, { create: true })
      const writable = await entry.createWritable()
      await writable.write(text)
      await writable.close()
      return {
        name: fixture.name,
        fileName,
        queryKey: fixture.queryKey,
        savedAt: fixture.savedAt,
        byteLength: text.length,
      }
    },

  }
}
