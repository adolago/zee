/**
 * Context Tax Measurement
 *
 * Measures the token cost of each component in the system prompt
 * and tool schema context that is sent every turn. Mirrors the
 * assembly logic in session/llm.ts and session/prompt.ts.
 */

import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { SystemPrompt } from "../session/system"
import { InstructionPrompt } from "../session/instruction"
import { ToolRegistry } from "../tool/registry"
import { Skill } from "../skill"
import { estimateTokens, estimateToolTokens } from "./token-estimate"
import { generateAwarenessSection } from "../../../../src/awareness"
import { generateToolCatalog, formatCatalogForPrompt } from "../../../../src/awareness/tool-catalog"
import { generateMcpCatalog, formatMcpCatalogForPrompt } from "../../../../src/awareness/mcp-catalog"
import { loadKnowledgeFiles, formatKnowledgeForPrompt } from "../../../../src/awareness/knowledge-loader"
import { getRuntimeState, formatRuntimeStateForPrompt } from "../../../../src/awareness/config-injector"

export interface ContextComponent {
  name: string
  category: "system" | "tools" | "skills" | "knowledge" | "mcp" | "awareness"
  estimatedTokens: number
  bytes: number
  /** Percentage of total base context */
  pct?: number
}

export interface ContextTaxBreakdown {
  persona: string
  components: ContextComponent[]
  systemSubtotal: number
  toolsSubtotal: number
  totalEstimated: number
  /** Lazy-loaded skill pool stats */
  lazyPool: {
    persona: string
    skillCount: number
    totalBytes: number
    estimatedTokens: number
  }[]
  /** Empirical validation from actual API call */
  empirical?: {
    firstTurnInputTokens: number
    sessionId: string
  }
}

/**
 * Measure the context tax for a persona.
 *
 * Assembles the same context components as LLM.stream() + prompt.ts
 * and measures each one individually.
 */
