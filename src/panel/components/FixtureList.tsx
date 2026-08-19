import { Button } from '@rozenite/ui'
import { FolderOpen, Sprout, Trash2 } from 'lucide-react'

import type { FixtureSummary } from '../../shared/fixture'
import type { FixturesActions, FixturesState } from '../fixtures/use-fixtures'
import { formatBytes, formatKey } from '../format'

/**
 * Saved fixtures, read straight from a folder in the user's repo.
 *
 * The folder is chosen once through the File System Access API. Everything
 * about that is gesture-gated by the browser, so this component is careful to
 * put a real button in front of every state that needs one rather than trying
 * to recover silently.
 */
export function FixtureList({
  state,
  actions,
  onOpen,
  activeQueryKey,
}: {
  state: FixturesState
  actions: FixturesActions
  onOpen: (fixture: FixtureSummary) => void
  activeQueryKey: string | null
}) {
  if (!state.supported) {
    return (
      <Empty>
        This browser cannot open a folder. React Native DevTools runs on Chrome,
        where fixtures work.
      </Empty>
    )
  }

  if (state.needsReconnect) {
    return (
      <Empty
        action={
          <Button onClick={() => void actions.reconnect()} size="compact">
            Reconnect folder
          </Button>
        }
      >
        Access to <strong>{state.label}</strong> lapsed when the browser
        restarted. Chrome requires a click to restore it.
      </Empty>
    )
  }

  if (!state.ready) {
    return (
      <Empty
        action={
          <Button onClick={() => void actions.connect()} size="compact">
            <FolderOpen className="size-3.5" />
            Choose folder
          </Button>
        }
      >
        Pick a folder to keep fixtures in — <code>seeds/</code> in your repo is a
        good default. They are plain JSON, so commit them and the whole team gets
        them.
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[11px] text-muted-foreground">
          {state.label}
        </span>
        <button
          className="ml-auto shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => void actions.forget()}
          type="button"
        >
          change
        </button>
      </div>

      {state.error ? (
        <p className="border-b border-border bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.fixtures.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            No fixtures yet. Seed a query, then save it from the editor.
          </p>
        ) : (
          <ul>
            {state.fixtures.map((fixture) => (
              <li key={fixture.fileName}>
                <div
                  className={`group flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 transition-colors hover:bg-muted/60 ${
                    activeQueryKey === formatKey(fixture.queryKey)
                      ? 'bg-muted'
                      : ''
                  }`}
                >
                  <button
                    className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                    onClick={() => onOpen(fixture)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sprout className="size-3.5 shrink-0 text-primary" />
                      <span className="truncate text-xs text-foreground">
                        {fixture.name}
                      </span>
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {formatKey(fixture.queryKey)} · {formatBytes(fixture.byteLength)}
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${fixture.name}`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                    onClick={() => void actions.remove(fixture.fileName)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Empty({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-start gap-3 p-4">
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}
