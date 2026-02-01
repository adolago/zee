import z from "zod"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, generateText, type LanguageModel } from "ai"

// Use any for provider factories - there are multiple @ai-sdk/provider versions
// (2.0.1 and 3.0.3) which causes type incompatibilities between providers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderSDK = any
// Alias for SDK instances stored in maps
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SDK = any
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Plugin } from "../plugin"
import { ModelsDev } from "./models"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { State } from "../project/state"
import { iife } from "@/util/iife"
import { THINKING_BUDGETS } from "./constants"

// Direct imports for bundled providers
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible as createPatchedOpenAI } from "./sdk/openai-compatible/src"
import { ProviderTransform } from "./transform"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  /**
   * Hard-coded model blacklist by provider.
   * Models listed here are permanently hidden from the model selector.
   * Use config blacklist for per-user filtering instead.
   */
  const MODEL_BLACKLIST: Record<string, string[]> = {
    anthropic: [
      "claude-3-5-haiku",
      "claude-3-5-haiku-latest",
      "claude-3-7-sonnet-latest",
      "claude-opus-4-0",
      "claude-opus-4-1",
      "claude-sonnet-4",
      "claude-sonnet-4-0",
    ],
    openai: [
      "gpt-4",
      "gpt-4-turbo",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-5",
      "gpt-5-codex",
      "gpt-5-codex-mini",
      "gpt-5-nano",
      "gpt-5-pro",
      "gpt-5-chat-latest",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
    ],
    google: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash-lite",
      "gemini-live-2.5-flash",
      "gemini-2.5-flash-preview-05-20",
      "gemini-flash-lite-latest",
      "gemini-2.5-flash-image",
    ],
    xai: [
      "grok-2",
      "grok-2-1212",
      "grok-2-latest",
      "grok-2-vision",
      "grok-2-vision-1212",
      "grok-2-vision-latest",
      "grok-3",
      "grok-3-fast",
      "grok-3-fast-latest",
      "grok-3-latest",
      "grok-3-mini",
      "grok-3-mini-fast",
      "grok-3-mini-fast-latest",
      "grok-3-mini-latest",
      "grok-4",
      "grok-4-fast",
      "grok-4-fast-non-reasoning",
    ],
    "kimi-for-coding": [
      "kimi-k2",
      "kimi-k2-thinking",
    ],
    "zai-coding-plan": [
      "glm-4.5",
      "glm-4.5-air",
      "glm-4.5-flash",
      "glm-4.5v",
      "glm-4.6",
      "glm-4.6v",
    ],
    minimax: [
      "MiniMax-M2",
    ],
    opencode: [
      "claude-3-5-haiku",
      "claude-opus-4-1",
      "claude-sonnet-4",
      "gpt-5",
      "gpt-5-codex",
      "gpt-5-nano",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "glm-4.6",
      "kimi-k2",
      "kimi-k2-thinking",
    ],
  }

  /**
   * Hard-coded provider blacklist.
   * Providers listed here are permanently hidden from all menus and lists.
   * Use config.disabled_providers for per-user filtering instead.
   */
  const PROVIDER_BLACKLIST = new Set<string>([
    "nebius",           // Permanently disabled
    "venice",           // Privacy proxy removed
    "alibaba",          // Removed per request
    "synthetic",        // Redundant HuggingFace proxy
    "ollama",           // Local provider - use vLLM instead
    "github-copilot",   // Subscription-based, limited models
    "amazon-bedrock",   // Enterprise AWS only
    // "opencode",      // KEEP - Multi-model proxy useful
    "qwen-portal",      // OAuth complexity, limited models
    "moonshot",         // Duplicate of kimi-for-coding
  ])

  export function isProviderBlocked(providerID: string): boolean {
    return PROVIDER_BLACKLIST.has(providerID)
  }

  function clientHeaders(options?: { lower?: boolean }) {
    const referer = Env.get("AGENT_CORE_HTTP_REFERER") ?? Env.get("OPENCODE_HTTP_REFERER")
    const title = Env.get("AGENT_CORE_CLIENT_TITLE") ?? "agent-core"
    const headers: Record<string, string> = {}
    if (referer) {
      headers[options?.lower ? "http-referer" : "HTTP-Referer"] = referer
    }
    headers[options?.lower ? "x-title" : "X-Title"] = title
    return headers
  }

  function isGpt5OrLater(modelID: string): boolean {
    const match = /^gpt-(\d+)/.exec(modelID)
    if (!match) {
      return false
    }
    return Number(match[1]) >= 5
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => ProviderSDK> = {
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/google": createGoogleGenerativeAI,
    // Use custom OpenAI wrapper with GPT-5 stream completion fix
    // @ts-ignore - types from custom wrapper don't match SDK factory signature
    "@ai-sdk/openai": createPatchedOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@openrouter/ai-sdk-provider": createOpenRouter,
  }

  type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
  type CustomLoader = (provider: Info) => Promise<{
    autoload: boolean
    getModel?: CustomModelLoader
    options?: Record<string, any>
  }>

  const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    async anthropic() {
      return {
        autoload: false,
        options: {
          headers: {
            "anthropic-beta":
              "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          },
        },
      }
    },
    openai: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          return sdk.responses(modelID)
        },
        options: {},
      }
    },
    openrouter: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            ...clientHeaders(),
          },
        },
      }
    },
  }

  export const Model = z
    .object({
      id: z.string(),
      providerID: z.string(),
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning", "reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: provider.api!,
        npm: iife(() => {
          // Fix: Kimi For Coding uses OpenAI-compatible API format, not Anthropic
          // The models-api.json incorrectly specifies @ai-sdk/anthropic
          if (provider.id === "kimi-for-coding") return "@ai-sdk/openai-compatible"
          return model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"
        }),
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date,
      variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: provider.id,
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  const state = Instance.state(async () => {
    using _ = log.time("state")
    const config = await Config.get()
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)

    const disabled = new Set(config.disabled_providers ?? [])
    const blocked = new Set([...disabled, ...PROVIDER_BLACKLIST])
    for (const providerID of blocked) {
      if (database[providerID]) {
        const reason = PROVIDER_BLACKLIST.has(providerID) ? "hard-coded provider blacklist" : "disabled_providers config"
        log.debug("provider blocked", { providerID, reason })
        delete database[providerID]
      }
    }

    const providers: { [providerID: string]: Info } = {}
    const languages = new Map<string, LanguageModel>()
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    const sdk = new Map<number, SDK>()

    log.info("init")

    // Proactively refresh OAuth tokens that are expiring soon
    await Auth.refreshAllExpiring()

    const configProviders = Object.entries(config.provider ?? {}).filter(([providerID]) => !blocked.has(providerID))

    function mergeProvider(providerID: string, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {
        // Preserve source from env or api when custom loaders try to override.
        // User-set credentials (env vars, API keys) should take precedence over plugin detection.
        if ((existing.source === "env" || existing.source === "api") && provider.source === "custom") {
          provider = { ...provider, source: existing.source }
        }
        // mergeDeep returns a complex intersection type that doesn't match Info exactly,
        // but the result is structurally compatible with Info
        providers[providerID] = mergeDeep(existing, provider) as Info
        return
      }
      const match = database[providerID]
      if (!match) return
      providers[providerID] = mergeDeep(match, provider) as Info
    }

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: Info = {
        id: providerID,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: existing?.models ?? {},
      }

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        const parsedModel: Model = {
          id: modelID,
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm: iife(() => {
              // Fix: Kimi For Coding uses OpenAI-compatible API format, not Anthropic
              if (providerID === "kimi-for-coding") return "@ai-sdk/openai-compatible"
              return (
                model.provider?.npm ??
                provider.npm ??
                existingModel?.api.npm ??
                modelsDev[providerID]?.npm ??
                "@ai-sdk/openai-compatible"
              )
            }),
            url: provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID,
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
          family: model.family ?? existingModel?.family ?? "",
          release_date: model.release_date ?? existingModel?.release_date ?? "",
          variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    // load env
    const env = Env.all()
    for (const [providerID, provider] of Object.entries(database)) {
      if (blocked.has(providerID)) continue
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (!apiKey) continue
      mergeProvider(providerID, {
        source: "env",
        key: provider.env.length === 1 ? apiKey : undefined,
      })
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (blocked.has(providerID)) continue
      if (provider.type === "api") {
        const envKeys = database[providerID]?.env ?? []
        for (const envKey of envKeys) {
          if (!Env.get(envKey)) Env.set(envKey, provider.key)
        }
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
    }

    for (const plugin of await Plugin.list()) {
      if (!plugin.auth) continue
      const providerID = plugin.auth.provider
      if (blocked.has(providerID)) continue

      let hasAuth = false
      let auth = await Auth.get(providerID)
      if (auth) hasAuth = true

      // For google provider, also check gemini-cli auth (Antigravity OAuth stored under gemini-cli)
      // Prefer OAuth over API key for Antigravity functionality
      let geminiCliAuth: Awaited<ReturnType<typeof Auth.get>> | undefined
      if (providerID === "google") {
        geminiCliAuth = await Auth.get("gemini-cli")
        if (geminiCliAuth?.type === "oauth") {
          hasAuth = true
          auth = geminiCliAuth
          log.info("using gemini-cli OAuth for google provider")
        }
      }

      if (!hasAuth) continue
      if (!plugin.auth.loader) continue

      // Load for the main provider if auth exists
      if (auth) {
        // For google provider with gemini-cli OAuth, pass the gemini-cli auth getter
        const authGetter = geminiCliAuth
          ? () => Auth.get("gemini-cli") as any
          : () => Auth.get(providerID) as any
        const options = await plugin.auth.loader(authGetter, database[plugin.auth.provider])
        const opts = options ?? {}
        const patch: Partial<Info> = providers[providerID]
          ? { options: opts }
          : { source: "custom", options: opts }
        mergeProvider(providerID, patch)

        // If this is google plugin (antigravity), set up the provider properly
        // The plugin's fetch interceptor handles Claude/Gemini models via Google Cloud Code API
        // The plugin returns apiKey: "" because it uses OAuth via custom fetch
        if (providerID === "google") {
          // Force-create google provider if it doesn't exist (no env/api key configured)
          if (!providers["google"] && database["google"]) {
            providers["google"] = {
              ...database["google"],
              source: "custom",
              options: {},
            }
            log.info("created google provider for antigravity plugin")
          }

          if (providers["google"]) {
            // Wrap the plugin's custom fetch to remove x-goog-api-key header
            // The plugin uses OAuth Bearer token but @ai-sdk/google adds x-goog-api-key
            const pluginFetch = options?.fetch
            const wrappedFetch = pluginFetch
              ? async (input: RequestInfo | URL, init?: RequestInit) => {
                  if (init?.headers) {
                    const headers = new Headers(init.headers)
                    headers.delete("x-goog-api-key")
                    return pluginFetch(input, { ...init, headers })
                  }
                  return pluginFetch(input, init)
                }
              : undefined

            // Set placeholder API key (required by @ai-sdk/google) and preserve custom fetch
            providers["google"].options = {
              ...providers["google"].options,
              apiKey: "antigravity-oauth-placeholder",
              fetch: wrappedFetch,
            }
            log.info("configured google provider with antigravity auth", {
              hasApiKey: !!providers["google"].options.apiKey,
              hasFetch: typeof providers["google"].options.fetch === "function",
            })

            // Add Antigravity models - Claude and Gemini via Google Cloud Code API
            const antigravityModels: Record<string, Model> = {
              "antigravity-claude-opus-4-5-thinking": {
                id: "antigravity-claude-opus-4-5-thinking",
                providerID: "google",
                name: "Claude Opus 4.5 Thinking",
                family: "claude",
                api: {
                  id: "antigravity-claude-opus-4-5-thinking",
                  url: "https://generativelanguage.googleapis.com/v1beta",
                  npm: "@ai-sdk/google",
                },
                status: "active",
                headers: {},
                options: {}, // topP unset - Claude thinking requires topP >= 0.95 or unset
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 200000, output: 64000 },
                capabilities: {
                  temperature: true,
                  reasoning: true,
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: true },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: "2025-02-24",
                variants: {
                  low: { name: "Low Thinking", options: { thinkingBudget: THINKING_BUDGETS.low } },
                  max: { name: "Max Thinking", options: { thinkingBudget: THINKING_BUDGETS.high } },
                },
              },
              "antigravity-claude-sonnet-4-5": {
                id: "antigravity-claude-sonnet-4-5",
                providerID: "google",
                name: "Claude Sonnet 4.5",
                family: "claude",
                api: {
                  id: "antigravity-claude-sonnet-4-5",
                  url: "https://generativelanguage.googleapis.com/v1beta",
                  npm: "@ai-sdk/google",
                },
                status: "active",
                headers: {},
                options: {},
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 200000, output: 64000 },
                capabilities: {
                  temperature: true,
                  reasoning: false,
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: true },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: "2025-02-24",
              },
              "antigravity-claude-sonnet-4-5-thinking": {
                id: "antigravity-claude-sonnet-4-5-thinking",
                providerID: "google",
                name: "Claude Sonnet 4.5 Thinking",
                family: "claude",
                api: {
                  id: "antigravity-claude-sonnet-4-5-thinking",
                  url: "https://generativelanguage.googleapis.com/v1beta",
                  npm: "@ai-sdk/google",
                },
                status: "active",
                headers: {},
                options: {}, // topP unset - Claude thinking requires topP >= 0.95 or unset
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 200000, output: 64000 },
                capabilities: {
                  temperature: true,
                  reasoning: true,
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: true },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: "2025-02-24",
                variants: {
                  low: { name: "Low Thinking", options: { thinkingBudget: THINKING_BUDGETS.low } },
                  max: { name: "Max Thinking", options: { thinkingBudget: THINKING_BUDGETS.high } },
                },
              },
              "antigravity-gemini-3-pro": {
                id: "antigravity-gemini-3-pro",
                providerID: "google",
                name: "Gemini 3 Pro",
                family: "gemini",
                api: {
                  id: "antigravity-gemini-3-pro",
                  url: "https://generativelanguage.googleapis.com/v1beta",
                  npm: "@ai-sdk/google",
                },
                status: "active",
                headers: {},
                options: {},
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 1048576, output: 65535 },
                capabilities: {
                  temperature: true,
                  reasoning: true,
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: true },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: "2025-06-01",
                variants: {
                  low: { name: "Low Thinking", options: { thinkingLevel: "low" } },
                  high: { name: "High Thinking", options: { thinkingLevel: "high" } },
                },
              },
              "antigravity-gemini-3-flash": {
                id: "antigravity-gemini-3-flash",
                providerID: "google",
                name: "Gemini 3 Flash",
                family: "gemini",
                api: {
                  id: "antigravity-gemini-3-flash",
                  url: "https://generativelanguage.googleapis.com/v1beta",
                  npm: "@ai-sdk/google",
                },
                status: "active",
                headers: {},
                options: {},
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 1048576, output: 65536 },
                capabilities: {
                  temperature: true,
                  reasoning: true,
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: true },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: "2025-06-01",
                variants: {
                  minimal: { name: "Minimal Thinking", options: { thinkingLevel: "minimal" } },
                  low: { name: "Low Thinking", options: { thinkingLevel: "low" } },
                  medium: { name: "Medium Thinking", options: { thinkingLevel: "medium" } },
                  high: { name: "High Thinking", options: { thinkingLevel: "high" } },
                },
              },
            }

            // Add models to google provider
            for (const [modelID, model] of Object.entries(antigravityModels)) {
              if (!providers["google"].models[modelID]) {
                providers["google"].models[modelID] = model
              }
            }

            log.info("added antigravity models to google provider", {
              count: Object.keys(antigravityModels).length,
              models: Object.keys(antigravityModels).join(", "),
            })
          }
        }
      }

    }

    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (blocked.has(providerID)) continue
      const data = database[providerID]
      if (!data) {
        log.error("Provider does not exist in model list " + providerID)
        continue
      }
      const result = await fn(data)
      if (result && (result.autoload || providers[providerID])) {
        if (result.getModel) modelLoaders[providerID] = result.getModel
        const opts = result.options ?? {}
        const patch: Partial<Info> = providers[providerID]
          ? { options: opts }
          : { source: "custom", options: opts }
        mergeProvider(providerID, patch)
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      const partial: Partial<Info> = { source: "config" }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    // Auto-discover models from local inference providers (vLLM, Ollama, etc.)
    const LOCAL_INFERENCE_PROVIDERS = new Set(["vllm", "ollama", "lmstudio", "llamacpp", "tgi"])

    for (const [providerID, configProvider] of configProviders) {
      if (!LOCAL_INFERENCE_PROVIDERS.has(providerID)) continue
      if (!configProvider?.options?.baseURL) continue
      if (blocked.has(providerID)) continue

      try {
        const baseURL = (configProvider.options.baseURL as string).replace(/\/v1\/?$/, "")
        const response = await fetch(`${baseURL}/v1/models`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!response.ok) continue
        const data = (await response.json()) as { data?: Array<{ id: string; max_model_len?: number }> }

        // Ensure provider exists
        if (!providers[providerID]) {
          providers[providerID] = {
            id: providerID,
            name: providerID.charAt(0).toUpperCase() + providerID.slice(1),
            models: {},
            source: "config",
            env: configProvider.env ?? [],
            options: configProvider.options,
          }
        }

        for (const apiModel of data.data ?? []) {
          const modelID = apiModel.id
          if (providers[providerID].models[modelID]) continue // Don't overwrite existing

          providers[providerID].models[modelID] = {
            id: modelID,
            name: modelID.split("/").pop() ?? modelID,
            providerID,
            api: {
              id: modelID,
              url: `${baseURL}/v1`,
              npm: "@ai-sdk/openai-compatible",
            },
            status: "active",
            headers: {},
            cost: {
              input: 0,
              output: 0,
              cache: { read: 0, write: 0 },
            },
            capabilities: {
              temperature: true,
              attachment: false,
              reasoning: modelID.toLowerCase().includes("qwen3"),
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: {
              context: apiModel.max_model_len ?? 8192,
              output: Math.min(apiModel.max_model_len ?? 4096, 4096),
            },
            options: {},
            release_date: "1970-01-01",
          }
        }

        log.info("auto-discovered models from local provider", {
          provider: providerID,
          count: Object.keys(providers[providerID].models).length,
        })
      } catch (e) {
        log.debug("failed to fetch models from local provider", { provider: providerID, error: e })
      }
    }

    for (const [providerID, provider] of Object.entries(providers)) {
      if (blocked.has(providerID)) {
        delete providers[providerID]
        continue
      }

      const configProvider = config.provider?.[providerID]

      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api.id = model.api.id ?? model.id ?? modelID
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat")) {
          log.debug("model filtered", { providerID, modelID, reason: "gpt-5-chat exclusion" })
          delete provider.models[modelID]
        }
        if (model.status === "deprecated") {
          log.debug("model filtered", { providerID, modelID, reason: "deprecated status" })
          delete provider.models[modelID]
        }
        // Hard-coded blacklist - permanently hidden models
        if (MODEL_BLACKLIST[providerID]?.includes(modelID)) {
          log.debug("model filtered", { providerID, modelID, reason: "hard-coded blacklist" })
          delete provider.models[modelID]
        }
        if (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) {
          log.debug("model filtered", { providerID, modelID, reason: "config blacklist" })
          delete provider.models[modelID]
        }
        if (configProvider?.whitelist && !configProvider.whitelist.includes(modelID)) {
          log.debug("model filtered", { providerID, modelID, reason: "not in config whitelist" })
          delete provider.models[modelID]
        }

        // Filter out disabled variants from config
        const configVariants = configProvider?.models?.[modelID]?.variants
        if (configVariants && model.variants) {
          const merged = mergeDeep(model.variants, configVariants)
          model.variants = mapValues(
            pickBy(merged, (v) => !v.disabled),
            (v) => omit(v, ["disabled"]),
          )
        }
      }

      // For Anthropic provider, hide older model versions and dated snapshots
      // Priority: 1) -latest suffix, 2) highest non-dated version, 3) most recent dated version
      if (providerID === "anthropic") {
        const modelIDs = Object.keys(provider.models)
        const datePattern = /-(\d{8})$/

        // Parse Claude model names into family and version
        // Formats: claude-{type}-{major}-{minor}, claude-{major}-{minor}-{type}, claude-{major}-{type}
        function parseClaudeModel(
          id: string,
        ): { family: string; version: number; dated: string | null; isLatest: boolean } | null {
          const isLatest = id.endsWith("-latest")
          const dateMatch = id.match(datePattern)
          const dated = dateMatch ? dateMatch[1] : null
          let cleanID = id.replace(datePattern, "").replace(/-latest$/, "")

          // New format: claude-{type}-{major}-{minor} (e.g., claude-opus-4-5)
          const newFormat = cleanID.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/)
          if (newFormat) {
            const [, type, major, minor] = newFormat
            return { family: `claude-${type}`, version: parseFloat(`${major}.${minor}`), dated, isLatest }
          }

          // Old format: claude-{major}-{minor}-{type} (e.g., claude-3-5-sonnet)
          const oldFormat = cleanID.match(/^claude-(\d+)-(\d+)-(opus|sonnet|haiku)$/)
          if (oldFormat) {
            const [, major, minor, type] = oldFormat
            return { family: `claude-${type}`, version: parseFloat(`${major}.${minor}`), dated, isLatest }
          }

          // Oldest format: claude-{major}-{type} (e.g., claude-3-opus)
          const oldestFormat = cleanID.match(/^claude-(\d+)-(opus|sonnet|haiku)$/)
          if (oldestFormat) {
            const [, major, type] = oldestFormat
            return { family: `claude-${type}`, version: parseFloat(major), dated, isLatest }
          }

          // New format without minor: claude-{type}-{major} (e.g., claude-opus-4)
          const newFormatNoMinor = cleanID.match(/^claude-(opus|sonnet|haiku)-(\d+)$/)
          if (newFormatNoMinor) {
            const [, type, major] = newFormatNoMinor
            return { family: `claude-${type}`, version: parseFloat(major), dated, isLatest }
          }

          return null
        }

        // Group models by family
        const families: Record<string, { id: string; version: number; dated: string | null; isLatest: boolean }[]> = {}
        for (const modelID of modelIDs) {
          const parsed = parseClaudeModel(modelID)
          if (parsed) {
            if (!families[parsed.family]) families[parsed.family] = []
            families[parsed.family].push({
              id: modelID,
              version: parsed.version,
              dated: parsed.dated,
              isLatest: parsed.isLatest,
            })
          }
        }

        // For each family, keep only the best version
        for (const [_family, versions] of Object.entries(families)) {
          // Sort by: 1) highest version, 2) isLatest (for same version), 3) non-dated over dated, 4) most recent date
          const sorted = [...versions].sort((a, b) => {
            if (a.version !== b.version) return b.version - a.version
            if (a.isLatest !== b.isLatest) return a.isLatest ? -1 : 1
            if ((a.dated === null) !== (b.dated === null)) return a.dated === null ? -1 : 1
            if (a.dated && b.dated) return b.dated.localeCompare(a.dated) // Most recent date first
            return 0
          })

          // Keep only the first (best) one
          if (sorted.length > 1) {
            log.debug("dedup anthropic family", {
              family: _family,
              kept: sorted[0].id,
              removed: sorted.slice(1).map((s) => s.id),
            })
          }
          for (let i = 1; i < sorted.length; i++) {
            delete provider.models[sorted[i].id]
          }
        }
      }

      if (Object.keys(provider.models).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    return {
      models: languages,
      providers,
      sdk,
      modelLoaders,
    }
  })

  export async function list() {
    return state().then((state) => state.providers)
  }

  export async function reload() {
    await State.dispose(Instance.directory)
  }

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      if (!options["baseURL"]) options["baseURL"] = model.api.url
      // Check for both undefined AND empty string - some plugins return apiKey: ""
      if ((options["apiKey"] === undefined || options["apiKey"] === "") && provider.key) {
        options["apiKey"] = provider.key
      }
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Bun.hash.xxHash32(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      const customFetch = options["fetch"]

      options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const fetchFn = customFetch ?? fetch
        const opts = init ?? {}

        if (options["timeout"] !== undefined && options["timeout"] !== null) {
          const signals: AbortSignal[] = []
          if (opts.signal) signals.push(opts.signal)
          if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

          const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

          opts.signal = combined
        }

        // Strip openai itemId metadata following what codex does
        // IDs are only re-attached for Azure with store=true
        if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
          const body = JSON.parse(opts.body as string)
          const isAzure = model.providerID.includes("azure")
          const keepIds = isAzure && body.store === true
          if (!keepIds && Array.isArray(body.input)) {
            for (const item of body.input) {
              if ("id" in item) {
                delete item.id
              }
            }
            opts.body = JSON.stringify(body)
          }
        }

        return fetchFn(input, {
          ...opts,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })
      }

      const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as SDK
      }

      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await BunProc.install(model.api.npm, "latest")
      } else {
        log.info("loading local provider", { pkg: model.api.npm })
        installedPath = model.api.npm
      }

      const mod = await import(installedPath)

      const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
      const loaded = fn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(providerID: string, modelID: string) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const matches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    const info = provider.models[modelID]
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  export async function getLanguage(model: Model): Promise<LanguageModel> {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    if (s.models.has(key)) return s.models.get(key)!

    const provider = s.providers[model.providerID]
    const sdk = await getSDK(model)

    try {
      const language = s.modelLoaders[model.providerID]
        ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
        : sdk.languageModel(model.api.id)
      s.models.set(key, language)
      return language
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  export async function closest(providerID: string, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
      const priority = [
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "3-5-haiku",
        "3.5-haiku",
        "gemini-3-flash",
        "gemini-2.5-flash",
        "gpt-5-nano",
      ]
      for (const item of priority) {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return getModel(providerID, model)
        }
      }

      const models = Object.values(provider.models)
      const candidates = models.some((m) => m.status !== "deprecated") ? models.filter((m) => m.status !== "deprecated") : models
      const [fallback] = sortBy(
        candidates,
        [(m) => (m.id.includes("latest") ? 1 : 0), "desc"],
        [(m) => m.release_date, "desc"],
        [(m) => m.id, "desc"],
      )
      if (fallback) return getModel(providerID, fallback.id)
    }

    return undefined
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort(models: Model[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const provider = await list()
      .then((val) => Object.values(val))
      .then((x) => x.find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id)))
    if (!provider) throw new Error("no providers found")
    const [model] = sort(Object.values(provider.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: provider.id,
      modelID: model.id,
    }
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: providerID,
      modelID: rest.join("/"),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )

  export async function validateAuth(providerID: string) {
    const provider = await getProvider(providerID)
    if (!provider) {
      throw new Error(`Provider not found: ${providerID}`)
    }

    let model = await getSmallModel(providerID)
    if (!model || model.providerID !== providerID) {
      const models = Object.values(provider.models)
      const candidates = models.some((m) => m.status !== "deprecated") ? models.filter((m) => m.status !== "deprecated") : models
      const [fallback] = sortBy(
        candidates,
        [(m) => (m.id.includes("latest") ? 1 : 0), "desc"],
        [(m) => m.release_date, "desc"],
        [(m) => m.id, "desc"],
      )
      model = fallback ? await getModel(providerID, fallback.id) : undefined
    }
    if (!model) {
      throw new Error(`No model available for provider ${providerID}`)
    }

    const language = await getLanguage(model)
    const options = ProviderTransform.options({
      model,
      sessionID: "auth-validate",
      providerOptions: provider.options,
    })

    await generateText({
      model: language,
      prompt: "ping",
      temperature: 0,
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(8000),
      providerOptions: ProviderTransform.providerOptions(model, options),
      headers: model.headers,
    })
  }
}
