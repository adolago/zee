import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
// NOTE: PROMPT_EXPLORE removed - explore agent replaced by Personas system
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Log } from "../util/log"

const log = Log.create({ service: "agent" })

// Persona bootstrap cache (lazy loaded)
let personaBootstrapCache: { PERSONAS: any; AGENT_CONFIGS: any } | null = null

/**
 * Load persona bootstrap data from src/agent/personas.
 * Uses dynamic import to handle different build scenarios gracefully.
 * Falls back to empty personas if load fails (allows agent-core to start without personas).
 */
async function loadPersonaBootstrap(): Promise<{ PERSONAS: any; AGENT_CONFIGS: any }> {
  if (personaBootstrapCache) {
    return personaBootstrapCache
  }

  try {
    // Dynamic import to handle different build/runtime scenarios
    const mod = await import("../../../../src/agent/personas")
    if (!mod.PERSONAS || !mod.AGENT_CONFIGS) {
      throw new Error("Missing exports PERSONAS or AGENT_CONFIGS")
    }
    personaBootstrapCache = { PERSONAS: mod.PERSONAS, AGENT_CONFIGS: mod.AGENT_CONFIGS }
    log.debug("Loaded persona bootstrap", { personas: Object.keys(mod.PERSONAS) })
    return personaBootstrapCache
  } catch (e) {
    log.warn("Failed to load persona bootstrap, personas will not have custom configs", {
      error: e instanceof Error ? e.message : String(e),
    })
    // Return empty to allow graceful degradation
    personaBootstrapCache = { PERSONAS: {}, AGENT_CONFIGS: {} }
    return personaBootstrapCache
  }
}

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      topK: z.number().optional(),
      temperature: z.number().optional(),
      // Additional sampling parameters
      frequencyPenalty: z.number().min(-2).max(2).optional(),
      presencePenalty: z.number().min(-2).max(2).optional(),
      seed: z.number().int().optional(),
      minP: z.number().min(0).max(1).optional(),
      // Per-model sampling parameters (Rosetta Stone)
      // Keys are model family patterns matched against model.id (e.g. "opus", "gemini-3")
      // null value = locked params (don't override, e.g. GPT-5 series)
      modelParams: z
        .record(
          z.string(),
          z.union([
            z.object({
              temperature: z.number().optional(),
              topP: z.number().optional(),
              topK: z.number().optional(),
              frequencyPenalty: z.number().optional(),
              presencePenalty: z.number().optional(),
            }),
            z.null(),
          ]),
        )
        .optional(),
      color: z.string().optional(),
      theme: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      fallback: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
      // Persona-specific fields (from AgentPersonaConfig)
      systemPromptAdditions: z.string().optional(),
      knowledge: z.array(z.string()).optional(),
      mcpServers: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    // Base permissions: allow everything by default, with specific security rules
    const basePermissions = PermissionNext.fromConfig({
      "*": "allow",
      question: "deny",
      // .env blocking is now handled in ReadTool itself (defense in depth)
      // but we keep the permission rules here for documentation
      read: {
        "*": "allow",
        ".env": "deny",
        ".env.*": "deny",
        "*.env": "deny",
        "*.env.*": "deny",
        ".env.example": "allow",
        "*.env.example": "allow",
        ".env.sample": "allow",
        "*.env.sample": "allow",
        ".env.template": "allow",
        "*.env.template": "allow",
      },
    })

    // Security defaults that should be applied AFTER user config, unless user
    // has explicitly configured them. These ensure doom_loop and external_directory
    // always prompt unless the user explicitly allows/denies them.
    const securityDefaults = PermissionNext.fromConfig({
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      question: "deny",
      hold_enter: "deny",
      hold_release: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })

    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    // Helper: Check if user has explicitly configured a permission
    const userHasPermission = (perm: string) => user.some((r) => r.permission === perm)

    // Build defaults: base + user + security defaults (for unconfigured permissions)
    // This ensures user can override security defaults if they explicitly want to,
    // but wildcards like "*": "allow" don't accidentally override them
    const buildDefaults = () => {
      const result = [...basePermissions, ...user]
      // Add security defaults only if user hasn't explicitly configured them
      if (!userHasPermission("doom_loop")) {
        result.push(...securityDefaults.filter((r) => r.permission === "doom_loop"))
      }
      if (!userHasPermission("external_directory")) {
        result.push(...securityDefaults.filter((r) => r.permission === "external_directory"))
      }
      return result
    }
    const defaults = buildDefaults()

    // NOTE: Built-in agents (build, plan, general, explore) removed.
    // agent-core uses the Personas system (Zee, Stanley, Johny) defined in .agents/skills/
    // Custom agents are loaded from config and skill files.

    // System agents (compaction, title, summary) have fixed permissions that cannot be
    // overridden by user config. These are internal system functions that should never
    // have access to tools.
    const systemDenyAll = PermissionNext.fromConfig({ "*": "deny" })

    const result: Record<string, Info> = {
      // Internal system agents - required for core functionality
      // NOTE: These do NOT include user permissions - they're locked down
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: systemDenyAll,
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: systemDenyAll,
        prompt: PROMPT_TITLE,
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: systemDenyAll,
        prompt: PROMPT_SUMMARY,
      },
    }

    // Bootstrap personas from src/agent/personas.ts
    // This provides the base layer with systemPromptAdditions, knowledge, mcpServers
    // Config file settings will be merged on top
    const { PERSONAS, AGENT_CONFIGS } = await loadPersonaBootstrap()

    for (const [personaId, personaConfig] of Object.entries(PERSONAS) as [string, any][]) {
      const agentConfig = AGENT_CONFIGS[personaId] as any
      if (!agentConfig) {
        log.warn("Persona missing agent config, skipping", { personaId })
        continue
      }

      result[personaId] = {
        name: personaId,
        description: agentConfig.description,
        mode: (agentConfig.mode ?? "primary") as "primary" | "subagent" | "all",
        native: agentConfig.native ?? false,
        hidden: false,
        // Map AgentConfig casing (providerId/modelId) to Agent.Info casing (providerID/modelID)
        model: agentConfig.model
          ? { providerID: agentConfig.model.providerId, modelID: agentConfig.model.modelId }
          : undefined,
        temperature: agentConfig.temperature,
        modelParams: agentConfig.modelParams,
        color: agentConfig.color,
        // defaults already includes user global permissions
        permission: [...defaults],
        options: agentConfig.options ?? {},
        // Persona-specific fields
        systemPromptAdditions: personaConfig.systemPromptAdditions,
        knowledge: personaConfig.knowledge,
        mcpServers: personaConfig.mcpServers,
      }
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          // defaults already includes user global permissions
          permission: [...defaults],
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      if (value.fallback) item.fallback = Provider.parseModel(value.fallback)
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.topK = value.top_k ?? item.topK
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
      // Additional sampling parameters
      item.frequencyPenalty = value.frequency_penalty ?? item.frequencyPenalty
      item.presencePenalty = value.presence_penalty ?? item.presencePenalty
      item.seed = value.seed ?? item.seed
      item.minP = value.min_p ?? item.minP
      item.modelParams = value.model_params ?? item.modelParams
      // Persona-specific fields - config can override persona defaults
      item.systemPromptAdditions = value.systemPromptAdditions ?? item.systemPromptAdditions
      item.knowledge = value.knowledge ?? item.knowledge
      item.mcpServers = value.mcpServers ?? item.mcpServers
    }

    // Ensure Truncate.DIR is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      // Sort by default_agent config, no hardcoded fallback
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : false), "desc"]),
    )
  }

  export async function defaultAgent(): Promise<string> {
    const cfg = await Config.get()
    const agents = await state()

    // Default to zee if no default_agent configured
    const defaultAgentName = cfg.default_agent ?? "zee"
    const agent = agents[defaultAgentName]
    
    if (!agent) throw new Error(`default agent "${defaultAgentName}" not found`)
    if (agent.mode === "subagent") throw new Error(`default agent "${defaultAgentName}" is a subagent`)
    if (agent.hidden === true) throw new Error(`default agent "${defaultAgentName}" is hidden`)
    
    // Persona is REQUIRED - agent name must map to zee, stanley, or johny
    const personaNames = ["zee", "stanley", "johny"]
    if (!personaNames.includes(agent.name)) {
      throw new Error(`default agent "${agent.name}" must be a persona (zee, stanley, or johny)`)
    }
    
    return agent.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()
    const params = {
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
