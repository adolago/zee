/**
 * Tool Catalog Generator - Enhanced for Assertive Tool Use
 *
 * Generates a tiered, concise catalog of available tools that:
 * 1. Prioritizes assistant-specific tools with full details + examples
 * 2. Shows core tools in compact format
 * 3. Lists available MCP tools briefly
 * 4. Stays within token budget to avoid context bloat
 */

import { ToolRegistry } from "../../packages/zee/src/tool/registry"
import type { Agent } from "../../packages/zee/src/agent/agent"
import { getZeeSplitwiseConfig, getZeeCodexbarConfig } from "../config/runtime"

export interface ToolCatalogEntry {
  id: string
  description: string
  actions?: string[]
  category?: string
  priority?: "primary" | "secondary" | "available"
  example?: string
}

export interface ToolCatalog {
  agent: string
  tools: ToolCatalogEntry[]
  enabledServices: string[]
  generatedAt: number
}

// Primary tools - all available to the unified Zee assistant
const AGENT_PRIMARY_TOOLS: Record<string, string[]> = {
  zee: [
    // Life admin
    "zee:browser",
    "zee:browser-standalone",
    "zee:splitwise",
    "zee:calendar",
    "zee:memory-query",
    "zee:email",
    "zee:memory",
    "whatsapp",
    // Investing (zee:invest-* namespace)
    "zee:invest-portfolio",
    "zee:invest-market-data",
    "zee:invest-nautilus",
    "zee:invest-sec-filings",
    "zee:invest-research",
    "zee:invest-planner",
    "zee:invest-estimates",
    "zee:invest-insider-trades",
    "zee:invest-segments",
    // Learning (zee:learn-* namespace)
    "zee:learn-knowledge",
    "zee:learn-mastery",
    "zee:learn-review",
    "zee:learn-practice",
    "zee:learn-study",
  ],
}

// Core tools that are always relevant (secondary tier)
const CORE_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "task",
  "webfetch",
  "websearch",
]

// Usage examples for primary tools - makes models assertive
const TOOL_EXAMPLES: Record<string, string> = {
  "zee:splitwise": 'Use { action: "create-expense", group: "Apartment", amount: 50, description: "Groceries" }',
  "zee:browser": 'Use { action: "open", url: "https://example.com" } then { action: "snapshot", format: "ai" } for read-only web tasks.',
  "zee:browser-standalone":
    'Use { action: "start", profile: "default" } then { action: "navigate", url: "https://example.com" } for direct browser control.',
  "zee:calendar": 'Use { action: "list", days: 7 } to see upcoming events',
  "zee:memory": 'Use { action: "search", query: "..." } to recall past conversations',
  bash: "Run commands directly. For git: git status, git diff, git commit",
  read: "Read files with absolute paths. Supports images, PDFs, notebooks",
  edit: 'Use { old_string: "...", new_string: "..." } for precise edits',
  glob: 'Find files: { pattern: "**/*.ts" } or { pattern: "src/**/*.test.ts" }',
  grep: 'Search content: { pattern: "function.*", path: "src/" }',
  task: "Spawn agents for complex tasks. Use subagent_type: Explore for codebase research",
  webfetch: "Fetch and analyze web content. Provide URL and prompt",
  websearch: "Search the web for current information",
}

/**
 * Generate tool catalog with tiered prioritization
 */
export async function generateToolCatalog(agent: Agent.Info): Promise<ToolCatalog> {
  const registry = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent)
  const agentName = agent.name.toLowerCase()
  const primaryToolIds = AGENT_PRIMARY_TOOLS[agentName] ?? []

  const tools: ToolCatalogEntry[] = []

  for (const tool of registry) {
    if (tool.id === "invalid") continue

    const isPrimary = primaryToolIds.some((p) => tool.id.includes(p) || tool.id === p)
    const isCore = CORE_TOOLS.includes(tool.id)
    const isAgentTool = tool.id.startsWith(`${agentName}:`)

    const entry: ToolCatalogEntry = {
      id: tool.id,
      description: extractDescription(tool.description ?? "", isPrimary || isAgentTool),
      priority: isPrimary || isAgentTool ? "primary" : isCore ? "secondary" : "available",
    }

    // Add actions for multi-action tools
    const actions = extractActions(tool.description ?? "")
    if (actions.length > 0) {
      entry.actions = actions
    }

    // Categorize by prefix
    if (tool.id.includes(":")) {
      entry.category = tool.id.split(":")[0]
    }

    // Add usage example for primary/core tools
    const exampleKey =
      Object.keys(TOOL_EXAMPLES).find((k) => tool.id === k) ??
      Object.keys(TOOL_EXAMPLES).find((k) => tool.id.includes(k))
    if (exampleKey && (isPrimary || isCore)) {
      entry.example = TOOL_EXAMPLES[exampleKey]
    }

    tools.push(entry)
  }

  // Sort: primary first, then secondary, then available
  tools.sort((a, b) => {
    const order = { primary: 0, secondary: 1, available: 2 }
    return (order[a.priority ?? "available"] ?? 2) - (order[b.priority ?? "available"] ?? 2)
  })

  return {
    agent: agent.name,
    tools,
    enabledServices: getEnabledServices(agent.name),
    generatedAt: Date.now(),
  }
}

/**
 * Format catalog with tiered display to control context size
 */
