import { Button } from '@rozenite/ui'
import { AlertTriangle, FolderOpen, Sprout } from 'lucide-react'

import type { BundledFixture, FixtureProblem } from '../../shared/types'
import type { FixturesActions, FixturesState } from '../fixtures/use-fixtures'
import { formatBytes, formatKey } from '../format'

/**
 * Fixtures committed to the consuming repo.
 *
 * Reads come from the app bundle, not from the browser: Metro bundles whatever
 * the app's `require.context` covers, so a teammate who clones the project sees
 * this list immediately with nothing to configure. The folder picker at the
 * bottom exists only for *writing* new fixtures, which is why it is a footer
 * rather than a gate in front of the list.
 */
export function FixtureList({
  fixtures,
  problems,
  capable,
  selectedId,
  onOpen,
  writeState,
  writeActions,
  projectRoot,
}: {
  fixtures: BundledFixture[]
  problems: FixtureProblem[]
  /** The app supplied a fixtures directory. */
  capable: boolean
  selectedId: string | null
  onOpen: (fixture: BundledFixture) => void
  writeState: FixturesState
  writeActions: FixturesActions
  /** Absolute project path, shown so it can be pasted into the picker. */
  projectRoot: string | null
}) {
  if (!capable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Point the hook at a fixtures folder and everyone who clones the repo
          gets the same list — no setup on their side.
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] text-foreground">
          {`useQuerySeeder(queryClient, {
  fixtures: require.context(
    './seeds', false, /\\.json$/
  ),
})`}
        </pre>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {fixtures.length === 0 && problems.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            No fixtures yet. Seed a query, then save it from the editor.
          </p>
        ) : (
          <ul>
            {fixtures.map((fixture) => (
              <li key={fixture.id}>
                <button
                  className={`flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/60 ${
                    selectedId === fixture.id ? 'bg-muted' : ''
                  }`}
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
              </li>
            ))}

            {problems.map((problem) => (
              <li
                className="flex items-start gap-1.5 border-b border-border/60 px-3 py-2"
                key={problem.id}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px] text-foreground">
                    {problem.id}
                  </span>
                  <span className="block text-[11px] text-danger">
                    {problem.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WriteFooter
        actions={writeActions}
        projectRoot={projectRoot}
        state={writeState}
      />
    </div>
  )
}

/**
 * Where new fixtures get written.
 *
 * Saving is the one operation that cannot go through the bundle, so it needs a
 * folder the user has granted access to. A file written here shows up in the
 * list above only after Metro re-bundles the directory.
 */
function WriteFooter({
  state,
  actions,
  projectRoot,
}: {
  state: FixturesState
  actions: FixturesActions
  projectRoot: string | null
}) {
  if (!state.supported) {
    return (
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Saving needs Chrome's folder access. Reading works everywhere.
      </p>
    )
  }

  if (state.needsReconnect) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          Access to {state.label} lapsed
        </span>
        <Button onClick={() => void actions.reconnect()} size="compact" variant="outline">
          Reconnect
        </Button>
      </div>
    )
  }

  if (!state.ready) {
    return (
      <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
            Choose a folder to save new fixtures
          </span>
          <Button onClick={() => void actions.connect()} size="compact" variant="outline">
            <FolderOpen className="size-3.5" />
            Choose
          </Button>
        </div>
        {/* The picker cannot be pre-navigated, so the path is shown instead —
            ⇧⌘G in the macOS file dialog takes a pasted path directly. */}
        {projectRoot ? (
          <code className="block select-all truncate font-mono text-[11px] text-muted-foreground">
            {projectRoot} <span className="opacity-60">— paste with ⇧⌘G</span>
          </code>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2">
      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        Saving to {state.label}
      </span>
      <button
        className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => void actions.forget()}
        type="button"
      >
        change
      </button>
      {state.error ? (
        <span className="w-full text-[11px] text-danger">{state.error}</span>
      ) : null}
    </div>
  )
}
