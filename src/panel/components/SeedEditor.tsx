import { useState } from 'react'
import { Button, EmptyState, Input } from '@rozenite/ui'
import { AlertTriangle, MousePointerClick, Save } from 'lucide-react'

import type { SeedMeta, SerializedPayload } from '../../shared/types'
import type { SeedTarget, TargetRef } from '../../shared/target'
import { formatRef } from '../../shared/target'
import { formatBytes } from '../format'

/**
 * What the editor is currently pointed at.
 *
 * A target can come from a live adapter (where an `id` exists) or from a saved
 * fixture (where it does not, because the target may never have been used).
 * Seeding only ever needs the ref, so the missing id costs nothing except the
 * ability to address an existing seed directly — which is why `seeded` is
 * resolved by the parent against the ref instead.
 */
export type EditorTarget = {
  ref: TargetRef
  id: string | null
  /** Empty when unknown, e.g. a fixture for a target no adapter has seen. */
  adapter: string
  source: 'target' | 'fixture'
  /** Fixture name, when the target came from one. */
  fixtureName?: string
  /** Fixture id within the app's require.context, used to read its value. */
  fixtureId?: string
}

/**
 * Raw JSON editing for one target's value.
 *
 * Deliberately a textarea and not a structured form. The point is that *any*
 * JSON can be seeded; a form would have to know the shape, and knowing the
 * shape is the generator's job.
 *
 * Fully controlled — the parent owns the text because two different things fill
 * it (a read arriving over the bridge, and a fixture loaded from disk), and
 * having both reach into local state was how the earlier version grew a
 * synchronisation bug.
 */
export function SeedEditor({
  target,
  applyRef,
  seededBy,
  value,
  status,
  onStatusChange,
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
  /**
   * The ref an Apply writes to. Differs from `target.ref` when a broader route
   * pattern already covers this target — editing then updates that rule instead
   * of adding a second, shadowed one.
   */
  applyRef: TargetRef | null
  /** The covering seed's pattern, when it is not the target itself. */
  seededBy: string | null
  value: string
  /** HTTP status as typed. Owned by the parent, like `value`. */
  status: string
  onStatusChange: (next: string) => void
  onChange: (next: string) => void
  loading: boolean
  truncated: boolean
  seeded: boolean
  onApply: (target: SeedTarget, data: unknown, meta?: SeedMeta) => void
  onClear: () => void
  onSaveFixture: (
    name: string,
    ref: TargetRef,
    data: unknown,
    meta?: SeedMeta,
  ) => void
  canSaveFixture: boolean
  /** False when this target's adapter could not be hooked. */
  intercept: boolean
  /** Rendered above the editor when a schema covers this target. */
  generate?: React.ReactNode
}) {
  const [savingName, setSavingName] = useState<string | null>(null)

  if (!target) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center">
        <EmptyState
          icon={MousePointerClick}
          title="Select a target or a fixture to seed it."
        />
      </main>
    )
  }

  const parsed = parse(value)
  const isRoute = target.ref.kind === 'route'
  const parsedStatus = Number.parseInt(status, 10)
  const statusValid = Number.isFinite(parsedStatus) && parsedStatus >= 100 && parsedStatus <= 599
  const meta: SeedMeta | undefined =
    isRoute && statusValid && parsedStatus !== 200 ? { status: parsedStatus } : undefined
  const seedTarget: SeedTarget = {
    adapter: target.adapter,
    ref: applyRef ?? target.ref,
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <code className="truncate font-mono text-xs text-foreground">
          {formatRef(target.ref)}
        </code>
        {target.fixtureName ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            from {target.fixtureName}
          </span>
        ) : null}
        {/* Names the rule being edited when it is broader than the row clicked,
            so Apply updating something else is visible rather than surprising. */}
        {seededBy ? (
          <span className="shrink-0 font-mono text-[11px] text-primary">
            seeded by {seededBy}
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
          {isRoute
            ? 'Could not patch fetch, so requests cannot be intercepted.'
            : 'Could not hook this QueryClient, so seeds are one-shot writes — the next refetch will overwrite them.'}
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
            onSaveFixture(savingName, target.ref, parsed.value, meta)
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

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/*
            Routes only. Forcing a 500 is most of the reason to seed a request
            rather than a cache entry, and it has no meaning for a cache write.
          */}
          {isRoute ? (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              status
              <Input
                className={`h-7 w-16 font-mono text-[11px] ${
                  statusValid ? '' : 'border-danger text-danger'
                }`}
                inputMode="numeric"
                onChange={(event) => onStatusChange(event.target.value)}
                value={status}
              />
            </label>
          ) : null}
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
            "the read has not arrived", which says nothing about whether the
            editor holds something worth applying — generating a value fills the
            editor while that read is still outstanding, and an empty editor is
            already a parse error.
          */}
          <Button
            disabled={Boolean(parsed.error) || (isRoute && !statusValid)}
            onClick={() => onApply(seedTarget, parsed.value, meta)}
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
