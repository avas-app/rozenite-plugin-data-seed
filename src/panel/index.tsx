import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  PluginHeader,
  PluginShell,
  Tooltip,
} from '@rozenite/ui'
import { Loader2, PlugZap } from 'lucide-react'

import { sameQueryKey } from '../shared/fixture'
import type { GenerateWarning } from '../shared/generate'
import { generate as generateValue } from '../shared/generate'
import { findByPattern } from '../shared/schema'
import type { SchemaDocument } from '../shared/schema'
import type { BundledFixture } from '../shared/types'
import { GenerateBar } from './components/GenerateBar'
import { FixtureList } from './components/FixtureList'
import { QueryList } from './components/QueryList'
import {
  SeedEditor,
  toEditableText,
  type EditorTarget,
} from './components/SeedEditor'
import { useProjectRoot } from './fixtures/project-root'
import { useFixtures } from './fixtures/use-fixtures'
import { useQuerySeedPanel } from './store'
import './globals.css'

const SUBTITLE = 'Push fake data into the TanStack Query cache and make it stick.'

type Tab = 'queries' | 'fixtures'

export default function QuerySeedPanel() {
  const { state, actions, bridgeReady } = useQuerySeedPanel()
  const fixtures = useFixtures()
  const projectRoot = useProjectRoot(state.frames)

  const [tab, setTab] = useState<Tab>('queries')
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState<EditorTarget | null>(null)
  // The editor is controlled from here because two independent sources fill it:
  // a cache read arriving over the bridge, and a fixture read from disk.
  const [text, setText] = useState('')
  const [filledFor, setFilledFor] = useState<string | null>(null)
  const [itemCount, setItemCount] = useState(3)
  const [variant, setVariant] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<GenerateWarning[]>([])
  // Bumped on every press so repeated Generates give different data, while any
  // single seed still reproduces its value exactly.
  const [roll, setRoll] = useState(0)

  const incoming =
    target?.queryHash && state.editorData?.queryHash === target.queryHash
      ? state.editorData
      : null

  useEffect(() => {
    if (!incoming || filledFor === incoming.queryHash) return
    setText(toEditableText(incoming.data))
    setFilledFor(incoming.queryHash)
  }, [incoming, filledFor])

  const incomingFixture =
    target?.fixtureId && state.fixtureData?.id === target.fixtureId
      ? state.fixtureData
      : null

  useEffect(() => {
    if (!incomingFixture || filledFor === incomingFixture.id) return
    setText(toEditableText(incomingFixture.data))
    setFilledFor(incomingFixture.id)
  }, [incomingFixture, filledFor])

  // Saving is the one path that needs real filesystem access, so the folder
  // prompt happens here — at the moment it is required — rather than as a wall
  // in front of a feature that mostly does not need it.
  const saveFixture = useCallback(
    async (name: string, queryKey: unknown[], data: unknown) => {
      if (!fixtures.state.ready && !(await fixtures.actions.connect())) return
      await fixtures.actions.save(name, queryKey, data)
    },
    [fixtures.actions, fixtures.state.ready],
  )

  const selectQuery = useCallback(
    (queryHash: string) => {
      const query = state.queries.find((q) => q.queryHash === queryHash)
      if (!query) return
      setTarget({ queryKey: query.queryKey, queryHash, source: 'query' })
      setText('')
      setFilledFor(null)
      setWarnings([])
      // Row previews are clipped, so the editor has to ask for the real value.
      actions.readData(queryHash)
    },
    [actions, state.queries],
  )

  // Fixture values come from the app bundle over the bridge, like cache reads,
  // rather than from the browser's filesystem access — which is what lets this
  // work with no folder ever having been chosen.
  const openFixture = useCallback(
    (fixture: BundledFixture) => {
      setTarget({
        queryKey: fixture.queryKey,
        queryHash: null,
        source: 'fixture',
        fixtureName: fixture.name,
        fixtureId: fixture.id,
      })
      setText('')
      setFilledFor(null)
      setWarnings([])
      actions.readFixture(fixture.id)
    },
    [actions],
  )

  /** The schema summary covering the current key, if any. */
  const schemaSummary = useMemo(
    () => (target ? findByPattern(state.schemas, target.queryKey) : null),
    [state.schemas, target],
  )

  // Schemas are fetched on demand, so ask as soon as one is known to exist.
  useEffect(() => {
    if (schemaSummary) actions.readSchema(schemaSummary.pattern)
  }, [actions, schemaSummary])

  const schemaDocument = useMemo(() => {
    if (!schemaSummary || !state.schema) return null
    if (!sameQueryKey(state.schema.pattern, schemaSummary.pattern)) return null
    return (state.schema.schema as SchemaDocument | null) ?? null
  }, [schemaSummary, state.schema])

  const runGenerate = useCallback(() => {
    if (!schemaDocument || !target) return
    const result = generateValue(schemaDocument, {
      seed: `${JSON.stringify(target.queryKey)}:${roll}`,
      arrayLength: itemCount,
      variant: variant ?? undefined,
    })
    setText(JSON.stringify(result.value, null, 2))
    setWarnings(result.warnings)
    setRoll((current) => current + 1)
    // Marks the editor as filled so a cache read still in flight does not land
    // on top of what was just generated.
    setFilledFor(target.queryHash ?? target.fixtureId ?? 'generated')
  }, [itemCount, roll, schemaDocument, target, variant])

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

  const loading =
    target !== null &&
    filledFor !== (target.source === 'query' ? target.queryHash : target.fixtureId)

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
              count={state.capabilities.fixtures ? state.fixtures.length : null}
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
              capable={state.capabilities.fixtures}
              fixtures={state.fixtures}
              onOpen={openFixture}
              problems={state.fixtureProblems}
              projectRoot={projectRoot}
              selectedId={target?.fixtureId ?? null}
              writeActions={fixtures.actions}
              writeState={fixtures.state}
            />
          )}
        </aside>

        <SeedEditor
          canSaveFixture={fixtures.state.supported}
          generate={
            schemaSummary ? (
              <GenerateBar
                itemCount={itemCount}
                loading={!schemaDocument}
                onGenerate={runGenerate}
                onItemCountChange={setItemCount}
                onVariantChange={setVariant}
                typeName={schemaSummary.type}
                variant={variant}
                warnings={warnings}
              />
            ) : null
          }
          intercept={state.capabilities.intercept}
          loading={loading}
          onApply={actions.apply}
          onChange={setText}
          onClear={() => activeSeed && actions.clear(activeSeed.queryHash)}
          onSaveFixture={(name, queryKey, data) =>
            void saveFixture(name, queryKey, data)
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
