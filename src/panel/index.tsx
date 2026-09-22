import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  PluginHeader,
  PluginShell,
  Tooltip,
} from '@rozenite/ui'
import { Loader2, PlugZap } from 'lucide-react'

import type { GenerateWarning } from '../shared/generate'
import { generate as generateValue } from '../shared/generate'
import { describeSchema } from '../shared/describe'
import type { SchemaDocument } from '../shared/schema'
import type { TargetRef } from '../shared/target'
import { findByTarget, formatRef, refCovers } from '../shared/target'
import type { BundledFixture } from '../shared/types'
import { GenerateBar } from './components/GenerateBar'
import { FixtureList } from './components/FixtureList'
import { TargetList } from './components/TargetList'
import {
  SeedEditor,
  toEditableText,
  type EditorTarget,
} from './components/SeedEditor'
import { useProjectRoot } from './fixtures/project-root'
import { useFixtures } from './fixtures/use-fixtures'
import { useSeedPanel } from './store'
import './globals.css'

const SUBTITLE = 'Push fake data into your app and make it stick.'

type Tab = 'targets' | 'fixtures'

export default function SeedPanel() {
  const { state, actions, bridgeReady } = useSeedPanel()
  const fixtures = useFixtures()
  const projectRoot = useProjectRoot(state.frames)

  const [tab, setTab] = useState<Tab>('targets')
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState<EditorTarget | null>(null)
  // The editor is controlled from here because two independent sources fill it:
  // a target read arriving over the bridge, and a fixture read from disk.
  const [text, setText] = useState('')
  const [filledFor, setFilledFor] = useState<string | null>(null)
  const [itemCount, setItemCount] = useState(3)
  const [variant, setVariant] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<GenerateWarning[]>([])
  // Owned here for the same reason `text` is: it has to be reset — and
  // *prefilled* from an existing seed — every time the target changes.
  const [status, setStatus] = useState('200')
  // Bumped on every press so repeated Generates give different data, while any
  // single seed still reproduces its value exactly.
  const [roll, setRoll] = useState(0)

  const incoming =
    target?.id && state.editorData?.id === target.id ? state.editorData : null

  useEffect(() => {
    if (!incoming || filledFor === incoming.id) return
    setText(toEditableText(incoming.data))
    setFilledFor(incoming.id)
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
    async (
      name: string,
      ref: TargetRef,
      data: unknown,
      meta?: { status?: number },
    ) => {
      if (!fixtures.state.ready && !(await fixtures.actions.connect())) return
      await fixtures.actions.save(name, ref, data, meta)
    },
    [fixtures.actions, fixtures.state.ready],
  )

  const openEditor = useCallback(
    (next: EditorTarget) => {
      setTarget(next)
      setText('')
      setFilledFor(null)
      setWarnings([])
      // Prefilled from whatever already covers this target, so opening a route
      // seeded with a 503 and pressing Apply does not quietly reset it to 200.
      const covering = state.seeds.find((seed) => refCovers(seed.ref, next.ref))
      setStatus(String(covering?.meta?.status ?? 200))
    },
    [state.seeds],
  )

  const selectTarget = useCallback(
    (id: string) => {
      const found = state.targets.find((item) => item.id === id)
      if (!found) return
      openEditor({
        ref: found.ref,
        id,
        adapter: found.adapter,
        source: 'target',
      })
      // Row previews are clipped, so the editor has to ask for the real value.
      actions.readData(id)
    },
    [actions, openEditor, state.targets],
  )

  /**
   * Seeding a route that has never been requested.
   *
   * There is no row to select and nothing to read, so the editor opens empty —
   * which is correct: there is no prior value to start from.
   */
  const addRoute = useCallback(
    (ref: TargetRef) => {
      openEditor({ ref, id: null, adapter: 'http', source: 'target' })
      setText('{}')
      setFilledFor('new-route')
    },
    [openEditor],
  )

  // Fixture values come from the app bundle over the bridge, like target reads,
  // rather than from the browser's filesystem access — which is what lets this
  // work with no folder ever having been chosen.
  const openFixture = useCallback(
    (fixture: BundledFixture) => {
      openEditor({
        ref: fixture.target,
        id: null,
        adapter: '',
        source: 'fixture',
        fixtureName: fixture.name,
        fixtureId: fixture.id,
      })
      actions.readFixture(fixture.id)
    },
    [actions, openEditor],
  )

  /** The schema summary covering the current target, if any. */
  const schemaSummary = useMemo(
    () => (target ? findByTarget(state.schemas, target.ref) : null),
    [state.schemas, target],
  )

  // Schemas are fetched on demand, so ask as soon as one is known to exist.
  useEffect(() => {
    if (target && schemaSummary) actions.readSchema(target.ref)
  }, [actions, schemaSummary, target])

  const schemaDocument = useMemo(() => {
    if (!schemaSummary || !state.schema || !target) return null
    // The reply names the ref it was asked about; a stale one from the
    // previously selected target must not fill in for this one.
    if (formatRef(state.schema.ref) !== formatRef(target.ref)) return null
    return (state.schema.schema as SchemaDocument | null) ?? null
  }, [schemaSummary, state.schema, target])

  const shape = useMemo(() => {
    if (!schemaDocument || !schemaSummary) return null
    try {
      return describeSchema(schemaDocument, schemaSummary.type)
    } catch {
      // A shape preview is a convenience; never let it take the panel down.
      return null
    }
  }, [schemaDocument, schemaSummary])

  const runGenerate = useCallback(() => {
    if (!schemaDocument || !target) return
    const result = generateValue(schemaDocument, {
      seed: `${formatRef(target.ref)}:${roll}`,
      arrayLength: itemCount,
      variant: variant ?? undefined,
    })
    setText(JSON.stringify(result.value, null, 2))
    setWarnings(result.warnings)
    setRoll((current) => current + 1)
    // Marks the editor as filled so a read still in flight does not land on top
    // of what was just generated.
    setFilledFor(target.id ?? target.fixtureId ?? 'generated')
  }, [itemCount, roll, schemaDocument, target, variant])

  /**
   * The seed covering the open target, if any.
   *
   * Resolved by ref rather than id, because a fixture — or a route rule — can
   * target something that has never been used and so has no live id. Route
   * seeds are patterns, so this has to be *coverage*, not equality: the seed
   * `GET /v1/profile` is the one behind an observed
   * `GET https://api.example.invalid/v1/profile`.
   */
  const activeSeed = useMemo(
    () =>
      target
        ? (state.seeds.find((seed) => refCovers(seed.ref, target.ref)) ?? null)
        : null,
    [state.seeds, target],
  )

  /**
   * Applying edits the covering seed rather than adding another one.
   *
   * Without this, editing an observed row covered by a broader pattern writes a
   * second seed at the exact URL — and since the pattern was stored first, it
   * keeps winning, so the edit silently does nothing.
   */
  const applyRef = activeSeed?.ref ?? target?.ref ?? null
  const seededBy =
    activeSeed && target && formatRef(activeSeed.ref) !== formatRef(target.ref)
      ? formatRef(activeSeed.ref)
      : null

  /**
   * Whether *this* target's adapter can make a seed stick.
   *
   * Per-adapter rather than global: patching fetch can fail while the query
   * client hooks fine, and a single warning covering both would be wrong half
   * the time.
   */
  const intercept = useMemo(() => {
    const adapterId = target?.adapter || activeSeed?.adapter
    if (!adapterId) return true
    const adapter = state.capabilities.adapters.find((item) => item.id === adapterId)
    return adapter ? adapter.intercept : true
  }, [activeSeed, state.capabilities.adapters, target])

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
              {`import { useSeeder } from '@avasapp/rozenite-plugin-data-seed'

useSeeder({ queryClient, http: true })`}
            </pre>
          }
          icon={PlugZap}
          title="Waiting for an instrumented app."
        />
      </Shell>
    )
  }

  const loading =
    target !== null &&
    filledFor !== (target.source === 'target' ? target.id : target.fixtureId)

  return (
    <Shell>
      <Header>
        {state.seeds.length > 0 ? (
          <>
            <span className="text-xs text-muted-foreground">
              {state.seeds.length} active
            </span>
            <Button onClick={actions.clearAll} size="sm" tone="neutral" variant="outline">
              Remove all seeds
            </Button>
          </>
        ) : null}
      </Header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[22rem] shrink-0 flex-col border-r border-border">
          <div className="flex shrink-0 gap-1 border-b border-border p-1">
            <TabButton
              active={tab === 'targets'}
              count={state.targets.length}
              label="Targets"
              onClick={() => setTab('targets')}
            />
            <TabButton
              active={tab === 'fixtures'}
              count={state.capabilities.fixtures ? state.fixtures.length : null}
              label="Fixtures"
              onClick={() => setTab('fixtures')}
            />
          </div>

          {tab === 'targets' ? (
            <TargetList
              adapters={state.capabilities.adapters}
              onAddRoute={addRoute}
              onQueryChange={setFilter}
              onSelect={selectTarget}
              query={filter}
              selected={target?.id ?? null}
              targets={state.targets}
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
                shape={shape}
                typeName={schemaSummary.type}
                variant={variant}
                warnings={warnings}
              />
            ) : null
          }
          applyRef={applyRef}
          intercept={intercept}
          loading={loading}
          onApply={actions.apply}
          onChange={setText}
          onClear={() => activeSeed && actions.clear(activeSeed.id)}
          onSaveFixture={(name, ref, data, meta) =>
            void saveFixture(name, ref, data, meta)
          }
          onStatusChange={setStatus}
          seeded={Boolean(activeSeed)}
          seededBy={seededBy}
          status={status}
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
        <PluginHeader.Title>Data Seed</PluginHeader.Title>
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
