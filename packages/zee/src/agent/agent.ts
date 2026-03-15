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
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_FINDER from "./prompt/finder.txt"
import PROMPT_LIBRARIAN from "./prompt/librarian.txt"
import { PermissionNext } from "@/permission/next"
import { FluxRecorder } from "@/flux"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Log } from "../util/log"

const log = Log.create({ service: "agent" })

const LEGACY_EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"])

function parseProviderModelRef(value: string) {
  const [providerID, ...modelParts] = value.split("/")
  return {
    providerID,
    modelID: modelParts.join("/"),
  }
}

function legacyToolsToPermissionConfig(tools?: Record<string, boolean>) {
  if (!tools) return {}

  const permissionConfig: Record<string, "allow" | "deny"> = {}
  for (const [tool, enabled] of Object.entries(tools)) {
    const permission = LEGACY_EDIT_TOOLS.has(tool) ? "edit" : tool
    const action = enabled ? "allow" : "deny"
    const previous = permissionConfig[permission]

    if (previous === "deny") continue
    if (previous === "allow" && action === "allow") continue
    permissionConfig[permission] = action
  }

  return permissionConfig
}

function recordLegacyToolsAliasUsage(agentName: string, tools?: Record<string, boolean>) {
  if (!tools || Object.keys(tools).length === 0) return

  const translatedPermissions = Object.keys(legacyToolsToPermissionConfig(tools)).sort()
  FluxRecorder.record({
    traceID: crypto.randomUUID(),
    direction: "internal",
    domain: "domain",
    kind: "agent.legacy_tools_alias.used",
    status: "ok",
    metadata: {
      agent: agentName,
      legacyToolIds: Object.keys(tools).sort(),
      translatedPermissions,
    },
  })
}

// Agent bootstrap cache (lazy loaded)
let agentBootstrapCache: { ASSISTANTS: any; AGENT_CONFIGS: any } | null = null
type IdentityModule = typeof import("../../../../src/agent/profile")
let identityModuleCache: IdentityModule | null = null
let identityModuleLoadAttempted = false

async function loadIdentityModule(): Promise<IdentityModule | null> {
  if (identityModuleLoadAttempted) {
    return identityModuleCache
  }
  identityModuleLoadAttempted = true

  try {
    const mod = await import("../../../../src/agent/profile")
    if (!mod.Profile) {
      throw new Error("Missing export Profile")
    }
    identityModuleCache = mod as IdentityModule
    return identityModuleCache
  } catch (e) {
    log.warn("Failed to load agent identity module, identity wiring disabled", {
      error: e instanceof Error ? e.message : String(e),
    })
    identityModuleCache = null
    return null
  }
}

/**
 * Load built-in agent bootstrap data from src/agent/assistants.
 * Uses dynamic import to handle different build scenarios gracefully.
 * Falls back to empty bootstrap data if loading fails.
 */
async function loadAgentBootstrap(): Promise<{ ASSISTANTS: any; AGENT_CONFIGS: any }> {
  if (agentBootstrapCache) {
    return agentBootstrapCache
  }

  try {
    // Dynamic import to handle different build/runtime scenarios
    const mod = await import("../../../../src/agent/assistants")
    if (!mod.ASSISTANTS || !mod.AGENT_CONFIGS) {
      throw new Error("Missing exports ASSISTANTS or AGENT_CONFIGS")
    }
    agentBootstrapCache = { ASSISTANTS: mod.ASSISTANTS, AGENT_CONFIGS: mod.AGENT_CONFIGS }
    log.debug("Loaded agent bootstrap", { agents: Object.keys(mod.ASSISTANTS) })
    return agentBootstrapCache
  } catch (e) {
    log.warn("Failed to load agent bootstrap, built-in agent configs unavailable", {
      error: e instanceof Error ? e.message : String(e),
    })
    // Return empty to allow graceful degradation
    agentBootstrapCache = { ASSISTANTS: {}, AGENT_CONFIGS: {} }
    return agentBootstrapCache
  }
}

export namespace Agent {
  export function resolveName(agent?: string): string | undefined {
    const trimmed = agent?.trim()
    if (!trimmed) return undefined
    return trimmed.toLowerCase()
  }

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
      // Agent bootstrap fields
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

