/**
 * Registers the `rozenite agent` tool surface for a live session.
 *
 * Only wiring — the behaviour lives in `agent-handlers.ts`, which is plain
 * functions over a `Session`. All that happens here is binding each contract to
 * its handler and resolving the session.
 *
 * The session is reached through a ref rather than passed as a value because
 * `useSeeder` creates it inside an effect. Registration happens on mount;
 * by the time a tool is actually called, the ref is populated.
 */

import type { RefObject } from 'react'
import { useRozenitePluginAgentTool } from '@rozenite/agent-bridge'

import { seedToolDefinitions } from '../shared/agent-tools'
import { PLUGIN_ID } from '../shared/types'
import * as handlers from './agent-handlers'
import type { Session } from './session'

export type UseSeedAgentToolsOptions = {
  /** Populated by `useSeeder`'s instrumentation effect. */
  sessionRef: RefObject<Session | null>
  enabled: boolean
}

function requireSession(ref: RefObject<Session | null>): Session {
  const session = ref.current
  if (!session) {
    throw new Error(
      'Data Seed is not attached. useSeeder() must be mounted in a development build.',
    )
  }
  return session
}

export function useSeedAgentTools({
  sessionRef,
  enabled,
}: UseSeedAgentToolsOptions): void {
  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.listTargets,
    enabled,
    handler: (args) => handlers.listTargets(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.readTarget,
    enabled,
    handler: (args) => handlers.readTarget(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.applySeed,
    enabled,
    handler: (args) => handlers.applySeed(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.clearSeed,
    enabled,
    handler: (args) => handlers.clearSeed(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.clearAllSeeds,
    enabled,
    handler: () => handlers.clearAllSeeds(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.listFixtures,
    enabled,
    handler: () => handlers.listFixtures(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.applyFixture,
    enabled,
    handler: (args) => handlers.applyFixture(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: seedToolDefinitions.generateSeed,
    enabled,
    handler: (args) => handlers.generateSeed(requireSession(sessionRef), args),
  })
}
