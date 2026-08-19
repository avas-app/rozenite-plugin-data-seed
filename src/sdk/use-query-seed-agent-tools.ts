/**
 * Registers the `rozenite agent` tool surface for a live session.
 *
 * Only wiring — the behaviour lives in `agent-handlers.ts`, which is plain
 * functions over a `Session`. All that happens here is binding each contract to
 * its handler and resolving the session.
 *
 * The session is reached through a ref rather than passed as a value because
 * `useQuerySeeder` creates it inside an effect. Registration happens on mount;
 * by the time a tool is actually called, the ref is populated.
 */

import type { RefObject } from 'react'
import { useRozenitePluginAgentTool } from '@rozenite/agent-bridge'

import { querySeedToolDefinitions } from '../shared/agent-tools'
import { PLUGIN_ID } from '../shared/types'
import * as handlers from './agent-handlers'
import type { Session } from './session'

export type UseQuerySeedAgentToolsOptions = {
  /** Populated by `useQuerySeeder`'s instrumentation effect. */
  sessionRef: RefObject<Session | null>
  enabled: boolean
}

function requireSession(ref: RefObject<Session | null>): Session {
  const session = ref.current
  if (!session) {
    throw new Error(
      'Query Seed is not attached. useQuerySeeder() must be mounted with a QueryClient, in a development build.',
    )
  }
  return session
}

export function useQuerySeedAgentTools({
  sessionRef,
  enabled,
}: UseQuerySeedAgentToolsOptions): void {
  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.listQueries,
    enabled,
    handler: (args) => handlers.listQueries(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.readQuery,
    enabled,
    handler: (args) => handlers.readQuery(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.applySeed,
    enabled,
    handler: (args) => handlers.applySeed(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.clearSeed,
    enabled,
    handler: (args) => handlers.clearSeed(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.clearAllSeeds,
    enabled,
    handler: () => handlers.clearAllSeeds(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.listFixtures,
    enabled,
    handler: () => handlers.listFixtures(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.applyFixture,
    enabled,
    handler: (args) => handlers.applyFixture(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: querySeedToolDefinitions.generateSeed,
    enabled,
    handler: (args) => handlers.generateSeed(requireSession(sessionRef), args),
  })
}
