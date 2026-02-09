/**
 * MCP Tool Catalog
 *
 * Generates awareness information for MCP (Model Context Protocol) servers
 * and their tools. Provides concise summaries to avoid context bloat while
 * ensuring the model knows what capabilities are available via MCP.
 */

import { MCP } from "../../packages/zee-core/src/mcp"
import { Config } from "../../packages/zee-core/src/config/config"

export interface McpServerInfo {
  name: string
  status: "connected" | "disabled" | "failed" | "needs_auth"
  toolCount: number
  tools: McpToolInfo[]
}

export interface McpToolInfo {
  id: string
  description: string
  serverName: string
}

export interface McpCatalog {
  servers: McpServerInfo[]
  totalTools: number
  generatedAt: number
}

/**
 * Generate MCP catalog from connected servers
 */
export async function generateMcpCatalog(): Promise<McpCatalog> {
  const status = await MCP.status()
  const tools = await MCP.tools()

  const servers: McpServerInfo[] = []

  for (const [serverName, serverStatus] of Object.entries(status)) {
    const serverTools: McpToolInfo[] = []

    // Find tools belonging to this server
    for (const [toolId, tool] of Object.entries(tools)) {
      if (toolId.startsWith(serverName.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")) {
        serverTools.push({
          id: toolId,
          description: extractToolDescription(tool.description ?? ""),
          serverName,
        })
      }
    }

    servers.push({
      name: serverName,
      status: serverStatus.status === "connected"
        ? "connected"
        : serverStatus.status === "disabled"
          ? "disabled"
          : serverStatus.status === "needs_auth"
            ? "needs_auth"
            : "failed",
      toolCount: serverTools.length,
      tools: serverTools,
    })
  }

  return {
    servers,
    totalTools: Object.keys(tools).length,
    generatedAt: Date.now(),
  }
}

/**
 * Format MCP catalog for system prompt
 * Keeps it concise - just server status and tool counts
 */
export function formatMcpCatalogForPrompt(catalog: McpCatalog, maxTokens: number = 500): string {
  const connectedServers = catalog.servers.filter((s) => s.status === "connected")

  if (connectedServers.length === 0) {
    return ""
  }

  const lines: string[] = ["## MCP Servers", ""]
  const approxCharsPerToken = 4
  const maxChars = maxTokens * approxCharsPerToken
  let currentChars = 0

  for (const server of connectedServers) {
    if (currentChars > maxChars * 0.8) break

    // Server header with tool count
    const header = `### ${server.name} (${server.toolCount} tools)`
    lines.push(header)
    currentChars += header.length

    // List tools briefly (max 5 per server to avoid bloat)
    const toolsToShow = server.tools.slice(0, 5)
    for (const tool of toolsToShow) {
      const shortId = tool.id.split("_").slice(1).join("_") // Remove server prefix
      const entry = `- ${shortId}: ${tool.description}`
      if (currentChars + entry.length > maxChars * 0.9) break
      lines.push(entry)
      currentChars += entry.length
    }

    if (server.tools.length > 5) {
      lines.push(`  _(and ${server.tools.length - 5} more tools)_`)
    }

    lines.push("")
  }

  // Show disabled/failed servers briefly
  const otherServers = catalog.servers.filter((s) => s.status !== "connected")
  if (otherServers.length > 0) {
    const otherList = otherServers
      .map((s) => `${s.name} (${s.status})`)
      .join(", ")
    lines.push(`_Other MCP servers: ${otherList}_`)
  }

  return lines.join("\n")
}

function extractToolDescription(description: string): string {
  if (!description) return "(no description)"

  const firstLine = description.split("\n")[0]?.trim() ?? ""
  const parts = firstLine.split(/\.\s/)
  const firstSentence = parts[0] ?? ""

  const maxLen = 60
  const desc = firstSentence.length < firstLine.length ? firstSentence + "." : firstLine

  return desc.length > maxLen ? desc.slice(0, maxLen - 3) + "..." : desc
}

/**
 * Check if any MCP servers need attention (auth, reconnect)
 */
export async function getMcpHealthStatus(): Promise<{
  healthy: number
  needsAuth: string[]
  failed: string[]
}> {
  const status = await MCP.status()

  const needsAuth: string[] = []
  const failed: string[] = []
  let healthy = 0

  for (const [name, serverStatus] of Object.entries(status)) {
    if (serverStatus.status === "connected") {
      healthy++
    } else if (serverStatus.status === "needs_auth") {
      needsAuth.push(name)
    } else if (serverStatus.status === "failed") {
      failed.push(name)
    }
  }

  return { healthy, needsAuth, failed }
}
