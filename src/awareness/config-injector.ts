/**
 * Runtime Configuration Injector
 *
 * Reads dynamic configuration and formats it for system prompt.
 * Exposes enabled services and active integrations.
 */

import { getZeeCodexbarConfig } from "../config/runtime"

export interface ServiceStatus {
  name: string
  status: "enabled" | "disabled" | "configured"
  details?: string
}

export interface RuntimeState {
  enabledServices: ServiceStatus[]
  integrations: string[]
}

/**
 * Get current runtime state for an assistant
 */
export async function getRuntimeState(agentName: string): Promise<RuntimeState> {
  const state: RuntimeState = {
    enabledServices: [],
    integrations: [],
  }

  // Zee-specific services
  if (agentName === "zee") {
    // CodexBar
    try {
      const codexbar = getZeeCodexbarConfig()
      state.enabledServices.push({
        name: "CodexBar",
        status: codexbar.enabled ? "enabled" : "disabled",
        details: codexbar.enabled ? "API usage tracking and cost monitoring" : undefined,
      })
    } catch {
      // Config not available
    }
  }

  return state
}

/**
 * Format runtime state for system prompt
 */
export function formatRuntimeStateForPrompt(state: RuntimeState): string {
  const lines: string[] = []

  // Enabled services with full details
  const enabled = state.enabledServices.filter((s) => s.status === "enabled")
  if (enabled.length > 0) {
    if (lines.length === 0) {
      lines.push("## Active Configuration")
      lines.push("")
    }
    lines.push("### Enabled Services")
    for (const service of enabled) {
      if (service.details) {
        lines.push(`- **${service.name}**: ${service.details}`)
      } else {
        lines.push(`- **${service.name}**`)
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}
