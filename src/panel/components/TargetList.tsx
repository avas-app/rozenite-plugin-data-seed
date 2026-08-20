import { useState } from 'react'
import { Badge, Button, Input } from '@rozenite/ui'
import { Plus, Sprout } from 'lucide-react'

import type { AdapterInfo, TargetSnapshot } from '../../shared/types'
import { ADAPTER_HTTP } from '../../shared/target'
import type { TargetRef } from '../../shared/target'
import {
  matches,
  statusLabel,
  summarize,
  targetTone,
  toneBadgeClass,
} from '../format'

/**
 * Everything that can be seeded, one row per target.
 *
 * Rows show a *preview* of each value rather than the value itself — the SDK
 * never sends full values unprompted, so this list stays the same size whether
 * the app is holding a 3-field settings object or a 40k-row feed.
 *
 * Grouped by adapter once there is more than one, because the two kinds behave
 * differently enough that mixing them silently would mislead: query rows are
 * the whole cache, while HTTP rows are only what has been *observed* so far.
 */
export function TargetList({
  targets,
  adapters,
  selected,
  onSelect,
  onAddRoute,
  query,
  onQueryChange,
}: {
  targets: TargetSnapshot[]
  adapters: AdapterInfo[]
  selected: string | null
  onSelect: (id: string) => void
  onAddRoute: (ref: TargetRef) => void
  query: string
  onQueryChange: (next: string) => void
}) {
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? targets.filter(
        (item) =>
          matches(item.label, needle) || matches(summarize(item.preview), needle),
      )
    : targets

  const grouped = adapters
    .map((adapter) => ({
      adapter,
      rows: visible.filter((item) => item.adapter === adapter.id),
    }))
    .filter((group) => group.rows.length > 0 || !group.adapter.enumerable)

  const showHeadings = adapters.length > 1
  const httpInstalled = adapters.some((adapter) => adapter.id === ADAPTER_HTTP)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-2">
        <Input
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter targets…"
          value={query}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {targets.length === 0 && !httpInstalled ? (
          <p className="p-4 text-xs text-muted-foreground">
            Nothing to seed yet.
          </p>
        ) : null}

        {grouped.map(({ adapter, rows }) => (
          <section key={adapter.id}>
            {showHeadings ? (
              <h2 className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur">
                <span className="text-[11px] font-medium text-foreground">
                  {adapter.label}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {rows.length}
                </span>
                {/* An adapter that cannot enumerate shows only what has been
                    used, which otherwise reads as "the list is broken". */}
                {!adapter.enumerable ? (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    observed
                  </span>
                ) : null}
              </h2>
            ) : null}

            {adapter.id === ADAPTER_HTTP ? (
              <AddRoute onAdd={onAddRoute} />
            ) : null}

            {rows.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {adapter.enumerable
                  ? 'Nothing here yet.'
                  : 'No requests seen yet. Seed a route above to intercept one before it happens.'}
              </p>
            ) : (
              <ul>
                {rows.map((item) => (
                  <Row
                    isSelected={item.id === selected}
                    item={item}
                    key={item.id}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}

        {visible.length === 0 && targets.length > 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            No targets match this filter.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Row({
  item,
  isSelected,
  onSelect,
}: {
  item: TargetSnapshot
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const tone = targetTone(item)
  return (
    <li>
      <button
        className={`flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/60 ${
          isSelected ? 'bg-muted' : ''
        }`}
        onClick={() => onSelect(item.id)}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          {item.seeded ? (
            <Sprout aria-label="Seeded" className="size-3.5 shrink-0 text-primary" />
          ) : null}
          <span className="truncate font-mono text-xs text-foreground">
            {item.label}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <Badge className={toneBadgeClass(tone)} variant="secondary">
            {item.seeded ? 'seeded' : statusLabel(item)}
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground">
            {item.error ?? summarize(item.preview)}
          </span>
          {/* Zero observers means nothing on screen is using this; worth
              surfacing, because seeding it will look inert. */}
          {item.observerCount === 0 ? (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              inactive
            </span>
          ) : null}
          {item.hits && item.hits > 1 ? (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              ×{item.hits}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

/**
 * Seeding a route that has not been requested yet.
 *
 * The HTTP adapter cannot enumerate anything, so without this the only way to
 * seed a route would be to trigger it first — which is impossible for exactly
 * the case you most want to fake, like an endpoint that only fires on an error
 * path you cannot reach.
 */
function AddRoute({ onAdd }: { onAdd: (ref: TargetRef) => void }) {
  const [value, setValue] = useState('')

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const match = /^([A-Za-z]+|\*)\s+(.*)$/.exec(text)
    const method = match ? match[1].toUpperCase() : 'GET'
    const url = match ? match[2].trim() : text
    onAdd({ kind: 'route', method, url })
    setValue('')
  }

  return (
    <form
      className="flex gap-1 border-b border-border/60 px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Input
        className="h-7 font-mono text-[11px]"
        onChange={(event) => setValue(event.target.value)}
        placeholder="GET /api/todos"
        value={value}
      />
      <Button
        aria-label="Add route"
        disabled={!value.trim()}
        size="compact"
        type="submit"
        variant="outline"
      >
        <Plus className="size-3.5" />
      </Button>
    </form>
  )
}