export async function measureContextTax(personaName: string): Promise<ContextTaxBreakdown> {
  const agent = await Agent.get(personaName)
  if (!agent) {
    throw new Error(`Agent "${personaName}" not found`)
  }

  const modelRef = agent.model ?? (await Provider.defaultModel())
  const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
  const components: ContextComponent[] = []

  // -- SYSTEM PROMPT COMPONENTS --

  // 1. Provider prompt header (anthropic spoof)
  const header = SystemPrompt.header(model.providerID)
  const headerText = header.join("\n")
  if (headerText.length > 0) {
    components.push({
      name: "Provider header",
      category: "system",
      estimatedTokens: estimateTokens(headerText),
      bytes: headerText.length,
    })
  }

  // 2. Provider prompt (anthropic.txt etc.)
  const providerPrompt = agent.prompt ?? SystemPrompt.provider(model).join("\n")
  if (providerPrompt) {
    components.push({
      name: "Provider prompt",
      category: "system",
      estimatedTokens: estimateTokens(providerPrompt),
      bytes: providerPrompt.length,
    })
  }

  // 3. Persona systemPromptAdditions
  if (agent.systemPromptAdditions) {
    components.push({
      name: "Persona additions",
      category: "system",
      estimatedTokens: estimateTokens(agent.systemPromptAdditions),
      bytes: agent.systemPromptAdditions.length,
    })
  }

  // 4. Awareness section (broken down)
  try {
    const toolCatalog = await generateToolCatalog(agent)
    const toolSection = formatCatalogForPrompt(toolCatalog, 2000)
    if (toolSection) {
      components.push({
        name: "Awareness: tool catalog",
        category: "awareness",
        estimatedTokens: estimateTokens(toolSection),
        bytes: toolSection.length,
      })
    }
  } catch { /* skip */ }

  try {
    const mcpCatalog = await generateMcpCatalog()
    if (mcpCatalog.totalTools > 0) {
      const mcpSection = formatMcpCatalogForPrompt(mcpCatalog, 500)
      if (mcpSection) {
        components.push({
          name: "Awareness: MCP catalog",
          category: "awareness",
          estimatedTokens: estimateTokens(mcpSection),
          bytes: mcpSection.length,
        })
      }
    }
  } catch { /* MCP may not be initialized */ }

  try {
    const state = await getRuntimeState(agent.name)
    const configSection = formatRuntimeStateForPrompt(state)
    if (configSection) {
      components.push({
        name: "Awareness: runtime state",
        category: "awareness",
        estimatedTokens: estimateTokens(configSection),
        bytes: configSection.length,
      })
    }
  } catch { /* skip */ }

  try {
    const knowledge = await loadKnowledgeFiles(agent.knowledge)
    const knowledgeSection = formatKnowledgeForPrompt(knowledge, 1200)
    if (knowledgeSection) {
      components.push({
        name: "Awareness: knowledge files",
        category: "knowledge",
        estimatedTokens: estimateTokens(knowledgeSection),
        bytes: knowledgeSection.length,
      })
    }
  } catch { /* skip */ }

  // 5. Environment info
  const envInfo = (await SystemPrompt.environment(model)).join("\n")
  if (envInfo) {
    components.push({
      name: "Environment info",
      category: "system",
      estimatedTokens: estimateTokens(envInfo),
      bytes: envInfo.length,
    })
  }

  // 6. Instruction files (AGENTS.md / CLAUDE.md)
  try {
    const instructions = await InstructionPrompt.system()
    for (const inst of instructions) {
      // Extract path from "Instructions from: /path/to/FILE.md\n..."
      const match = inst.match(/Instructions from: (.+)\n/)
      const fullPath = match?.[1] ?? ""
      const parts = fullPath.split("/")
      // Use last 3 parts to disambiguate (e.g., "src/agent-core/AGENTS.md" vs ".claude/CLAUDE.md")
      const name = parts.length >= 3
        ? parts.slice(-3).join("/")
        : parts.length >= 2
          ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
          : parts[parts.length - 1] ?? "instruction file"
      components.push({
        name: `Instructions: ${name}`,
        category: "system",
        estimatedTokens: estimateTokens(inst),
        bytes: inst.length,
      })
    }
  } catch { /* skip */ }

  // -- TOOL SCHEMA COMPONENTS --

  const tools = await ToolRegistry.tools(modelRef, agent)

  // Group tools by category
  const coreToolIds = ["bash", "read", "write", "edit", "glob", "grep", "task", "webfetch", "websearch", "codesearch", "invalid", "todowrite", "todoread", "lsp", "batch", "hold_release", "hold_enter", "question"]
  const coreSeen: typeof tools = []
  const domainSeen: typeof tools = []
  const mcpSeen: typeof tools = []
  const skillSeen: typeof tools = []

  for (const t of tools) {
    if (t.id === "skill") {
      skillSeen.push(t)
    } else if (coreToolIds.includes(t.id)) {
      coreSeen.push(t)
    } else if (t.id.includes(":") || t.id.startsWith(personaName)) {
      domainSeen.push(t)
    } else if (t.id.includes("_")) {
      // MCP tools use underscore-separated server prefix
      mcpSeen.push(t)
    } else {
      coreSeen.push(t)
    }
  }

  // Core tool schemas
  if (coreSeen.length > 0) {
    let totalTokens = 0
    let totalBytes = 0
    for (const t of coreSeen) {
      const tokens = estimateToolTokens({ description: t.description, parameters: t.parameters })
      totalTokens += tokens
      totalBytes += JSON.stringify(t.parameters ?? {}).length + (t.description?.length ?? 0)
    }
    components.push({
      name: `Core tools (${coreSeen.length})`,
      category: "tools",
      estimatedTokens: totalTokens,
      bytes: totalBytes,
    })
  }

  // Domain tool schemas (persona-specific)
  if (domainSeen.length > 0) {
    let totalTokens = 0
    let totalBytes = 0
    for (const t of domainSeen) {
      const tokens = estimateToolTokens({ description: t.description, parameters: t.parameters })
      totalTokens += tokens
      totalBytes += JSON.stringify(t.parameters ?? {}).length + (t.description?.length ?? 0)
    }
    components.push({
      name: `Domain tools (${domainSeen.length})`,
      category: "tools",
      estimatedTokens: totalTokens,
      bytes: totalBytes,
    })
  }

  // Skill tool (includes inline skill listing)
  if (skillSeen.length > 0) {
    const t = skillSeen[0]
    const tokens = estimateToolTokens({ description: t.description, parameters: t.parameters })
    components.push({
      name: "Skill tool (with skill listing)",
      category: "skills",
      estimatedTokens: tokens,
      bytes: (t.description?.length ?? 0) + JSON.stringify(t.parameters ?? {}).length,
    })
  }

  // MCP tool schemas
  if (mcpSeen.length > 0) {
    // Group by server prefix
    const byServer = new Map<string, typeof mcpSeen>()
    for (const t of mcpSeen) {
      const prefix = t.id.split("_")[0] ?? "unknown"
      if (!byServer.has(prefix)) byServer.set(prefix, [])
      byServer.get(prefix)!.push(t)
    }

    let totalTokens = 0
    let totalBytes = 0
    const serverSummary: string[] = []
    for (const [server, serverTools] of byServer) {
      let serverTokens = 0
      for (const t of serverTools) {
        const tokens = estimateToolTokens({ description: t.description, parameters: t.parameters })
        serverTokens += tokens
        totalBytes += JSON.stringify(t.parameters ?? {}).length + (t.description?.length ?? 0)
      }
      totalTokens += serverTokens
      serverSummary.push(`${server}: ${serverTools.length}`)
    }

    components.push({
      name: `MCP tools (${mcpSeen.length}: ${serverSummary.join(", ")})`,
      category: "mcp",
      estimatedTokens: totalTokens,
      bytes: totalBytes,
    })
  }

  // -- COMPUTE TOTALS --

  const systemSubtotal = components
    .filter((c) => ["system", "awareness", "knowledge"].includes(c.category))
    .reduce((sum, c) => sum + c.estimatedTokens, 0)

  const toolsSubtotal = components
    .filter((c) => ["tools", "skills", "mcp"].includes(c.category))
    .reduce((sum, c) => sum + c.estimatedTokens, 0)

  const totalEstimated = systemSubtotal + toolsSubtotal

  // Compute percentages
  for (const c of components) {
    c.pct = totalEstimated > 0 ? Math.round((c.estimatedTokens / totalEstimated) * 100) : 0
  }

  // -- LAZY POOL (skills available for on-demand loading) --
  const lazyPool = await measureLazyPool(agent.name)

  return {
    persona: personaName,
    components,
    systemSubtotal,
    toolsSubtotal,
    totalEstimated,
    lazyPool,
  }
}

/**
 * Measure the lazy-loaded skill pool sizes.
 * These are only loaded when the Skill tool is invoked.
 */
async function measureLazyPool(personaName: string): Promise<ContextTaxBreakdown["lazyPool"]> {
  const allSkills = await Skill.all(personaName)
  const pool: ContextTaxBreakdown["lazyPool"] = []

  // Group skills by persona context
  const byPersona = new Map<string, Skill.Info[]>()
  for (const skill of allSkills) {
    const ctx = skill.context ?? "shared"
    if (!byPersona.has(ctx)) byPersona.set(ctx, [])
    byPersona.get(ctx)!.push(skill)
  }

  for (const [persona, skills] of byPersona) {
    let totalBytes = 0
    for (const skill of skills) {
      try {
        const file = Bun.file(skill.location)
        const stat = await file.exists() ? file.size : 0
        totalBytes += stat
      } catch {
        // Skip unreadable files
      }
    }

    pool.push({
      persona: persona === "shared" ? "shared" : `@${persona}`,
      skillCount: skills.length,
      totalBytes,
      estimatedTokens: estimateTokens("x".repeat(totalBytes)), // rough estimate
    })
  }

  return pool
}
