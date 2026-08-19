import { Button, Input } from '@rozenite/ui'
import { AlertTriangle, Dices } from 'lucide-react'

import type { GenerateWarning } from '../../shared/generate'

/**
 * Controls for generating a value from the query's extracted schema.
 *
 * Only appears when a schema actually covers the selected key, so it stays
 * invisible in projects that have not run `query-seed extract` rather than
 * advertising a feature that would do nothing.
 */
export function GenerateBar({
  typeName,
  loading,
  itemCount,
  onItemCountChange,
  variant,
  onVariantChange,
  warnings,
  onGenerate,
}: {
  typeName: string
  loading: boolean
  itemCount: number
  onItemCountChange: (next: number) => void
  /** Index into an anyOf/oneOf, or null to let the seed decide. */
  variant: number | null
  onVariantChange: (next: number | null) => void
  warnings: GenerateWarning[]
  onGenerate: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {typeName}
        </span>

        <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          items
          <Input
            className="w-14"
            max={500}
            min={0}
            onChange={(event) =>
              onItemCountChange(clamp(Number(event.target.value), 0, 500))
            }
            type="number"
            value={itemCount}
          />
        </label>

        <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          variant
          <Input
            /* Wider than `items`: this one has to fit the word "auto". */
            className="w-20"
            min={0}
            onChange={(event) => {
              const raw = event.target.value
              onVariantChange(raw === '' ? null : clamp(Number(raw), 0, 99))
            }}
            placeholder="auto"
            type="number"
            value={variant ?? ''}
          />
        </label>

        <Button disabled={loading} onClick={onGenerate} size="compact">
          <Dices className="size-3.5" />
          {loading ? 'Loading…' : 'Generate'}
        </Button>
      </div>

      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {warnings.slice(0, 4).map((warning) => (
            <li
              className="flex items-start gap-1.5 text-[11px] text-warning"
              key={`${warning.path}:${warning.reason}`}
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0">
                <code className="font-mono">{warning.path}</code> — {warning.reason}
              </span>
            </li>
          ))}
          {warnings.length > 4 ? (
            <li className="text-[11px] text-muted-foreground">
              +{warnings.length - 4} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}
