import { Badge, Input } from '@rozenite/ui'
import { Sprout } from 'lucide-react'

import type { QuerySnapshot } from '../../shared/types'
import {
  formatKey,
  matches,
  queryTone,
  statusLabel,
  summarize,
  toneBadgeClass,
} from '../format'

/**
 * The cache, one row per query.
 *
 * Rows show a *preview* of each value rather than the value itself — the SDK
 * never sends full cache entries unprompted, so this list stays the same size
 * whether the app is holding a 3-field settings object or a 40k-row feed.
 */
export function QueryList({
  queries,
  selected,
  onSelect,
  query,
  onQueryChange,
}: {
  queries: QuerySnapshot[]
  selected: string | null
  onSelect: (queryHash: string) => void
  query: string
  onQueryChange: (next: string) => void
}) {
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? queries.filter(
        (item) =>
          matches(formatKey(item.queryKey), needle) ||
          matches(summarize(item.preview), needle),
      )
    : queries

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-r border-border">
      <div className="border-b border-border p-2">
        <Input
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter query keys…"
          value={query}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            {queries.length === 0
              ? 'No queries in the cache yet.'
              : 'No queries match this filter.'}
          </p>
        ) : (
          <ul>
            {visible.map((item) => {
              const tone = queryTone(item)
              const isSelected = item.queryHash === selected
              return (
                <li key={item.queryHash}>
                  <button
                    className={`flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/60 ${
                      isSelected ? 'bg-muted' : ''
                    }`}
                    onClick={() => onSelect(item.queryHash)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5">
                      {item.seeded ? (
                        <Sprout
                          aria-label="Seeded"
                          className="size-3.5 shrink-0 text-primary"
                        />
                      ) : null}
                      <span className="truncate font-mono text-xs text-foreground">
                        {formatKey(item.queryKey)}
                      </span>
                    </span>

                    <span className="flex items-center gap-2">
                      <Badge
                        className={toneBadgeClass(tone)}
                        variant="secondary"
                      >
                        {item.seeded ? 'seeded' : statusLabel(item)}
                      </Badge>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {item.error ?? summarize(item.preview)}
                      </span>
                      {/* Zero observers means nothing on screen is using this;
                          worth surfacing, because seeding it will look inert. */}
                      {item.observerCount === 0 ? (
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          inactive
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
