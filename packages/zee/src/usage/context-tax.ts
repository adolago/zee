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
import { generateToolCatalog, formatCatalogForPrompt } from "../../../../src/awareness/tool-catalog"
import { generateMcpCatalog, formatMcpCatalogForPrompt } from "../../../../src/awareness/mcp-catalog"
import { loadKnowledgeFiles, formatKnowledgeForPrompt } from "../../../../src/awareness/knowledge-loader"
import { getRuntimeState, formatRuntimeStateForPrompt } from "../../../../src/awareness/config-injector"

export interface ContextComponent {
  name: string
  category: "system" | "tools" | "skills" | "knowledge" | "mcp" | "awareness"
  estimatedTokens: number
  bytes: number
  pct?: number
}

export interface ContextTaxBreakdown {
  agent: string
  components: ContextComponent[]
  systemSubtotal: number
  toolsSubtotal: number
  totalEstimated: number
  lazyPool: {
    scope: string
    skillCount: number
    totalBytes: number
    estimatedTokens: number
  }[]
  empirical?: {
    firstTurnInputTokens: number
    sessionId: string
  }
}

export async function measureContextTax(agentName = "zee"): Promise<ContextTaxBreakdown> {
  const agent = await Agent.get(agentName)
  if (!agent) {
    throw new Error("Agent not found: " + agentName)
  }

  const modelRef = agent.model ?? (await Provider.defaultModel())
  const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)
  const components: ContextComponent[] = []

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

  const providerPrompt = agent.prompt ?? SystemPrompt.provider(model).join("\n")
  if (providerPrompt) {
    components.push({
      name: "Provider prompt",
      category: "system",
      estimatedTokens: estimateTokens(providerPrompt),
      bytes: providerPrompt.length,
    })
  }

  if (agent.systemPromptAdditions) {
    components.push({
      name: "Agent additions",
      category: "system",
      estimatedTokens: estimateTokens(agent.systemPromptAdditions),
      bytes: agent.systemPromptAdditions.length,
    })
  }

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
  } catch {
    /* skip */
  }

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
  } catch {
    /* skip */
  }

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
  } catch {
    /* skip */
  }

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
  } catch {
    /* skip */
  }

  const envInfo = (await SystemPrompt.environment(model)).join("\n")
  if (envInfo) {
    components.push({
      name: "Environment info",
      category: "system",
      estimatedTokens: estimateTokens(envInfo),
      bytes: envInfo.length,
    })
  }

  try {
    const instructions = await InstructionPrompt.system()
    for (const inst of instructions) {
      const match = inst.match(/Instructions from: (.+)\n/)
      const name = match?.[1]?.split("/").pop() ?? "instruction file"
      components.push({
        name: "Instructions: " + name,
        category: "system",
        estimatedTokens: estimateTokens(inst),
        bytes: inst.length,
      })
    }
  } catch {
    /* skip */
  }

  const tools = await ToolRegistry.tools(modelRef, agent)
  const coreToolIds = [
    "bash",
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "task",
    "webfetch",
    "websearch",
    "codesearch",
    "invalid",
    "todowrite",
    "todoread",
    "apply_patch",
    "lsp",
    "batch",
    "question",
  ]
  const coreSeen: typeof tools = []
  const domainSeen: typeof tools = []
  const mcpSeen: typeof tools = []
  const skillSeen: typeof tools = []

  for (const t of tools) {
    if (t.id === "skill") {
      skillSeen.push(t)
    } else if (coreToolIds.includes(t.id)) {
      coreSeen.push(t)
    } else if (t.id.includes(":") || t.id.startsWith(agentName)) {
      domainSeen.push(t)
    } else if (t.id.includes("_")) {
      mcpSeen.push(t)
    } else {
      coreSeen.push(t)
    }
  }

  if (coreSeen.length > 0) {
    let totalTokens = 0
    let totalBytes = 0
    for (const t of coreSeen) {
      totalTokens += estimateToolTokens({ description: t.description, parameters: t.parameters })
      totalBytes += JSON.stringify(t.parameters ?? {}).length + (t.description?.length ?? 0)
    }
    components.push({
      name: "Core tools (" + coreSeen.length + ")",
      category: "tools",
      estimatedTokens: totalTokens,
      bytes: totalBytes,
    })
  }

  if (domainSeen.length > 0) {
    let totalTokens = 0
    let totalBytes = 0
    for (const t of domainSeen) {
      totalTokens += estimateToolTokens({ description: t.description, parameters: t.parameters })
      totalBytes += JSON.stringify(t.parameters ?? {}).length + (t.description?.length ?? 0)
    }
    const names = domainSeen.map((t) => t.id).join(", ")
    components.push({
      name: "Domain tools (" + domainSeen.length + ": " + names + ")",
      category: "tools",
      estimatedTokens: totalTokens,
      bytes: totalBytes,
    })
  }

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

  if (mcpSeen.length > 0) {
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
        serverTokens += estimateToolTokens({ description: t.description, parameters: t.parameters })
        totalBytes += JSON.stringify(t.parameters ?? {}).length + (t.description?.length ?? 0)
      }
      totalTokens += serverTokens
      serverSummary.push(server + ": " + serverTools.length)
    }
    components.push({
      name: "MCP tools (" + mcpSeen.length + ": " + serverSummary.join(", ") + ")",
      category: "mcp",
      estimatedTokens: totalTokens,
      bytes: totalBytes,
    })
  }

  const systemSubtotal = components
    .filter((c) => ["system", "awareness", "knowledge"].includes(c.category))
    .reduce((sum, c) => sum + c.estimatedTokens, 0)

  const toolsSubtotal = components
    .filter((c) => ["tools", "skills", "mcp"].includes(c.category))
    .reduce((sum, c) => sum + c.estimatedTokens, 0)

  const totalEstimated = systemSubtotal + toolsSubtotal

  for (const c of components) {
    c.pct = totalEstimated > 0 ? Math.round((c.estimatedTokens / totalEstimated) * 100) : 0
  }

  const lazyPool = await measureLazyPool(agent.name)

  return {
    agent: agentName,
    components,
    systemSubtotal,
    toolsSubtotal,
    totalEstimated,
    lazyPool,
  }
}

async function measureLazyPool(agentName: string): Promise<ContextTaxBreakdown["lazyPool"]> {
  const allSkills = await Skill.all(agentName)
  const pool: ContextTaxBreakdown["lazyPool"] = []

  const byScope = new Map<string, Skill.Info[]>()
  for (const skill of allSkills) {
    const ctx = skill.context ?? "shared"
    if (!byScope.has(ctx)) byScope.set(ctx, [])
    byScope.get(ctx)!.push(skill)
  }

  for (const [scope, skills] of byScope) {
    let totalBytes = 0
    for (const skill of skills) {
      try {
        const file = Bun.file(skill.location)
        const exists = await file.exists()
        if (exists) {
          totalBytes += file.size
        }
      } catch {
        /* skip */
      }
    }

    pool.push({
      scope: scope === "shared" ? "shared" : "@" + scope,
      skillCount: skills.length,
      totalBytes,
      estimatedTokens: Math.ceil(totalBytes / 4),
    })
  }

  return pool
}
