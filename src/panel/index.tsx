import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  PluginHeader,
  PluginShell,
  Tooltip,
} from '@rozenite/ui'
import { Loader2, PlugZap } from 'lucide-react'

import { QueryList } from './components/QueryList'
import { SeedEditor } from './components/SeedEditor'
import { useQuerySeedPanel } from './store'
import './globals.css'

const SUBTITLE = 'Push fake data into the TanStack Query cache and make it stick.'

export default function QuerySeedPanel() {
  const { state, actions, bridgeReady } = useQuerySeedPanel()

  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const selectedQuery = useMemo(
    () => state.queries.find((q) => q.queryHash === selected) ?? null,
    [state.queries, selected],
  )

  const select = useCallback(
    (queryHash: string) => {
      setSelected(queryHash)
      // Row previews are clipped, so the editor has to ask for the real value.
      actions.readData(queryHash)
    },
    [actions],
  )

  if (!bridgeReady) {
    return (
      <Shell>
        <Header />
        <EmptyState icon={Spinner} title="Connecting to React Native…" />
      </Shell>
    )
  }

  if (!state.hydrated) {
    return (
      <Shell>
        <Header />
        <EmptyState
          description={
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-foreground">
              {`import { useQuerySeeder } from '@avasapp/rozenite-plugin-query-seed'

useQuerySeeder(queryClient)`}
            </pre>
          }
          icon={PlugZap}
          title="Waiting for an instrumented QueryClient."
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header>
        {state.seeds.length > 0 ? (
          <>
            <span className="text-xs text-muted-foreground">
              {state.seeds.length} active
            </span>
            <Button onClick={actions.clearAll} size="compact" variant="outline">
              Remove all seeds
            </Button>
          </>
        ) : null}
      </Header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <QueryList
          onQueryChange={setFilter}
          onSelect={select}
          queries={state.queries}
          query={filter}
          selected={selected}
        />
        <SeedEditor
          editorData={state.editorData}
          intercept={state.capabilities.intercept}
          onApply={actions.apply}
          onClear={actions.clear}
          query={selectedQuery}
        />
      </div>
    </Shell>
  )
}

/**
 * `PluginShell` owns the theme class and the portal container that Select,
 * Tooltip and friends mount into — without it those surfaces escape to
 * `document.body` and render with light tokens. `Tooltip.Provider` sits inside
 * it so the panel's tooltips share one open/close delay.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PluginShell>
      <Tooltip.Provider>{children}</Tooltip.Provider>
    </PluginShell>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <PluginHeader>
      <div className="flex min-w-0 flex-col">
        <PluginHeader.Title>Query Seed</PluginHeader.Title>
        <PluginHeader.Subtitle>{SUBTITLE}</PluginHeader.Subtitle>
      </div>
      <PluginHeader.Actions>
        {children}
        <PluginHeader.ThemeSwitcher />
      </PluginHeader.Actions>
    </PluginHeader>
  )
}

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={`${className ?? ''} animate-spin text-primary`} />
}
