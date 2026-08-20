import { useEffect, useMemo, useReducer } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type {
  BundledFixture,
  Capabilities,
  FixtureProblem,
  SeedEventMap,
  SeedMeta,
  TargetSnapshot,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
  SchemaSummary,
  SourceFrame,
} from '../shared/types'
import { PLUGIN_ID } from '../shared/types'
import type { SeedTarget, TargetRef } from '../shared/target'

export type PanelState = {
  /** True once a snapshot has arrived — distinguishes "no app" from "empty cache". */
  hydrated: boolean
  /** Bundle-coordinate frames, used to locate the project on disk. */
  frames: SourceFrame[]
  targets: TargetSnapshot[]
  seeds: SeedSnapshot[]
  /** Fixtures that shipped in the app bundle — the default, setup-free source. */
  fixtures: BundledFixture[]
  fixtureProblems: FixtureProblem[]
  schemas: SchemaSummary[]
  capabilities: Capabilities
  /**
   * Full data for the target currently open in the editor, fetched on demand.
   * The target list carries only previews, so this is the one place the panel
   * ever holds a complete value.
   */
  editorData: { id: string; data: SerializedPayload } | null
  /** Full value of the fixture currently open, fetched on demand. */
  fixtureData: { id: string; data: SerializedPayload } | null
  /** Schema for the target currently open, fetched on demand. */
  schema: { ref: TargetRef; schema: unknown | null } | null
}

const INITIAL: PanelState = {
  hydrated: false,
  frames: [],
  targets: [],
  seeds: [],
  fixtures: [],
  fixtureProblems: [],
  schemas: [],
  capabilities: { adapters: [], fixtures: false, schemas: false },
  editorData: null,
  fixtureData: null,
  schema: null,
}

type Action =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'targets'; targets: TargetSnapshot[] }
  | { type: 'seeds'; seeds: SeedSnapshot[] }
  | { type: 'capabilities'; capabilities: Capabilities }
  | { type: 'data'; id: string; data: SerializedPayload }
  | { type: 'fixtures'; fixtures: BundledFixture[]; problems: FixtureProblem[] }
  | { type: 'fixture-data'; id: string; data: SerializedPayload }
  | { type: 'schema'; ref: TargetRef; schema: unknown | null }
  | { type: 'clear-editor' }

function reducer(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    case 'snapshot':
      return {
        ...state,
        hydrated: true,
        frames: action.snapshot.frames,
        targets: action.snapshot.targets,
        seeds: action.snapshot.seeds,
        fixtures: action.snapshot.fixtures,
        fixtureProblems: action.snapshot.fixtureProblems,
        schemas: action.snapshot.schemas,
        capabilities: action.snapshot.capabilities,
      }
    case 'targets':
      return { ...state, targets: action.targets }
    case 'capabilities':
      return { ...state, capabilities: action.capabilities }
    case 'seeds':
      return { ...state, seeds: action.seeds }
    case 'data':
      return { ...state, editorData: { id: action.id, data: action.data } }
    case 'fixtures':
      return {
        ...state,
        fixtures: action.fixtures,
        fixtureProblems: action.problems,
      }
    case 'fixture-data':
      return { ...state, fixtureData: { id: action.id, data: action.data } }
    case 'schema':
      return { ...state, schema: { ref: action.ref, schema: action.schema } }
    case 'clear-editor':
      return { ...state, editorData: null, fixtureData: null, schema: null }
    default:
      return state
  }
}

export type PanelActions = {
  /** Asks the app for one target's full data, to prefill the editor. */
  readData: (id: string) => void
  readFixture: (id: string) => void
  readSchema: (ref: TargetRef) => void
  apply: (target: SeedTarget, data: unknown, meta?: SeedMeta) => void
  clear: (id: string) => void
  clearAll: () => void
  refresh: () => void
  closeEditor: () => void
}

export function useSeedPanel(): {
  state: PanelState
  actions: PanelActions
  /** False until the bridge connects to the app. */
  bridgeReady: boolean
} {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const client = useRozeniteDevToolsClient<SeedEventMap>({
    pluginId: PLUGIN_ID,
  })

  useEffect(() => {
    if (!client) return

    const subscriptions = [
      client.onMessage('seed:snapshot', (snapshot) =>
        dispatch({ type: 'snapshot', snapshot }),
      ),
      client.onMessage('seed:targets', ({ targets }) =>
        dispatch({ type: 'targets', targets }),
      ),
      client.onMessage('seed:capabilities', (capabilities) =>
        dispatch({ type: 'capabilities', capabilities }),
      ),
      client.onMessage('seed:seeds', ({ seeds }) =>
        dispatch({ type: 'seeds', seeds }),
      ),
      client.onMessage('seed:data', ({ id, data }) =>
        dispatch({ type: 'data', id, data }),
      ),
      client.onMessage('seed:fixtures', ({ fixtures, problems }) =>
        dispatch({ type: 'fixtures', fixtures, problems }),
      ),
      client.onMessage('seed:fixture-data', ({ id, data }) =>
        dispatch({ type: 'fixture-data', id, data }),
      ),
      client.onMessage('seed:schema', ({ ref, schema }) =>
        dispatch({ type: 'schema', ref, schema }),
      ),
    ]

    // The app may have been running long before this panel opened.
    client.send('seed:request-snapshot', {})

    return () => subscriptions.forEach((s) => s.remove())
  }, [client])

  const actions = useMemo<PanelActions>(
    () => ({
      readData: (id) => client?.send('seed:read-data', { id }),
      readFixture: (id) => client?.send('seed:read-fixture', { id }),
      readSchema: (ref) => client?.send('seed:read-schema', { ref }),
      apply: (target, data, meta) =>
        client?.send('seed:apply', { target, data, meta }),
      clear: (id) => client?.send('seed:clear', { id }),
      clearAll: () => client?.send('seed:clear-all', {}),
      refresh: () => client?.send('seed:request-snapshot', {}),
      closeEditor: () => dispatch({ type: 'clear-editor' }),
    }),
    [client],
  )

  return { state, actions, bridgeReady: Boolean(client) }
}