    // Scoped subagent modes available to all agents.
    // These provide read-only or limited-scope variants for task spawning
    result["explore"] = {
      name: "explore",
      description: "Fast agent for exploring codebases - read-only, no edits",
      mode: "subagent",
      native: true,
      hidden: false,
      permission: PermissionNext.merge(
        defaults,
        PermissionNext.fromConfig({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          bash: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          read: "allow",
          external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
        }),
        user,
      ),
      prompt: PROMPT_EXPLORE,
      options: {},
    }
    result["finder"] = {
      name: "finder",
      description: "Focused file and symbol scout for quickly locating relevant code paths",
      mode: "subagent",
      native: true,
      hidden: false,
      permission: PermissionNext.merge(
        defaults,
        PermissionNext.fromConfig({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          read: "allow",
          external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          bash: {
            "git log*": "allow",
            "git diff*": "allow",
            "git status*": "allow",
            "ls*": "allow",
          },
        }),
        user,
      ),
      prompt: PROMPT_FINDER,
      options: {},
    }
    result["plan"] = {
      name: "plan",
      description: "Agent for designing implementation plans - read-only except plan files",
      mode: "subagent",
      native: true,
      hidden: false,
      permission: PermissionNext.merge(
        defaults,
        PermissionNext.fromConfig({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          bash: "allow",
          read: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          edit: "allow",
          external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
        }),
        user,
      ),
      options: {},
    }
    result["general"] = {
      name: "general",
      description: "General-purpose agent for researching complex questions and multi-step tasks",
      mode: "subagent",
      native: true,
      hidden: false,
      permission: PermissionNext.merge(
        defaults,
        PermissionNext.fromConfig({
          todoread: "deny",
          todowrite: "deny",
        }),
        user,
      ),
      options: {},
    }
    result["librarian"] = {
      name: "librarian",
      description: "Codebase context specialist for sourcing reusable references and historical snippets",
      mode: "subagent",
      native: true,
      hidden: false,
      permission: PermissionNext.merge(
        defaults,
        PermissionNext.fromConfig({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          read: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
          bash: {
            "git log*": "allow",
            "git diff*": "allow",
            "git status*": "allow",
          },
        }),
        user,
      ),
      prompt: PROMPT_LIBRARIAN,
      options: {},
    }

    // Bootstrap built-in agents from src/agent/assistants.ts
    // This provides the base layer with systemPromptAdditions, knowledge, mcpServers
    // Config file settings will be merged on top
    const { ASSISTANTS, AGENT_CONFIGS } = await loadAgentBootstrap()

    const agentIdentityPrompts: Record<string, string> = {}

    const loadAgentIdentityPrompt = async (agentConfig: any): Promise<string> => {
      const identityFiles = agentConfig?.identityFiles as string[] | undefined
      if (!identityFiles || identityFiles.length === 0) return ""

      const identityModule = await loadIdentityModule()
      if (!identityModule?.Profile?.loadIdentityContext || !identityModule?.Profile?.composeIdentityPrompt) return ""

      try {
        const identity = await identityModule.Profile.loadIdentityContext(identityFiles, { cwd: Instance.directory })
        return identityModule.Profile.composeIdentityPrompt(identity)
      } catch (e) {
        log.warn("Failed to load agent identity context", {
          error: e instanceof Error ? e.message : String(e),
        })
        return ""
      }
    }

