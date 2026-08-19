import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  PluginHeader,
  PluginShell,
  Tooltip,
} from '@rozenite/ui'
import { Loader2, PlugZap } from 'lucide-react'

import type { FixtureSummary } from '../shared/fixture'
import { sameQueryKey } from '../shared/fixture'
import { FixtureList } from './components/FixtureList'
import { QueryList } from './components/QueryList'
import {
  SeedEditor,
  toEditableText,
  type EditorTarget,
} from './components/SeedEditor'
import { useFixtures } from './fixtures/use-fixtures'
import { useQuerySeedPanel } from './store'
import './globals.css'

const SUBTITLE = 'Push fake data into the TanStack Query cache and make it stick.'

type Tab = 'queries' | 'fixtures'

export default function QuerySeedPanel() {
  const { state, actions, bridgeReady } = useQuerySeedPanel()
  const fixtures = useFixtures()

  const [tab, setTab] = useState<Tab>('queries')
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState<EditorTarget | null>(null)
  // The editor is controlled from here because two independent sources fill it:
  // a cache read arriving over the bridge, and a fixture read from disk.
  const [text, setText] = useState('')
  const [filledFor, setFilledFor] = useState<string | null>(null)

  const incoming =
    target?.queryHash && state.editorData?.queryHash === target.queryHash
      ? state.editorData
      : null

  useEffect(() => {
    if (!incoming || filledFor === incoming.queryHash) return
    setText(toEditableText(incoming.data))
    setFilledFor(incoming.queryHash)
  }, [incoming, filledFor])

  const selectQuery = useCallback(
    (queryHash: string) => {
      const query = state.queries.find((q) => q.queryHash === queryHash)
      if (!query) return
      setTarget({ queryKey: query.queryKey, queryHash, source: 'query' })
      setText('')
      setFilledFor(null)
      // Row previews are clipped, so the editor has to ask for the real value.
      actions.readData(queryHash)
    },
    [actions, state.queries],
  )

  const openFixture = useCallback(
    async (summary: FixtureSummary) => {
      const fixture = await fixtures.actions.load(summary.fileName)
      if (!fixture) return
      setTarget({
        queryKey: fixture.queryKey,
        queryHash: null,
        source: 'fixture',
        fixtureName: fixture.name,
      })
      setText(JSON.stringify(fixture.data, null, 2))
      setFilledFor(summary.fileName)
    },
    [fixtures.actions],
  )

  // Resolved by key rather than hash: a fixture can target a query that has
  // never been fetched, so it has no hash to match on.
  const activeSeed = useMemo(
    () =>
      target
        ? (state.seeds.find((seed) => sameQueryKey(seed.queryKey, target.queryKey)) ??
          null)
        : null,
    [state.seeds, target],
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

  const loading = target?.source === 'query' && filledFor !== target.queryHash

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
        <aside className="flex w-[22rem] shrink-0 flex-col border-r border-border">
          <div className="flex shrink-0 gap-1 border-b border-border p-1">
            <TabButton
              active={tab === 'queries'}
              count={state.queries.length}
              label="Queries"
              onClick={() => setTab('queries')}
            />
            <TabButton
              active={tab === 'fixtures'}
              count={fixtures.state.ready ? fixtures.state.fixtures.length : null}
              label="Fixtures"
              onClick={() => setTab('fixtures')}
            />
          </div>

          {tab === 'queries' ? (
            <QueryList
              onQueryChange={setFilter}
              onSelect={selectQuery}
              queries={state.queries}
              query={filter}
              selected={target?.queryHash ?? null}
            />
          ) : (
            <FixtureList
              actions={fixtures.actions}
              activeQueryKey={target ? JSON.stringify(target.queryKey) : null}
              onOpen={(summary) => void openFixture(summary)}
              state={fixtures.state}
            />
          )}
        </aside>

        <SeedEditor
          canSaveFixture={fixtures.state.ready}
          intercept={state.capabilities.intercept}
          loading={loading}
          onApply={actions.apply}
          onChange={setText}
          onClear={() => activeSeed && actions.clear(activeSeed.queryHash)}
          onSaveFixture={(name, queryKey, data) =>
            void fixtures.actions.save(name, queryKey, data)
          }
          seeded={Boolean(activeSeed)}
          target={target}
          truncated={Boolean(incoming?.data.truncated)}
          value={text}
        />
      </div>
    </Shell>
  )
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number | null
  onClick: () => void
}) {
  return (
    <button
      className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
      {count !== null ? (
        <span className="text-[11px] text-muted-foreground">{count}</span>
      ) : null}
    </button>
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
