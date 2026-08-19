import { useState } from 'react'
import { Button, EmptyState, Input } from '@rozenite/ui'
import { AlertTriangle, MousePointerClick, Save } from 'lucide-react'

import type { SerializedPayload } from '../../shared/types'
import { formatBytes, formatKey } from '../format'

/**
 * What the editor is currently pointed at.
 *
 * A target can come from the cache (where a `queryHash` exists) or from a saved
 * fixture (where it does not, because the query may never have been fetched).
 * Seeding only ever needs the key, so the missing hash costs nothing except the
 * ability to address an existing seed by hash — which is why `seeded` is
 * resolved by the parent against the key instead.
 */
export type EditorTarget = {
  queryKey: unknown[]
  queryHash: string | null
  source: 'query' | 'fixture'
  /** Fixture name, when the target came from one. */
  fixtureName?: string
  /** Fixture id within the app's require.context, used to read its value. */
  fixtureId?: string
}

/**
 * Raw JSON editing for one query's cache entry.
 *
 * Deliberately a textarea and not a structured form. The point of this slice is
 * that *any* JSON can reach the cache; a form would have to know the shape, and
 * knowing the shape is the job of the generator that comes later.
 *
 * Fully controlled — the parent owns the text because two different things fill
 * it (a cache read arriving over the bridge, and a fixture loaded from disk),
 * and having both reach into local state was how the earlier version grew a
 * synchronisation bug.
 */
export function SeedEditor({
  target,
  value,
  onChange,
  loading,
  truncated,
  seeded,
  onApply,
  onClear,
  onSaveFixture,
  canSaveFixture,
  intercept,
  generate,
}: {
  target: EditorTarget | null
  value: string
  onChange: (next: string) => void
  loading: boolean
  truncated: boolean
  seeded: boolean
  onApply: (queryKey: unknown[], data: unknown) => void
  onClear: () => void
  onSaveFixture: (name: string, queryKey: unknown[], data: unknown) => void
  canSaveFixture: boolean
  intercept: boolean
  /** Rendered above the editor when a schema covers this key. */
  generate?: React.ReactNode
}) {
  const [savingName, setSavingName] = useState<string | null>(null)

  if (!target) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon={MousePointerClick}
          title="Select a query or a fixture to seed it."
        />
      </main>
    )
  }

  const parsed = parse(value)

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <code className="truncate font-mono text-xs text-foreground">
          {formatKey(target.queryKey)}
        </code>
        {target.fixtureName ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            from {target.fixtureName}
          </span>
        ) : null}
        {truncated ? (
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

      {generate}

      <textarea
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
        onChange={(event) => onChange(event.target.value)}
        placeholder={loading ? 'Loading current value…' : '{ }'}
        spellCheck={false}
        value={value}
      />

      {savingName !== null ? (
        <form
          className="flex items-center gap-2 border-t border-border px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!savingName.trim() || parsed.error) return
            onSaveFixture(savingName, target.queryKey, parsed.value)
            setSavingName(null)
          }}
        >
          <Input
            autoFocus
            onChange={(event) => setSavingName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSavingName(null)
            }}
            placeholder="cart with 50 items"
            value={savingName}
          />
          <Button disabled={!savingName.trim()} size="compact" type="submit">
            Save
          </Button>
          <Button
            onClick={() => setSavingName(null)}
            size="compact"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </form>
      ) : null}

      <footer className="flex items-center gap-2 border-t border-border px-3 py-2">
        {parsed.error ? (
          <span className="truncate text-[11px] text-danger">{parsed.error}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {formatBytes(value.length)}
          </span>
        )}

        <div className="ml-auto flex shrink-0 gap-2">
          {canSaveFixture ? (
            <Button
              disabled={Boolean(parsed.error)}
              onClick={() => setSavingName(target.fixtureName ?? '')}
              size="compact"
              variant="outline"
            >
              <Save className="size-3.5" />
              Save fixture
            </Button>
          ) : null}
          {seeded ? (
            <Button onClick={onClear} size="compact" variant="outline">
              Remove seed
            </Button>
          ) : null}
          {/*
            Gated on the parse only. `loading` must not disable this: it means
            "the cache read has not arrived", which says nothing about whether
            the editor holds something worth applying — generating a value fills
            the editor while that read is still outstanding, and an empty editor
            is already a parse error.
          */}
          <Button
            disabled={Boolean(parsed.error)}
            onClick={() => onApply(target.queryKey, parsed.value)}
            size="compact"
          >
            {seeded ? 'Update seed' : 'Apply seed'}
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
export function toEditableText(payload: SerializedPayload): string {
  if (payload.kind === 'undefined' || payload.kind === 'unserializable') return '{}'
  try {
    return JSON.stringify(payload.value ?? null, null, 2)
  } catch {
    return '{}'
  }
}
