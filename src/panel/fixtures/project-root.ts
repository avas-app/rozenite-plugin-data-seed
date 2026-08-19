import { useEffect, useState } from 'react'

import type { SourceFrame } from '../../shared/types'

/**
 * Works out where the consuming project lives on disk.
 *
 * The folder picker cannot be pre-navigated — browsers only accept well-known
 * folders or a handle already held — so the next best thing is showing the path,
 * which pastes straight into the file dialog (⇧⌘G on macOS).
 *
 * Metro's `/symbolicate` maps bundle offsets to real source files. The panel is
 * served by Metro, so this is a same-origin request with no configuration.
 *
 * Best-effort throughout: any failure returns null and the caller shows nothing
 * rather than a wrong path, which would be worse than no hint at all.
 */

type SymbolicateResponse = {
  stack?: Array<{ file?: string | null }>
}

export async function resolveProjectRoot(
  frames: SourceFrame[],
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  // One request per frame, stopping at the first that resolves.
  //
  // Not a single batched call, even though `/symbolicate` accepts a whole
  // stack: under Expo's lazy bundling a stack spans several sub-bundles, and
  // Metro answers 500 for the *entire* batch if any one frame belongs to a
  // bundle it cannot map. Asking one at a time turns that all-or-nothing
  // failure into a skip, which matters because the frame that maps is usually
  // the app's own — the one worth having.
  for (const frame of frames) {
    const file = await symbolicateOne(frame, fetchImpl)
    if (!file || !isAbsolutePath(file)) continue
    // Frames inside node_modules are this plugin or React itself. The first
    // frame outside it belongs to the app, and its directory is the project.
    if (file.includes('/node_modules/') || file.includes('\\node_modules\\')) continue
    return dirName(file)
  }
  return null
}

async function symbolicateOne(
  frame: SourceFrame,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const result = await fetchImpl('/symbolicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stack: [frame] }),
    })
    if (!result.ok) return null
    const body = (await result.json()) as SymbolicateResponse
    return body.stack?.[0]?.file ?? null
  } catch {
    return null
  }
}

/** A symbolicated frame that failed to map comes back as the bundle URL. */
function isAbsolutePath(file: string): boolean {
  if (file.startsWith('http://') || file.startsWith('https://')) return false
  return file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)
}

function dirName(file: string): string {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return cut > 0 ? file.slice(0, cut) : file
}

/**
 * Resolves the project root once per set of frames.
 *
 * Deliberately not cached across reloads: the answer is cheap, and a stale path
 * pointing at a project the user has since moved would be actively misleading.
 */
export function useProjectRoot(frames: SourceFrame[]): string | null {
  const [root, setRoot] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void resolveProjectRoot(frames).then((value) => {
      if (!cancelled) setRoot(value)
    })
    return () => {
      cancelled = true
    }
  }, [frames])

  return root
}
