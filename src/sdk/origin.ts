import type { SourceFrame } from '../shared/types'

/**
 * Captures a few stack frames so the panel can work out where the project lives
 * on disk.
 *
 * This exists for one small piece of UX: the folder picker cannot be pointed at
 * a path. Browsers refuse it deliberately — `showDirectoryPicker` accepts only
 * well-known folders or a handle you already hold — so the closest achievable
 * thing is telling the user the path, which they can paste into the dialog.
 *
 * Nothing on the device knows its own filesystem path. But Metro's
 * `/symbolicate` endpoint maps bundle offsets back to real source files, and a
 * stack captured here contains exactly those offsets. So the device supplies
 * the coordinates and the panel does the lookup.
 *
 * Entirely best-effort. Every failure mode — Hermes changing its stack format,
 * no source map, a release bundle — ends in `null` and the panel simply does
 * not show a hint.
 */

/** Frames from the app's own code sit above the plugin's; a handful is plenty. */
const MAX_FRAMES = 8

/**
 * Matches `at fn (http://host:8081/index.bundle?platform=ios&dev=true:1234:56)`
 * and the parenthesis-less form Hermes uses for anonymous frames.
 */
const FRAME_PATTERN = /(https?:\/\/[^\s()]+?):(\d+):(\d+)/

export function captureFrames(): SourceFrame[] {
  const stack = new Error().stack
  if (typeof stack !== 'string') return []

  const frames: SourceFrame[] = []
  for (const line of stack.split('\n')) {
    const match = FRAME_PATTERN.exec(line)
    if (!match) continue

    const [, file, lineNumber, column] = match
    // Only bundle frames can be symbolicated; anything else is a native or
    // internal frame that Metro knows nothing about.
    if (!file.includes('.bundle')) continue

    frames.push({
      file,
      lineNumber: Number(lineNumber),
      column: Number(column),
    })
    if (frames.length >= MAX_FRAMES) break
  }
  return frames
}