export function formatCatalogForPrompt(catalog: ToolCatalog, maxTokens: number = 2000): string {
  if (catalog.tools.length === 0) return ""

  const lines: string[] = []
  const approxCharsPerToken = 4
  const maxChars = maxTokens * approxCharsPerToken
  let currentChars = 0

  // Group by priority
  const primary = catalog.tools.filter((t) => t.priority === "primary")
  const secondary = catalog.tools.filter((t) => t.priority === "secondary")
  const available = catalog.tools.filter((t) => t.priority === "available")

  // === PRIMARY TOOLS (Full details + examples) ===
  if (primary.length > 0) {
    lines.push("## Your Primary Tools")
    lines.push("Use these tools assertively - they are your main capabilities:")
    lines.push("")

    for (const tool of primary) {
      const entry = formatPrimaryTool(tool)
      if (currentChars + entry.length > maxChars * 0.6) break // Reserve space
      lines.push(entry)
      currentChars += entry.length
    }
    lines.push("")
  }

  // === CORE TOOLS (Compact format) ===
  if (secondary.length > 0 && currentChars < maxChars * 0.8) {
    lines.push("## Core Tools")
    lines.push("")

    for (const tool of secondary) {
      const entry = formatSecondaryTool(tool)
      if (currentChars + entry.length > maxChars * 0.9) break
      lines.push(entry)
      currentChars += entry.length
    }
    lines.push("")
  }

  // === AVAILABLE TOOLS (Just names) ===
  if (available.length > 0 && currentChars < maxChars * 0.95) {
    // Group by category for compact display
    const byCategory = groupByCategory(available)
    const categoryEntries: string[] = []

    for (const [category, tools] of Object.entries(byCategory)) {
      const names = tools.map((t) => t.id.split(":").pop() ?? t.id).join(", ")
      if (category) {
        categoryEntries.push(`${category}: ${names}`)
      } else {
        categoryEntries.push(names)
      }
    }

    if (categoryEntries.length > 0) {
      lines.push("## Also Available")
      lines.push(categoryEntries.join(" | "))
      lines.push("")
    }
  }

  // === ENABLED SERVICES ===
  if (catalog.enabledServices.length > 0) {
    lines.push("## Active Integrations")
    for (const service of catalog.enabledServices) {
      lines.push(`- ${service}`)
    }
  }

  return lines.join("\n")
}

function formatPrimaryTool(tool: ToolCatalogEntry): string {
  const lines: string[] = []
  lines.push(`### ${tool.id}`)
  lines.push(tool.description)

  if (tool.actions && tool.actions.length > 0) {
    lines.push(`**Actions:** ${tool.actions.join(", ")}`)
  }

  if (tool.example) {
    lines.push(`**Example:** ${tool.example}`)
  }

  lines.push("")
  return lines.join("\n")
}

function formatSecondaryTool(tool: ToolCatalogEntry): string {
  const actionHint = tool.actions?.length ? ` [${tool.actions.slice(0, 3).join(", ")}${tool.actions.length > 3 ? "..." : ""}]` : ""
  const exampleHint = tool.example ? ` - ${tool.example}` : ""
  return `- **${tool.id}**: ${tool.description}${actionHint}${exampleHint}`
}

function extractDescription(rawDescription: string, fullLength: boolean = false): string {
  if (!rawDescription) return "(no description)"

  const firstLine = rawDescription.split("\n")[0]?.trim() ?? ""
  const parts = firstLine.split(/\.\s/)
  const firstSentence = parts[0] ?? ""

  // Primary tools get longer descriptions
  const maxLen = fullLength ? 200 : 80
  const desc = firstSentence.length < firstLine.length ? firstSentence + "." : firstLine

  return desc.length > maxLen ? desc.slice(0, maxLen - 3) + "..." : desc
}

function extractActions(description: string): string[] {
  if (!description) return []

  // Look for action enums in description
  const enumMatch = description.match(/["']?action["']?\s*:\s*\{[^}]*["']?enum["']?\s*:\s*\[([^\]]+)\]/i)
  if (enumMatch && enumMatch[1]) {
    return enumMatch[1]
      .split(",")
      .map((s) => s.replace(/["'\s]/g, ""))
      .filter(Boolean)
      .slice(0, 10) // Limit to avoid bloat
  }

  // Pattern: Actions: create-expense, update-expense
  const actionListMatch = description.match(/Actions?:?\s*([a-z-]+(?:,\s*[a-z-]+)*)/i)
  if (actionListMatch && actionListMatch[1]) {
    return actionListMatch[1].split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
  }

  return []
}

function groupByCategory(tools: ToolCatalogEntry[]): Record<string, ToolCatalogEntry[]> {
  const grouped: Record<string, ToolCatalogEntry[]> = {}

  for (const tool of tools) {
    const category = tool.category ?? ""
    if (!grouped[category]) {
      grouped[category] = []
    }
    grouped[category].push(tool)
  }

  return grouped
}

function getEnabledServices(_agentName: string): string[] {
  const services: string[] = []

  try {
    const splitwise = getZeeSplitwiseConfig()
    if (splitwise.enabled) {
      services.push("Splitwise (expenses, payments, groups)")
    }
  } catch {
    // Config not available
  }

  try {
    const codexbar = getZeeCodexbarConfig()
    if (codexbar.enabled) {
      services.push("CodexBar (usage tracking)")
    }
  } catch {
    // Config not available
  }

  return services
}
