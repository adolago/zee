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
import { NamedError } from "@zee/util/error"
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
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCohere } from "@ai-sdk/cohere"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createAzure } from "@ai-sdk/azure"
import { ProviderTransform } from "./transform"
import { dedup, hasDedupParser } from "./dedup"

import blacklistData from "./blacklist.json"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  /**
   * Blacklist data loaded from blacklist.json.
   * Contains model and provider blacklists with human-readable reasons.
   */
  type BlacklistEntry = { id: string; reason: string }

  const MODEL_BLACKLIST: Record<string, string[]> = {}
  const MODEL_BLACKLIST_REASONS: Record<string, Record<string, string>> = {}
  for (const [providerID, entries] of Object.entries(blacklistData.models)) {
    MODEL_BLACKLIST[providerID] = (entries as BlacklistEntry[]).map((e) => e.id)
    MODEL_BLACKLIST_REASONS[providerID] = {}
    for (const entry of entries as BlacklistEntry[]) {
      MODEL_BLACKLIST_REASONS[providerID][entry.id] = entry.reason
    }
  }

  const PROVIDER_BLACKLIST = new Set<string>(blacklistData.providers.map((e) => e.id))
  const PROVIDER_BLACKLIST_REASONS: Record<string, string> = {}
  for (const entry of blacklistData.providers) {
    PROVIDER_BLACKLIST_REASONS[entry.id] = entry.reason
  }

  const HARDCODED_MODEL_ALLOWLIST: Record<string, Set<string>> = {
    anthropic: new Set(["claude-opus-4-6"]),
    "zai-coding-plan": new Set(["glm-4.7", "glm-4.7-flash", "glm-5"]),
    minimax: new Set(["MiniMax-M2.5"]),
    xai: new Set(["grok-4-1", "grok-4-1-fast", "grok-4-1-fast-non-reasoning"]),
    openai: new Set(["gpt-5.2", "gpt-5.3-codex", "gpt-5.3-codex-spark"]),
  }

  const HARDCODED_MODEL_ALLOW_FILTERS: Record<string, (modelID: string) => boolean> = {
    google: (modelID: string) => {
      const normalized = modelID
        .trim()
        .toLowerCase()
        .replace(/^google\//, "")
        .replace(/^models\//, "")
      return (
        /^gemini-(?:live-)?3(?:[.-]|$)/.test(normalized) ||
        normalized.includes("-latest") ||
        normalized.includes("embedding")
      )
    },
  }

  /**
   * Get the reason a model is blacklisted, or undefined if not blacklisted.
   */
  export function getModelBlacklistReason(providerID: string, modelID: string): string | undefined {
    return MODEL_BLACKLIST_REASONS[providerID]?.[modelID]
  }

  /**
   * Get the reason a provider is blacklisted, or undefined if not blacklisted.
   */
  export function getProviderBlacklistReason(providerID: string): string | undefined {
    return PROVIDER_BLACKLIST_REASONS[providerID]
  }

  export function isProviderBlocked(providerID: string): boolean {
    return PROVIDER_BLACKLIST.has(providerID)
  }

  function clientHeaders(options?: { lower?: boolean }) {
    const referer = Env.get("ZEE_HTTP_REFERER")
    const title = Env.get("ZEE_CLIENT_TITLE") ?? "zee"
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
    "@ai-sdk/azure": createAzure,
    "@ai-sdk/cohere": createCohere,
    "@ai-sdk/deepinfra": createDeepInfra,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/mistral": createMistral,
    // Use custom OpenAI wrapper with GPT-5 stream completion fix
    // @ts-ignore - types from custom wrapper don't match SDK factory signature
    "@ai-sdk/openai": createPatchedOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@ai-sdk/perplexity": createPerplexity,
    "@ai-sdk/togetherai": createTogetherAI,
    "@ai-sdk/xai": createXai,
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
    azure: async () => {
      return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
          if (options?.["useCompletionUrls"]) {
            return sdk.chat(modelID)
          } else {
            return sdk.responses(modelID)
          }
        },
        options: {},
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
        streaming: z.boolean().optional(),
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
        url: provider.api ?? "",
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
        streaming: model.streaming ?? true,
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
        interleaved:
          model.interleaved ??
          (provider.npm === "@ai-sdk/anthropic" && model.reasoning
            ? true
            : // Kimi reasoning models require reasoning_content on all assistant messages
              provider.id === "kimi-for-coding" && model.reasoning
              ? { field: "reasoning_content" as const }
              : false),
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
    if (database.google && !database["google-antigravity"]) {
      database["google-antigravity"] = {
        ...database.google,
        id: "google-antigravity",
        name: "Google Antigravity",
        env: [],
        options: {},
        models: {},
      }
    }

    const disabled = new Set(config.disabled_providers ?? [])
    const blocked = new Set([...disabled, ...PROVIDER_BLACKLIST])
    for (const providerID of blocked) {
      if (database[providerID]) {
        const reason =
          PROVIDER_BLACKLIST_REASONS[providerID] ?? (disabled.has(providerID) ? "disabled_providers config" : "blocked")
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
            streaming: model.streaming ?? existingModel?.capabilities.streaming ?? true,
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
            interleaved:
              model.interleaved ??
              existingModel?.capabilities.interleaved ??
              // Kimi reasoning models require reasoning_content on all assistant messages
              (providerID === "kimi-for-coding" && model.reasoning ? { field: "reasoning_content" as const } : false),
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
      const auth = await Auth.get(providerID)
      if (auth) hasAuth = true

      if (!hasAuth) continue
      if (!plugin.auth.loader) continue

      // Load for the main provider if auth exists
      if (auth) {
        const authGetter = () => Auth.get(providerID) as any
        const options = await plugin.auth.loader(authGetter, database[plugin.auth.provider])
        const opts = options ?? {}
        const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
        mergeProvider(providerID, patch)

        // If this is antigravity plugin, set up the provider properly
        // The plugin's fetch interceptor handles Claude/Gemini models via Google Cloud Code API
        // The plugin returns apiKey: "" because it uses OAuth via custom fetch
        if (providerID === "google-antigravity") {
          // Force-create antigravity provider if it doesn't exist (no env/api key configured)
          if (!providers["google-antigravity"] && database["google-antigravity"]) {
            providers["google-antigravity"] = {
              ...database["google-antigravity"],
              source: "custom",
              options: {},
            }
            log.info("created google-antigravity provider for antigravity plugin")
          }

          if (providers["google-antigravity"]) {
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
            providers["google-antigravity"].options = {
              ...providers["google-antigravity"].options,
              apiKey: "antigravity-oauth-placeholder",
              fetch: wrappedFetch,
            }
            log.info("configured google-antigravity provider with antigravity auth", {
              hasApiKey: !!providers["google-antigravity"].options.apiKey,
              hasFetch: typeof providers["google-antigravity"].options.fetch === "function",
            })

            // Add Antigravity models - Claude and Gemini via Google Cloud Code API
            const antigravityModels: Record<string, Model> = {
              "antigravity-claude-opus-4-5-thinking": {
                id: "antigravity-claude-opus-4-5-thinking",
                providerID: "google-antigravity",
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
                  streaming: true,
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
                providerID: "google-antigravity",
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
                  streaming: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: true },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                release_date: "2025-02-24",
              },
              "antigravity-claude-sonnet-4-5-thinking": {
                id: "antigravity-claude-sonnet-4-5-thinking",
                providerID: "google-antigravity",
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
                  streaming: true,
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
                providerID: "google-antigravity",
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
                  streaming: true,
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
                providerID: "google-antigravity",
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
                  streaming: true,
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

            // Add models to google-antigravity provider
            for (const [modelID, model] of Object.entries(antigravityModels)) {
              const existing = providers["google-antigravity"].models[modelID]
              if (!existing) {
                providers["google-antigravity"].models[modelID] = model
                continue
              }

              // Config often provides partial overrides (e.g., options) for these models.
              // Ensure canonical API wiring from the plugin model definition always wins.
              const merged = mergeDeep(model, existing) as Model
              merged.id = modelID
              merged.providerID = "google-antigravity"
              merged.api = {
                ...merged.api,
                id: model.api.id,
                npm: model.api.npm,
                url: model.api.url,
              }
              merged.options = mergeDeep(model.options ?? {}, existing.options ?? {})
              merged.variants = mergeDeep(model.variants ?? {}, existing.variants ?? {})

              providers["google-antigravity"].models[modelID] = merged
            }

            log.info("added antigravity models to google-antigravity provider", {
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
        const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
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
              streaming: true,
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
          const blReason = MODEL_BLACKLIST_REASONS[providerID]?.[modelID] ?? "hard-coded blacklist"
          log.debug("model filtered", { providerID, modelID, reason: blReason })
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
        const allowedModels = HARDCODED_MODEL_ALLOWLIST[providerID]
        if (allowedModels) {
          const resolvedModelID = model.api.id ?? model.id ?? modelID
          if (!allowedModels.has(modelID) && !allowedModels.has(resolvedModelID)) {
            log.debug("model filtered", {
              providerID,
              modelID,
              reason: `${providerID} hard model allowlist`,
            })
            delete provider.models[modelID]
          }
        }

        const allowFilter = HARDCODED_MODEL_ALLOW_FILTERS[providerID]
        if (allowFilter) {
          const resolvedModelID = model.api.id ?? model.id ?? modelID
          if (!allowFilter(modelID) && !allowFilter(resolvedModelID)) {
            log.debug("model filtered", {
              providerID,
              modelID,
              reason: `${providerID} hard model filter`,
            })
            delete provider.models[modelID]
          }
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

      // Deduplicate model versions: keep only the best per family
      // Applies to anthropic, openai, google, xai (providers with registered parsers)
      if (hasDedupParser(providerID)) {
        const removedByDedup = dedup(providerID, Object.keys(provider.models))
        for (const modelID of removedByDedup) {
          delete provider.models[modelID]
        }
      }

      if (Object.keys(provider.models).length === 0) {
        log.debug("provider removed", { providerID, reason: "no models remaining after filtering" })
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    // Cross-provider dedup: remove models from proxy providers (opencode) if they
    // exist in a direct provider with auth. Direct provider always wins.
    const PROXY_PROVIDERS = ["opencode"]
    for (const proxyID of PROXY_PROVIDERS) {
      const proxy = providers[proxyID]
      if (!proxy) continue
      const removedFromProxy: string[] = []
      for (const modelID of Object.keys(proxy.models)) {
        for (const [directID, directProvider] of Object.entries(providers)) {
          if (directID === proxyID) continue
          if (directProvider.models[modelID]) {
            removedFromProxy.push(modelID)
            delete proxy.models[modelID]
            break
          }
        }
      }
      if (removedFromProxy.length > 0) {
        log.debug("cross-provider dedup", { proxy: proxyID, removed: removedFromProxy })
      }
      if (Object.keys(proxy.models).length === 0) {
        log.debug("provider removed", { providerID: proxyID, reason: "all models deduped to direct providers" })
        delete providers[proxyID]
      }
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

      if (!options["baseURL"] && model.api.url) options["baseURL"] = model.api.url
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

        // Merge configured headers into request headers
        opts.headers = {
          ...(typeof opts.headers === "object" ? opts.headers : {}),
          ...options["headers"],
        }

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

  /**
   * Normalize model IDs for provider-side aliases/renames.
   * Keep this narrow and conservative to avoid changing behavior for other providers.
   */
  function normalizeRequestedModelID(providerID: string, modelID: string): string {
    if (providerID !== "google") return modelID

    let normalized = modelID
      .trim()
      .replace(/^google\//, "")
      .replace(/-+/g, "-")

    // Some clients send Gemini 3 IDs using "3.0" while catalog keys use "3".
    normalized = normalized.replace(/^gemini-3\.0(?=-)/, "gemini-3")

    // Gemini 3 shorthand aliases should resolve to canonical preview IDs.
    if (normalized === "gemini-3-pro") return "gemini-3-pro-preview"
    if (normalized === "gemini-3-flash") return "gemini-3-flash-preview"

    return normalized
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

    const normalizedModelID = normalizeRequestedModelID(providerID, modelID)
    const requestedModelIDs = normalizedModelID === modelID ? [modelID] : [normalizedModelID, modelID]
    const info = requestedModelIDs.map((id) => provider.models[id]).find(Boolean)
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matchedSuggestions = Array.from(
        new Set(
          requestedModelIDs.flatMap((id) =>
            fuzzysort.go(id, availableModels, { limit: 3, threshold: -10000 }).map((match) => match.target),
          ),
        ),
      )
      const suggestions = matchedSuggestions.length > 0 ? matchedSuggestions : availableModels.slice(0, 3)
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
      const candidates = models.some((m) => m.status !== "deprecated")
        ? models.filter((m) => m.status !== "deprecated")
        : models
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

  let rosettaDefaultModelCache: { providerID: string; modelID: string } | null | undefined

  async function loadRosettaDefaultModel(): Promise<{ providerID: string; modelID: string } | undefined> {
    if (rosettaDefaultModelCache !== undefined) {
      return rosettaDefaultModelCache ?? undefined
    }

    try {
      const mod = await import("../../../../src/agent/model-rosetta")
      const candidate = (mod as any).standardModel ?? (mod as any).personaModels?.zee
      if (
        candidate &&
        typeof candidate.providerId === "string" &&
        candidate.providerId.length > 0 &&
        typeof candidate.modelId === "string" &&
        candidate.modelId.length > 0
      ) {
        rosettaDefaultModelCache = {
          providerID: candidate.providerId,
          modelID: candidate.modelId,
        }
        return rosettaDefaultModelCache
      }
    } catch (error) {
      log.debug("failed to load model rosetta default", {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    rosettaDefaultModelCache = null
    return undefined
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const rosettaDefault = await loadRosettaDefaultModel()
    if (rosettaDefault) {
      try {
        await getModel(rosettaDefault.providerID, rosettaDefault.modelID)
        return rosettaDefault
      } catch (error) {
        log.debug("rosetta default model unavailable, falling back to provider list", {
          providerID: rosettaDefault.providerID,
          modelID: rosettaDefault.modelID,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

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
      const candidates = models.some((m) => m.status !== "deprecated")
        ? models.filter((m) => m.status !== "deprecated")
        : models
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
