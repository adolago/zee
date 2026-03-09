/**
 * Awareness Module - Enhanced for Assertive Tool Use
 *
 * Generates runtime awareness information for agents including:
 * - Tiered tool catalog with examples (primary → secondary → available)
 * - MCP server tools with concise summaries
 * - Knowledge files from assistant configuration
 * - Runtime configuration state (enabled services)
 *
 * Key improvements:
 * 1. Token budget management - avoids context bloat
 * 2. Tool prioritization - primary tools get full details + examples
 * 3. MCP integration - shows connected servers and their tools
 * 4. Usage examples - makes models more assertive in tool calling
 */

import type { Agent } from "../../packages/zee/src/agent/agent"
import { generateToolCatalog, formatCatalogForPrompt } from "./tool-catalog"
import { loadKnowledgeFiles, formatKnowledgeForPrompt } from "./knowledge-loader"
import { getRuntimeState, formatRuntimeStateForPrompt } from "./config-injector"
import { generateMcpCatalog, formatMcpCatalogForPrompt, getMcpHealthStatus } from "./mcp-catalog"

export { generateToolCatalog, formatCatalogForPrompt } from "./tool-catalog"
export { loadKnowledgeFiles, formatKnowledgeForPrompt } from "./knowledge-loader"
export { getRuntimeState, formatRuntimeStateForPrompt } from "./config-injector"
export { generateMcpCatalog, formatMcpCatalogForPrompt, getMcpHealthStatus } from "./mcp-catalog"

export type { ToolCatalog, ToolCatalogEntry } from "./tool-catalog"
export type { LoadedKnowledge } from "./knowledge-loader"
export type { RuntimeState, ServiceStatus } from "./config-injector"
export type { McpCatalog, McpServerInfo, McpToolInfo } from "./mcp-catalog"

// Token budgets for each section (total ~4000 tokens)
const TOKEN_BUDGETS = {
  toolCatalog: 2000,    // Primary + secondary tools with examples
  mcpCatalog: 500,      // MCP servers and their tools
  runtimeState: 300,    // Enabled services
  knowledge: 1200,      // Persona knowledge files
}

/**
 * Generate complete awareness section for system prompt
 *
 * Order of sections (most actionable first):
 * 1. Your Primary Tools - assistant-specific tools with examples
 * 2. Core Tools - essential tools in compact format
 * 3. MCP Servers - external tools available via MCP
 * 4. Active Configuration - enabled services
 * 5. Knowledge Context - assistant knowledge files
 */
export async function generateAwarenessSection(agent: Agent.Info): Promise<string> {
  const sections: string[] = []

  // 1. Tool Catalog (primary + secondary + available)
  // This is the most important section - tells the model what it can do
  try {
    const catalog = await generateToolCatalog(agent)
    const toolSection = formatCatalogForPrompt(catalog, TOKEN_BUDGETS.toolCatalog)
    if (toolSection) {
      sections.push(toolSection)
    }
  } catch {
    // Log but don't fail
  }

  // 2. MCP Servers (if any connected)
  try {
    const mcpCatalog = await generateMcpCatalog()
    if (mcpCatalog.totalTools > 0) {
      const mcpSection = formatMcpCatalogForPrompt(mcpCatalog, TOKEN_BUDGETS.mcpCatalog)
      if (mcpSection) {
        sections.push(mcpSection)
      }
    }
  } catch {
    // MCP may not be initialized
  }

  // 3. Runtime Configuration (enabled services)
  try {
    const state = await getRuntimeState(agent.name)
    const configSection = formatRuntimeStateForPrompt(state)
    if (configSection) {
      sections.push(configSection)
    }
  } catch {
    // Log but don't fail
  }

  // 4. Knowledge Files
  // Load assistant-specific knowledge (IDENTITY.md, SOUL.md, etc.)
  try {
    const knowledge = await loadKnowledgeFiles(agent.knowledge)
    const knowledgeSection = formatKnowledgeForPrompt(knowledge, TOKEN_BUDGETS.knowledge)
    if (knowledgeSection) {
      sections.push(knowledgeSection)
    }
  } catch {
    // Log but don't fail
  }

  return sections.join("\n\n")
}

/**
 * Generate a compact awareness summary for constrained contexts
 * Used when context is limited (e.g., sub-agents, quick queries)
 */
export async function generateCompactAwareness(agent: Agent.Info): Promise<string> {
  const lines: string[] = []

  try {
    const catalog = await generateToolCatalog(agent)
    const primaryTools = catalog.tools
      .filter((t) => t.priority === "primary")
      .map((t) => t.id)
      .slice(0, 5)

    if (primaryTools.length > 0) {
      lines.push(`Primary tools: ${primaryTools.join(", ")}`)
    }

    if (catalog.enabledServices.length > 0) {
      lines.push(`Services: ${catalog.enabledServices.join(", ")}`)
    }
  } catch {
    // Ignore
  }

  try {
    const mcpHealth = await getMcpHealthStatus()
    if (mcpHealth.healthy > 0) {
      lines.push(`MCP: ${mcpHealth.healthy} server(s) connected`)
    }
  } catch {
    // MCP may not be initialized
  }

  return lines.join(" | ")
}

/**
 * Get awareness health status for diagnostics
 */
export async function getAwarenessHealth(agent: Agent.Info): Promise<{
  toolCount: number
  primaryToolCount: number
  mcpServerCount: number
  mcpToolCount: number
  knowledgeFileCount: number
  enabledServiceCount: number
}> {
  let toolCount = 0
  let primaryToolCount = 0
  let mcpServerCount = 0
  let mcpToolCount = 0
  let knowledgeFileCount = 0
  let enabledServiceCount = 0

  try {
    const catalog = await generateToolCatalog(agent)
    toolCount = catalog.tools.length
    primaryToolCount = catalog.tools.filter((t) => t.priority === "primary").length
    enabledServiceCount = catalog.enabledServices.length
  } catch {
    // Ignore
  }

  try {
    const mcpCatalog = await generateMcpCatalog()
    mcpServerCount = mcpCatalog.servers.filter((s) => s.status === "connected").length
    mcpToolCount = mcpCatalog.totalTools
  } catch {
    // MCP may not be initialized
  }

  try {
    const knowledge = await loadKnowledgeFiles(agent.knowledge)
    knowledgeFileCount = knowledge.length
  } catch {
    // Ignore
  }

  return {
    toolCount,
    primaryToolCount,
    mcpServerCount,
    mcpToolCount,
    knowledgeFileCount,
    enabledServiceCount,
  }
}
