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

// Direct imports for bundled providers
import { createAnthropic } from "@ai-sdk/anthropic"

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible as createPatchedOpenAI } from "./sdk/openai-compatible/src"
import { createXai } from "@ai-sdk/xai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCohere } from "@ai-sdk/cohere"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createAzure } from "@ai-sdk/azure"
import { ProviderTransform } from "./transform"
import { dedup, hasDedupParser } from "./dedup"
import { loadRosettaDefaultModel, resolveDefaultModel } from "./model-selection"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  const RUNTIME_DISABLED_PROVIDER_IDS = new Set(["gemini-cli"])
  const RUNTIME_DISABLED_MODEL_NPMS = new Set<string>()
  const CORE_PROVIDER_IDS = new Set([
    "anthropic",
    "azure",
    "cohere",
    "deepinfra",
    "deepseek",
    "google",
    "google-antigravity",
    "groq",
    "kimi-for-coding",
    "llamacpp",
    "lmstudio",
    "mistral",
    "minimax",
    "minimax-coding-plan",
    "ollama",
    "opencode",
    "openai",
    "openrouter",
    "perplexity",
    "tgi",
    "togetherai",
    "vllm",
    "xai",
    "zai-coding-plan",
  ])

  const HARDCODED_MODEL_ALLOWLIST: Record<string, Set<string>> = {
    anthropic: new Set(["claude-opus-4-6"]),
    "zai-coding-plan": new Set(["glm-4.7", "glm-4.7-flash", "glm-5"]),
    minimax: new Set(["MiniMax-M2.5"]),
    xai: new Set([
      "grok-4.20-experimental-beta-0304-reasoning",
      "grok-4.20-experimental-beta-0304-non-reasoning",
      "grok-4.20-multi-agent-experimental-beta-0304",
    ]),
    openai: new Set(["gpt-5.2", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4"]),
  }

  const HARDCODED_MODEL_ALLOW_FILTERS: Record<string, (modelID: string) => boolean> = {}

  export function isCoreProvider(providerID: string): boolean {
    return CORE_PROVIDER_IDS.has(providerID)
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

  function resolveProviderNpm(providerID: string, npm: string): string {
    if (providerID === "ollama") return "@ai-sdk/ollama"
    return npm
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

  const XAI_GROK_420_BETA_FALLBACK_MODELS: Record<string, ModelsDev.Model> = {
    "grok-4.20-experimental-beta-0304-reasoning": {
      id: "grok-4.20-experimental-beta-0304-reasoning",
      name: "Grok 4.20 Experimental Beta (Reasoning)",
      family: "grok-4.20",
      release_date: "2026-03-04",
      attachment: false,
      reasoning: true,
      temperature: true,
      tool_call: true,
      status: "beta",
      cost: {
        input: 2,
        output: 6,
        cache_read: 0.2,
        context_over_200k: {
          input: 4,
          output: 12,
          cache_read: 0.4,
        },
      },
      limit: {
        context: 2_000_000,
        output: 30_000,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      options: {},
    },
    "grok-4.20-experimental-beta-0304-non-reasoning": {
      id: "grok-4.20-experimental-beta-0304-non-reasoning",
      name: "Grok 4.20 Experimental Beta (Non-Reasoning)",
      family: "grok-4.20",
      release_date: "2026-03-04",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      status: "beta",
      cost: {
        input: 2,
        output: 6,
        cache_read: 0.2,
        context_over_200k: {
          input: 4,
          output: 12,
          cache_read: 0.4,
        },
      },
      limit: {
        context: 2_000_000,
        output: 30_000,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      options: {},
    },
    "grok-4.20-multi-agent-experimental-beta-0304": {
      id: "grok-4.20-multi-agent-experimental-beta-0304",
      name: "Grok 4.20 Multi-Agent Experimental Beta",
      family: "grok-4.20-multi-agent",
      release_date: "2026-03-04",
      attachment: false,
      reasoning: true,
      temperature: true,
      // Multi-agent beta currently does not support client-side custom tools.
      tool_call: false,
      status: "beta",
      cost: {
        input: 2,
        output: 6,
        cache_read: 0.2,
        context_over_200k: {
          input: 4,
          output: 12,
          cache_read: 0.4,
        },
      },
      limit: {
        context: 2_000_000,
        output: 30_000,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      options: {},
    },
  }

  function injectXaiGrok420FallbackModels(provider: Info | undefined) {
    if (!provider || provider.id !== "xai") return

    const xaiProviderForTransform: ModelsDev.Provider = {
      id: "xai",
      name: "xAI",
      env: ["XAI_API_KEY"],
      api: "https://api.x.ai/v1",
      npm: "@ai-sdk/xai",
      models: XAI_GROK_420_BETA_FALLBACK_MODELS,
    }

    for (const [modelID, fallback] of Object.entries(XAI_GROK_420_BETA_FALLBACK_MODELS)) {
      if (provider.models[modelID]) continue
      provider.models[modelID] = fromModelsDevModel(xaiProviderForTransform, fallback)
    }
  }

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: provider.api ?? "",
        npm: resolveProviderNpm(
          provider.id,
          iife(() => {
            // Fix: Kimi For Coding uses OpenAI-compatible API format, not Anthropic
            // The models-api.json incorrectly specifies @ai-sdk/anthropic
            if (provider.id === "kimi-for-coding") return "@ai-sdk/openai-compatible"
            return model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"
          }),
        ),
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
    const database = mapValues(
      pickBy(modelsDev, (_provider, providerID) => CORE_PROVIDER_IDS.has(providerID)),
      fromModelsDevProvider,
    )

    for (const providerID of RUNTIME_DISABLED_PROVIDER_IDS) {
      delete database[providerID]
    }

    const blocked = new Set(config.disabled_providers ?? [])
    for (const providerID of blocked) {
      if (database[providerID]) {
        log.debug("provider disabled", { providerID, reason: "disabled_providers config" })
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

    const configProviders = Object.entries(config.provider ?? {}).filter(
      ([providerID]) =>
        CORE_PROVIDER_IDS.has(providerID) && !blocked.has(providerID) && !RUNTIME_DISABLED_PROVIDER_IDS.has(providerID),
    )

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
            npm: resolveProviderNpm(
              providerID,
              iife(() => {
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
            ),
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
      if (blocked.has(providerID) || !CORE_PROVIDER_IDS.has(providerID)) continue
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (!apiKey) continue
      mergeProvider(providerID, {
        source: "env",
        key: provider.env.length === 1 ? apiKey : undefined,
      })
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (blocked.has(providerID) || !CORE_PROVIDER_IDS.has(providerID)) continue
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
      if (blocked.has(providerID) || !CORE_PROVIDER_IDS.has(providerID) || RUNTIME_DISABLED_PROVIDER_IDS.has(providerID)) continue

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
      }
    }

    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
      if (blocked.has(providerID) || !CORE_PROVIDER_IDS.has(providerID)) continue
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
        const key = providers[providerID]?.key
        const headers =
          key && key !== "local"
            ? {
                Authorization: `Bearer ${key}`,
              }
            : undefined
        const configuredBaseURL = String(configProvider.options.baseURL).replace(/\/+$/, "")

        if (providerID === "ollama") {
          const baseURL = configuredBaseURL.replace(/\/v1\/?$/, "").replace(/\/api\/?$/, "")
          const response = await fetch(`${baseURL}/api/tags`, {
            headers,
            signal: AbortSignal.timeout(3000),
          })
          if (!response.ok) continue
          const data = (await response.json()) as {
            models?: Array<{
              name?: string
              details?: { context_length?: number }
            }>
          }

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

          for (const apiModel of data.models ?? []) {
            const modelID = (apiModel.name ?? "").trim()
            if (!modelID) continue
            if (providers[providerID].models[modelID]) continue // Don't overwrite existing

            const contextLength =
              typeof apiModel.details?.context_length === "number" && apiModel.details.context_length > 0
                ? apiModel.details.context_length
                : 8192

            providers[providerID].models[modelID] = {
              id: modelID,
              name: modelID.split("/").pop() ?? modelID,
              providerID,
              api: {
                id: modelID,
                url: `${baseURL}/api`,
                npm: "@ai-sdk/ollama",
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
                context: contextLength,
                output: Math.min(contextLength, 4096),
              },
              options: {},
              release_date: "1970-01-01",
            }
          }

          log.info("auto-discovered models from local provider", {
            provider: providerID,
            count: Object.keys(providers[providerID].models).length,
          })
          continue
        }

        const baseURL = configuredBaseURL.replace(/\/v1\/?$/, "")
        const response = await fetch(`${baseURL}/v1/models`, {
          headers,
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
      if (providerID === "xai") {
        injectXaiGrok420FallbackModels(provider)
      }

      if (blocked.has(providerID)) {
        delete providers[providerID]
        continue
      }

      const configProvider = config.provider?.[providerID]

      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api.id = model.api.id ?? model.id ?? modelID
        if (RUNTIME_DISABLED_MODEL_NPMS.has(model.api.npm)) {
          log.debug("model filtered", {
            providerID,
            modelID,
            reason: `${model.api.npm} disabled for runtime`,
          })
          delete provider.models[modelID]
          continue
        }
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat")) {
          log.debug("model filtered", { providerID, modelID, reason: "gpt-5-chat exclusion" })
          delete provider.models[modelID]
        }
        if (model.status === "deprecated") {
          log.debug("model filtered", { providerID, modelID, reason: "deprecated status" })
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

      if (RUNTIME_DISABLED_MODEL_NPMS.has(model.api.npm)) {
        throw new Error(`${model.api.npm} is disabled for Zee LLM runtime`)
      }

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

  function normalizeRequestedModelID(providerID: string, modelID: string): string {
    void providerID
    return modelID
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

  export async function defaultModel() {
    const cfg = await Config.get()
    const configured = cfg.model ? parseModel(cfg.model) : undefined
    const rosettaDefault = await loadRosettaDefaultModel()

    const filteredProviders = await list()
      .then((val) => Object.values(val))
      .then((providers) => {
        if (!cfg.provider) return providers
        const configuredProviderIDs = new Set(Object.keys(cfg.provider))
        return providers.filter((provider) => configuredProviderIDs.has(provider.id))
      })

    const resolved = await resolveDefaultModel({
      configured,
      rosetta: rosettaDefault,
      providers: filteredProviders,
      sortModels: (models) => sort(models as Model[]).map((model) => ({ id: model.id, providerID: model.providerID })),
      isModelAvailable: async (target) => {
        try {
          await getModel(target.providerID, target.modelID)
          return true
        } catch {
          return false
        }
      },
    })

    if (resolved) return resolved

    if (filteredProviders.length === 0) throw new Error("no providers found")
    throw new Error("no models found")
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
