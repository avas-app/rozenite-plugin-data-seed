import { useEffect, useMemo, useState } from 'react'
import { Button, EmptyState } from '@rozenite/ui'
import { AlertTriangle, MousePointerClick } from 'lucide-react'

import type { QuerySnapshot, SerializedPayload } from '../../shared/types'
import { formatBytes, formatKey } from '../format'

/**
 * Raw JSON editing for one query's cache entry.
 *
 * This is deliberately a textarea and not a structured form. The point of the
 * transport slice is that *any* JSON can reach the cache; a form would have to
 * know the shape, and knowing the shape is the job of the generator that comes
 * later.
 */
export function SeedEditor({
  query,
  editorData,
  onApply,
  onClear,
  intercept,
}: {
  query: QuerySnapshot | null
  editorData: { queryHash: string; data: SerializedPayload } | null
  onApply: (queryKey: unknown[], data: unknown) => void
  onClear: (queryHash: string) => void
  intercept: boolean
}) {
  const [text, setText] = useState('')
  // Tracks which query the current text belongs to, so arriving data for a
  // *different* query cannot overwrite edits in progress on this one.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const incoming = editorData && query && editorData.queryHash === query.queryHash
    ? editorData
    : null

  useEffect(() => {
    if (!incoming) return
    if (loadedFor === incoming.queryHash) return
    setText(toEditableText(incoming.data))
    setLoadedFor(incoming.queryHash)
  }, [incoming, loadedFor])

  useEffect(() => {
    // Selecting a different query resets the editor; the effect above then
    // refills it once that query's data arrives.
    if (query && loadedFor && query.queryHash !== loadedFor) {
      setText('')
      setLoadedFor(null)
    }
  }, [query, loadedFor])

  const parsed = useMemo(() => parse(text), [text])

  if (!query) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon={MousePointerClick}
          title="Select a query to seed it."
        />
      </main>
    )
  }

  const waiting = loadedFor !== query.queryHash

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <code className="truncate font-mono text-xs text-foreground">
          {formatKey(query.queryKey)}
        </code>
        {incoming?.data.truncated ? (
          <span className="ml-auto shrink-0 text-[11px] text-warning">
            clipped for transport — applying will replace the full value
          </span>
        ) : null}
      </header>

      {!intercept ? (
        <p className="flex items-center gap-2 border-b border-border bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          Could not hook this QueryClient, so seeds are one-shot writes — the
          next refetch will overwrite them.
        </p>
      ) : null}

      <textarea
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
        onChange={(event) => setText(event.target.value)}
        placeholder={waiting ? 'Loading current value…' : '{ }'}
        spellCheck={false}
        value={text}
      />

      <footer className="flex items-center gap-2 border-t border-border px-3 py-2">
        {parsed.error ? (
          <span className="truncate text-[11px] text-danger">{parsed.error}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {formatBytes(text.length)}
          </span>
        )}

        <div className="ml-auto flex shrink-0 gap-2">
          {query.seeded ? (
            <Button
              onClick={() => onClear(query.queryHash)}
              size="compact"
              variant="outline"
            >
              Remove seed
            </Button>
          ) : null}
          <Button
            disabled={Boolean(parsed.error) || waiting}
            onClick={() => onApply(query.queryKey, parsed.value)}
            size="compact"
          >
            {query.seeded ? 'Update seed' : 'Apply seed'}
          </Button>
        </div>
      </footer>
    </main>
  )
}

function parse(text: string): { value: unknown; error: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { value: undefined, error: 'Enter a JSON value.' }
  try {
    return { value: JSON.parse(trimmed), error: null }
  } catch (error) {
    return {
      value: undefined,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    }
  }
}

/**
 * Renders a serialized payload back into editable text.
 *
 * Anything the SDK could not serialize becomes an empty object rather than a
 * marker string — you are about to replace it anyway, and a placeholder that
 * does not parse would just block the Apply button.
 */
function toEditableText(payload: SerializedPayload): string {
  if (payload.kind === 'undefined' || payload.kind === 'unserializable') return '{}'
  try {
    return JSON.stringify(payload.value ?? null, null, 2)
  } catch {
    return '{}'
  }
}
