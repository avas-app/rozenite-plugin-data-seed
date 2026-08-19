import { useEffect, useMemo, useReducer } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type {
  Capabilities,
  QuerySeedEventMap,
  QuerySnapshot,
  SeedSnapshot,
  SerializedPayload,
  Snapshot,
} from '../shared/types'
import { PLUGIN_ID } from '../shared/types'

export type PanelState = {
  /** True once a snapshot has arrived — distinguishes "no app" from "empty cache". */
  hydrated: boolean
  queries: QuerySnapshot[]
  seeds: SeedSnapshot[]
  capabilities: Capabilities
  /**
   * Full data for the query currently open in the editor, fetched on demand.
   * The query list carries only previews, so this is the one place the panel
   * ever holds a complete cache value.
   */
  editorData: { queryHash: string; data: SerializedPayload } | null
}

const INITIAL: PanelState = {
  hydrated: false,
  queries: [],
  seeds: [],
  capabilities: { intercept: false },
  editorData: null,
}

type Action =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'queries'; queries: QuerySnapshot[] }
  | { type: 'seeds'; seeds: SeedSnapshot[] }
  | { type: 'data'; queryHash: string; data: SerializedPayload }
  | { type: 'clear-editor' }

function reducer(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    case 'snapshot':
      return {
        ...state,
        hydrated: true,
        queries: action.snapshot.queries,
        seeds: action.snapshot.seeds,
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
    case 'clear-editor':
      return { ...state, editorData: null }
    default:
      return state
  }
}

export type PanelActions = {
  /** Asks the app for one query's full data, to prefill the editor. */
  readData: (queryHash: string) => void
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
    ]

    // The app may have been running long before this panel opened.
    client.send('seed:request-snapshot', {})

    return () => subscriptions.forEach((s) => s.remove())
  }, [client])

  const actions = useMemo<PanelActions>(
    () => ({
      readData: (queryHash) => client?.send('seed:read-data', { queryHash }),
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