    for (const [agentId, agentProfile] of Object.entries(ASSISTANTS) as [string, any][]) {
      const agentConfig = AGENT_CONFIGS[agentId] as any
      if (!agentConfig) {
        log.warn("Built-in agent missing config, skipping", { agentId })
        continue
      }

      const identityPrompt = await loadAgentIdentityPrompt(agentProfile)
      if (identityPrompt) {
        agentIdentityPrompts[agentId] = identityPrompt
      }
      const systemPromptAdditions = [identityPrompt, agentProfile.systemPromptAdditions].filter(Boolean).join("\n\n")

      // Use permissionRuleset (PermissionNext format) directly when available.
      // Permission chain: base -> built-in agent -> user -> security defaults
      // This ensures user config always overrides built-in defaults,
      // and security defaults are applied last for unconfigured permissions.
      const agentPermissionDefaults: PermissionNext.Ruleset = agentConfig.permissionRuleset ?? []
      const mergedDefaults = (() => {
        const result = [...basePermissions, ...agentPermissionDefaults, ...user]
        if (!userHasPermission("doom_loop")) {
          result.push(...securityDefaults.filter((r) => r.permission === "doom_loop"))
        }
        if (!userHasPermission("external_directory")) {
          result.push(...securityDefaults.filter((r) => r.permission === "external_directory"))
        }
        return result
      })()

      result[agentId] = {
        name: agentId,
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
        permission: mergedDefaults,
        options: agentConfig.options ?? {},
        // Agent bootstrap fields
        systemPromptAdditions,
        knowledge: agentProfile.knowledge,
        mcpServers: agentProfile.mcpServers,
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
      if (value.model) item.model = parseProviderModelRef(value.model)
      if (value.fallback) item.fallback = parseProviderModelRef(value.fallback)
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.topK = value.top_k ?? item.topK
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? value.maxSteps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      recordLegacyToolsAliasUsage(key, value.tools)
      item.permission = PermissionNext.merge(
        item.permission,
        PermissionNext.fromConfig(legacyToolsToPermissionConfig(value.tools)),
        PermissionNext.fromConfig(value.permission ?? {}),
      )
      // Additional sampling parameters
      item.frequencyPenalty = value.frequency_penalty ?? item.frequencyPenalty
      item.presencePenalty = value.presence_penalty ?? item.presencePenalty
      item.seed = value.seed ?? item.seed
      item.minP = value.min_p ?? item.minP
      item.modelParams = value.model_params ?? item.modelParams
      // Agent bootstrap fields - config can override built-in defaults
      item.systemPromptAdditions = value.systemPromptAdditions ?? item.systemPromptAdditions
      item.knowledge = value.knowledge ?? item.knowledge
      item.mcpServers = value.mcpServers ?? item.mcpServers

      const identityPrompt = agentIdentityPrompts[key]
      if (identityPrompt && value.systemPromptAdditions !== undefined) {
        item.systemPromptAdditions = [identityPrompt, item.systemPromptAdditions].filter(Boolean).join("\n\n")
      }
    }

    // Apply permission scope overrides from worker environment
    const permissionScope = process.env.ZEE_PERMISSION_SCOPE
    if (permissionScope === "readonly") {
      for (const name in result) {
        if (result[name].mode !== "primary") continue
        result[name].permission = PermissionNext.merge(
          result[name].permission,
          PermissionNext.fromConfig({
            edit: "deny",
            bash: { "*": "ask", "git log*": "allow", "git diff*": "allow", "git status*": "allow", "ls*": "allow" },
          }),
        )
      }
    } else if (permissionScope === "explore") {
      for (const name in result) {
        if (result[name].mode !== "primary") continue
        result[name].permission = result["explore"]?.permission ?? result[name].permission
      }
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
    const resolved = resolveName(agent)
    if (!resolved) return undefined
    return state().then((x) => x[resolved])
  }

  export async function mustGet(agent: string): Promise<Info> {
    const resolved = resolveName(agent)
    if (!resolved) throw new Error(`agent "${agent}" not found`)

    const info = await state().then((x) => x[resolved])
    if (!info) throw new Error(`agent "${agent}" not found`)
    return info
  }

  export async function list() {
    const cfg = await Config.get()
    const preferredAgent = resolveName(cfg.default_agent)
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (preferredAgent ? x.name === preferredAgent : false), "desc"]),
    )
  }

  export async function defaultAgent(): Promise<string> {
    const cfg = await Config.get()
    const agents = await state()

    // Default to zee if no default_agent configured
    const requestedDefaultAgent = cfg.default_agent ?? "zee"
    const defaultAgentName = resolveName(requestedDefaultAgent) ?? "zee"
    const agent = agents[defaultAgentName]

    if (!agent) throw new Error(`default agent "${requestedDefaultAgent}" not found`)
    if (agent.mode === "subagent") throw new Error(`default agent "${requestedDefaultAgent}" is a subagent`)
    if (agent.hidden === true) throw new Error(`default agent "${requestedDefaultAgent}" is hidden`)

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
