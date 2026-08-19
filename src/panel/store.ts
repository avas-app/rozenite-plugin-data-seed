import { useEffect, useMemo, useReducer } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type {
  BundledFixture,
  Capabilities,
  FixtureProblem,
  QuerySeedEventMap,
  QuerySnapshot,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
  SchemaSummary,
  SourceFrame,
} from '../shared/types'
import { PLUGIN_ID } from '../shared/types'

export type PanelState = {
  /** True once a snapshot has arrived — distinguishes "no app" from "empty cache". */
  hydrated: boolean
  /** Bundle-coordinate frames, used to locate the project on disk. */
  frames: SourceFrame[]
  queries: QuerySnapshot[]
  seeds: SeedSnapshot[]
  /** Fixtures that shipped in the app bundle — the default, setup-free source. */
  fixtures: BundledFixture[]
  fixtureProblems: FixtureProblem[]
  schemas: SchemaSummary[]
  capabilities: Capabilities
  /**
   * Full data for the query currently open in the editor, fetched on demand.
   * The query list carries only previews, so this is the one place the panel
   * ever holds a complete cache value.
   */
  editorData: { queryHash: string; data: SerializedPayload } | null
  /** Full value of the fixture currently open, fetched on demand. */
  fixtureData: { id: string; data: SerializedPayload } | null
  /** Schema for the query currently open, fetched on demand. */
  schema: { pattern: unknown[]; schema: unknown | null } | null
}

const INITIAL: PanelState = {
  hydrated: false,
  frames: [],
  queries: [],
  seeds: [],
  fixtures: [],
  fixtureProblems: [],
  schemas: [],
  capabilities: { intercept: false, fixtures: false, schemas: false },
  editorData: null,
  fixtureData: null,
  schema: null,
}

type Action =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'queries'; queries: QuerySnapshot[] }
  | { type: 'seeds'; seeds: SeedSnapshot[] }
  | { type: 'data'; queryHash: string; data: SerializedPayload }
  | { type: 'fixtures'; fixtures: BundledFixture[]; problems: FixtureProblem[] }
  | { type: 'fixture-data'; id: string; data: SerializedPayload }
  | { type: 'schema'; pattern: unknown[]; schema: unknown | null }
  | { type: 'clear-editor' }

function reducer(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    case 'snapshot':
      return {
        ...state,
        hydrated: true,
        frames: action.snapshot.frames,
        queries: action.snapshot.queries,
        seeds: action.snapshot.seeds,
        fixtures: action.snapshot.fixtures,
        fixtureProblems: action.snapshot.fixtureProblems,
        schemas: action.snapshot.schemas,
        capabilities: action.snapshot.capabilities,
      }
    case 'queries':
      return { ...state, queries: action.queries }
    case 'seeds':
      return { ...state, seeds: action.seeds }
    case 'data':
      return {
        ...state,
        editorData: { queryHash: action.queryHash, data: action.data },
      }
    case 'fixtures':
      return {
        ...state,
        fixtures: action.fixtures,
        fixtureProblems: action.problems,
      }
    case 'fixture-data':
      return { ...state, fixtureData: { id: action.id, data: action.data } }
    case 'schema':
      return { ...state, schema: { pattern: action.pattern, schema: action.schema } }
    case 'clear-editor':
      return { ...state, editorData: null, fixtureData: null, schema: null }
    default:
      return state
  }
}

export type PanelActions = {
  /** Asks the app for one query's full data, to prefill the editor. */
  readData: (queryHash: string) => void
  readFixture: (id: string) => void
  readSchema: (pattern: unknown[]) => void
  apply: (queryKey: unknown[], data: unknown) => void
  clear: (queryHash: string) => void
  clearAll: () => void
  refresh: () => void
  closeEditor: () => void
}

export function useQuerySeedPanel(): {
  state: PanelState
  actions: PanelActions
  /** False until the bridge connects to the app. */
  bridgeReady: boolean
} {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const client = useRozeniteDevToolsClient<QuerySeedEventMap>({
    pluginId: PLUGIN_ID,
  })

  useEffect(() => {
    if (!client) return

    const subscriptions = [
      client.onMessage('seed:snapshot', (snapshot) =>
        dispatch({ type: 'snapshot', snapshot }),
      ),
      client.onMessage('seed:queries', ({ queries }) =>
        dispatch({ type: 'queries', queries }),
      ),
      client.onMessage('seed:seeds', ({ seeds }) =>
        dispatch({ type: 'seeds', seeds }),
      ),
      client.onMessage('seed:data', ({ queryHash, data }) =>
        dispatch({ type: 'data', queryHash, data }),
      ),
      client.onMessage('seed:fixtures', ({ fixtures, problems }) =>
        dispatch({ type: 'fixtures', fixtures, problems }),
      ),
      client.onMessage('seed:fixture-data', ({ id, data }) =>
        dispatch({ type: 'fixture-data', id, data }),
      ),
      client.onMessage('seed:schema', ({ pattern, schema }) =>
        dispatch({ type: 'schema', pattern, schema }),
      ),
    ]

    // The app may have been running long before this panel opened.
    client.send('seed:request-snapshot', {})

    return () => subscriptions.forEach((s) => s.remove())
  }, [client])

  const actions = useMemo<PanelActions>(
    () => ({
      readData: (queryHash) => client?.send('seed:read-data', { queryHash }),
      readFixture: (id) => client?.send('seed:read-fixture', { id }),
      readSchema: (pattern) => client?.send('seed:read-schema', { pattern }),
      apply: (queryKey, data) => client?.send('seed:apply', { queryKey, data }),
      clear: (queryHash) => client?.send('seed:clear', { queryHash }),
      clearAll: () => client?.send('seed:clear-all', {}),
      refresh: () => client?.send('seed:request-snapshot', {}),
      closeEditor: () => dispatch({ type: 'clear-editor' }),
    }),
    [client],
  )

  return { state, actions, bridgeReady: Boolean(client) }
}
