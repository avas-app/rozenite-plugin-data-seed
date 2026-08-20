import { useState } from 'react'
import { Button, Input } from '@rozenite/ui'
import { AlertTriangle, ChevronDown, ChevronRight, Dices, Tags } from 'lucide-react'

import type { GenerateWarning } from '../../shared/generate'
import { TOKENS, sampleToken } from '../../shared/generate'

/**
 * Controls for generating a value from the query's extracted schema.
 *
 * Only appears when a schema actually covers the selected key, so it stays
 * invisible in projects that have not run `data-seed extract` rather than
 * advertising a feature that would do nothing.
 */
export function GenerateBar({
  typeName,
  shape,
  loading,
  itemCount,
  onItemCountChange,
  variant,
  onVariantChange,
  warnings,
  onGenerate,
}: {
  typeName: string
  /** The type rendered back as TypeScript, or null until the schema arrives. */
  shape: string | null
  loading: boolean
  itemCount: number
  onItemCountChange: (next: number) => void
  /** Index into an anyOf/oneOf, or null to let the seed decide. */
  variant: number | null
  onVariantChange: (next: number | null) => void
  warnings: GenerateWarning[]
  onGenerate: () => void
}) {
  const [showShape, setShowShape] = useState(false)
  const [showTokens, setShowTokens] = useState(false)

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        {/*
          The type name doubles as the disclosure for its shape. Answering
          "what fields does this have?" without leaving the panel is most of
          the value here, so it should not cost more than one click — and it
          shows which fields are annotated and which are `any`, neither of
          which is obvious from the source at a glance.
        */}
        <button
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
          disabled={!shape}
          onClick={() => setShowShape((open) => !open)}
          title={shape ? 'Show the type shape' : undefined}
          type="button"
        >
          {shape ? (
            showShape ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )
          ) : null}
          <span className="truncate font-mono text-[11px]">{typeName}</span>
        </button>

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

        {/*
          The token reference belongs here rather than only in the README: the
          moment you want it is while looking at a field the shape shows as
          plain `string`, deciding what to annotate it with.
        */}
        <Button
          aria-label="@fake tokens"
          onClick={() => setShowTokens((open) => !open)}
          size="compact"
          title="@fake tokens"
          variant="outline"
        >
          <Tags className="size-3.5" />
        </Button>

        <Button disabled={loading} onClick={onGenerate} size="compact">
          <Dices className="size-3.5" />
          {loading ? 'Loading…' : 'Generate'}
        </Button>
      </div>

      {showTokens ? <TokenReference /> : null}

      {showShape && shape ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">
          {shape}
        </pre>
      ) : null}

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

/**
 * Every `@fake` token, with a live example.
 *
 * Built from the same catalogue the generator uses, and the examples are
 * produced by running it — so this pane cannot claim an output the generator
 * does not actually produce.
 */
function TokenReference() {
  return (
    <div className="max-h-64 overflow-auto rounded-md bg-muted p-3">
      <p className="mb-2 font-mono text-[11px] text-muted-foreground">
        {'/** @fake person.fullName */'} — arguments are JSON:{' '}
        {'number.int({min: 1, max: 10})'}
      </p>
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {TOKENS.map((entry) => (
            <tr key={entry.token} className="align-top">
              <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-foreground">
                {entry.token}
              </td>
              <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-muted-foreground">
                {entry.args ?? ''}
              </td>
              <td className="w-full truncate py-0.5 font-mono text-muted-foreground">
                {sampleToken(entry.token)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}
