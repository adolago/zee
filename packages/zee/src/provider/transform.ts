import type { APICallError, ModelMessage } from "ai"
import { unique } from "remeda"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "./provider"
import type { ModelsDev } from "./models"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { THINKING_BUDGETS } from "./constants"

const log = Log.create({ service: "transform" })

/**
 * Get the actual provider npm package for filtering purposes.
 * When a model overrides api.npm, we still need to filter based on the
 * PROVIDER's actual backend, not the model's override.
 */
function getProviderNpm(model: Provider.Model): string {
  return model.api.npm
}

type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type ProviderOptions = NonNullable<ModelMessage["providerOptions"]>

function mergeProviderOptions(existing: ProviderOptions | undefined, extra: ProviderOptions): ProviderOptions {
  const merged: Record<string, unknown> = {
    ...((existing ?? {}) as Record<string, unknown>),
  }
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    const current = merged[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = { ...current, ...value }
    } else {
      merged[key] = value
    }
  }
  return merged as ProviderOptions
}

export namespace ProviderTransform {
  export const OUTPUT_TOKEN_MAX = Flag.ZEE_OUTPUT_TOKEN_MAX || 32_000

  // Maps npm package to the key the AI SDK expects for providerOptions
  function sdkKey(npm: string): string | undefined {
    switch (npm) {
      case "@ai-sdk/openai":
        return "openai"
      case "@ai-sdk/anthropic":
        return "anthropic"
      case "@openrouter/ai-sdk-provider":
        return "openrouter"
    }
    return undefined
  }

  function normalizeMessages(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    const isAnthropicSdk = model.api.npm === "@ai-sdk/anthropic"

    // Anthropic rejects messages with empty content - filter out empty string messages
    // and remove empty text/reasoning parts from array content
    if (isAnthropicSdk) {
      msgs = msgs
        .map((msg) => {
          if (typeof msg.content === "string") {
            if (msg.content === "") return undefined
            return msg
          }
          if (!Array.isArray(msg.content)) return msg
          const filtered = msg.content
            .map((part) => {
              if (part.type !== "tool-result") return part
              const result = part as typeof part & { content?: unknown }
              if (typeof result.content === "string" && result.content === "") {
                return { ...part, content: "(empty)" } as typeof part
              }
              if (Array.isArray(result.content) && result.content.length === 0) {
                return { ...part, content: [{ type: "text", text: "(empty)" }] } as typeof part
              }
              return part
            })
            .filter((part) => {
              if (part.type === "text" || part.type === "reasoning") {
                return part.text !== ""
              }
              return true
            })
          if (filtered.length === 0) return undefined
          return { ...msg, content: filtered }
        })
        .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
    }

    if (model.api.id.includes("claude")) {
      return msgs.map((msg) => {
        if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
          // Filter out approval parts and transform tool IDs
          msg.content = msg.content
            .filter((part) => part.type !== "tool-approval-request" && part.type !== "tool-approval-response")
            .map((part) => {
              if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
                return {
                  ...part,
                  toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
                }
              }
              return part
            }) as typeof msg.content
        }
        return msg
      })
    }
    const interleavedField =
      model.capabilities.interleaved && typeof model.capabilities.interleaved === "object"
        ? model.capabilities.interleaved.field
        : // Boolean true for @ai-sdk/openai-compatible defaults to "reasoning_content"
          // (the standard field for OpenAI-compatible providers like Kimi)
          model.capabilities.interleaved === true && model.api.npm === "@ai-sdk/openai-compatible"
          ? "reasoning_content"
          : null

    if (
      interleavedField === "reasoning" ||
      interleavedField === "reasoning_content" ||
      interleavedField === "reasoning_details"
    ) {
      return msgs.map((msg) => {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
          const reasoningText = reasoningParts.map((part: any) => part.text).join("")

          // Filter out reasoning parts from content
          const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

          // ALWAYS include interleaved reasoning field for ALL assistant messages when using
          // interleaved models, even if reasoning is empty. This is required by providers like
          // Kimi For Coding which expect reasoning_content on EVERY assistant message when
          // thinking is enabled, otherwise they return: "thinking is enabled but reasoning_content
          // is missing in assistant tool call message"
          const existingOptions = (msg.providerOptions as Record<string, unknown>)?.openaiCompatible
          return {
            ...msg,
            content: filteredContent,
            providerOptions: {
              ...msg.providerOptions,
              openaiCompatible: {
                ...(existingOptions && typeof existingOptions === "object" ? existingOptions : {}),
                [interleavedField]: reasoningText || "", // Include even when empty
              },
            },
          }
        }

        // String content assistant messages still need the interleaved field injected
        // (no reasoning to extract, but field must be present for providers like Kimi)
        if (msg.role === "assistant" && typeof msg.content === "string") {
          const existingOptions = (msg.providerOptions as Record<string, unknown>)?.openaiCompatible
          return {
            ...msg,
            providerOptions: {
              ...msg.providerOptions,
              openaiCompatible: {
                ...(existingOptions && typeof existingOptions === "object" ? existingOptions : {}),
                [interleavedField]: "",
              },
            },
          }
        }

        return msg
      })
    }

    // Catch-all: strip reasoning parts for providers that don't handle them natively.
    // - @ai-sdk/anthropic: handles reasoning parts natively (handled above)
    // - @ai-sdk/openai-compatible: SDK converts reasoning parts to
    //   reasoning_content field in the API request body -- leave them intact
    // - @openrouter/ai-sdk-provider and unknown provider SDKs may not understand
    //   reasoning parts and will error or silently drop them.
    const REASONING_AWARE_SDKS = new Set([
      "@ai-sdk/anthropic",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/xai",
    ])

    if (!REASONING_AWARE_SDKS.has(model.api.npm)) {
      return msgs.map((msg) => {
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg
        const hasReasoning = msg.content.some((part: any) => part.type === "reasoning")
        if (!hasReasoning) return msg
        return {
          ...msg,
          content: msg.content.filter((part: any) => part.type !== "reasoning"),
        }
      })
    }

    return msgs
  }

  function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)
    const isAnthropicSdk = model.api.npm === "@ai-sdk/anthropic"

    const providerOptions: ProviderOptions = {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
    }

    for (const msg of unique([...system, ...final])) {
      const useMessageLevelOptions = isAnthropicSdk
      const shouldUseContentOptions = !useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0

      if (shouldUseContentOptions) {
        const lastContent = msg.content[msg.content.length - 1]
        if (lastContent && typeof lastContent === "object" && "providerOptions" in lastContent) {
          const contentOptions = (lastContent as { providerOptions?: ProviderOptions }).providerOptions
          ;(lastContent as { providerOptions?: ProviderOptions }).providerOptions = mergeProviderOptions(
            contentOptions,
            providerOptions,
          )
          continue
        }
      }

      msg.providerOptions = mergeProviderOptions(msg.providerOptions, providerOptions)
    }

    return msgs
  }

  function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    return msgs.map((msg) => {
      if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

      const filtered = msg.content.map((part) => {
        if (part.type !== "file" && part.type !== "image") return part

        // Check for empty base64 image data
        if (part.type === "image") {
          const imageStr = part.image.toString()
          if (imageStr.startsWith("data:")) {
            const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
            if (match && (!match[2] || match[2].length === 0)) {
              return {
                type: "text" as const,
                text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
              }
            }
          }
        }

        const mime = part.type === "image" ? part.image.toString().split(";")[0].replace("data:", "") : part.mediaType
        const filename = part.type === "file" ? part.filename : undefined
        const modality = mimeToModality(mime)
        if (!modality) return part
        if (model.capabilities.input[modality]) return part

        const name = filename ? `"${filename}"` : modality
        return {
          type: "text" as const,
          text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
        }
      })

      return { ...msg, content: filtered }
    })
  }

  type ProviderOptionsHolder = { providerOptions?: Record<string, any> }

  export function message(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) {
    msgs = unsupportedParts(msgs, model)
    msgs = normalizeMessages(msgs, model)
    if (
      model.providerID === "anthropic" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.id.includes("anthropic") ||
      model.id.includes("claude") ||
      model.api.npm === "@ai-sdk/anthropic"
    ) {
      msgs = applyCaching(msgs, model)
    }

    // Remap providerOptions keys from stored providerID to expected SDK key
    const key = sdkKey(model.api.npm)
    if (key && key !== model.providerID) {
      const remap = (opts: Record<string, any> | undefined) => {
        if (!opts) return opts
        if (!(model.providerID in opts)) return opts
        const result = { ...opts }
        result[key] = result[model.providerID]
        delete result[model.providerID]
        return result
      }

      msgs = msgs.map((msg) => {
        const msgWithOptions = msg as ModelMessage & ProviderOptionsHolder
        if (!Array.isArray(msgWithOptions.content)) {
          return { ...msgWithOptions, providerOptions: remap(msgWithOptions.providerOptions) }
        }
        return {
          ...msgWithOptions,
          providerOptions: remap(msgWithOptions.providerOptions),
          content: msgWithOptions.content.map((part) => {
            const partWithOptions = part as typeof part & ProviderOptionsHolder
            const providerOptions = remap(partWithOptions.providerOptions)
            return providerOptions ? { ...partWithOptions, providerOptions } : part
          }),
        } as typeof msg
      })
    }

    return msgs
  }

  export function temperature(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("qwen")) return 0.55
    if (id.includes("claude")) return undefined
    if (id.includes("gemini")) return 1.0
    if (id.includes("glm-4.6")) return 1.0
    if (id.includes("glm-4.7")) return 1.0
    if (id.includes("minimax-m2")) return 1.0
    if (id.includes("kimi-k2")) {
      // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5
      if (id.includes("thinking") || id.includes("k2.") || id.includes("k2p")) {
        return 1.0
      }
      return 0.6
    }
    return undefined
  }

  export function topP(model: Provider.Model) {
    const id = model.id.toLowerCase()
    // Claude thinking models (extended thinking) require topP >= 0.95 OR unset
    // Return undefined to leave it unset and let Claude use its default
    if (id.includes("claude") && id.includes("thinking")) return undefined
    if (id.includes("qwen")) return 1
    if (id.includes("minimax-m2")) {
      return 0.95
    }
    if (id.includes("kimi-k2.5") || id.includes("kimi-k2p5")) return 0.95
    if (id.includes("gemini")) return 0.95
    return undefined
  }

  export function topK(model: Provider.Model) {
    const id = model.id.toLowerCase()
    if (id.includes("minimax-m2")) {
      if (id.includes("m2.1")) return 40
      return 20
    }
    if (id.includes("gemini")) return 64
    return undefined
  }

  const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
  const XAI_CHAT_EFFORTS = ["low", "high"]
  const XAI_MULTI_AGENT_EFFORTS = [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
  const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

  export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()

    // GLM models only support variants when using Z.AI/ZhipuAI.
    if (id.includes("glm") && !model.providerID.includes("zai")) {
      return {}
    }

    // see: https://docs.x.ai/docs/guides/reasoning#control-how-hard-the-model-thinks
    // grok-3-mini only supports low/high
    if (id.includes("grok-3-mini")) {
      if (model.api.npm === "@openrouter/ai-sdk-provider") {
        return {
          low: { reasoning: { effort: "low" } },
          high: { reasoning: { effort: "high" } },
        }
      }
      return {
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
      }
    }

    switch (model.api.npm) {
      case "@openrouter/ai-sdk-provider":
        if (!model.id.includes("gpt") && !model.id.includes("gemini-3")) return {}
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))

      case "@ai-sdk/openai-compatible":
        if (model.providerID.includes("zai")) {
          return {
            low: {
              thinking: {
                type: "enabled",
                budget_tokens: THINKING_BUDGETS.low,
                clear_thinking: false,
              },
            },
            medium: {
              thinking: {
                type: "enabled",
                budget_tokens: THINKING_BUDGETS.medium,
                clear_thinking: false,
              },
            },
            high: {
              thinking: {
                type: "enabled",
                budget_tokens: THINKING_BUDGETS.high,
                clear_thinking: false,
              },
            },
            max: {
              thinking: {
                type: "enabled",
                budget_tokens: THINKING_BUDGETS.max,
                clear_thinking: false,
              },
            },
          }
        }
        // Kimi For Coding: Free tier models don't support thinking budget parameters.
        // Reasoning is controlled by using the "-thinking" model variant (e.g., kimi-k2.5-thinking).
        // Return empty variants to avoid sending unsupported parameters.
        if (model.providerID === "kimi-for-coding") {
          return {}
        }
        if (model.providerID === "minimax") {
          return {}
        }
        // xAI OpenAI-compatible endpoint only supports reasoning_effort on grok-3-mini.
        // Grok 4.20 multi-agent beta also supports low/medium/high/xhigh.
        if (model.providerID === "xai" || model.providerID === "x-ai") {
          if (id.includes("grok-4.20-multi-agent-experimental-beta-0304")) {
            return Object.fromEntries(XAI_MULTI_AGENT_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
          }
          if (id.includes("grok-3-mini")) {
            return {
              low: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
            }
          }
          return {}
        }
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/xai":
        // xAI native SDK: grok-3-mini supports low/high and grok-4.20 multi-agent beta
        // supports low/medium/high/xhigh.
        if (id.includes("grok-4.20-multi-agent-experimental-beta-0304")) {
          return Object.fromEntries(XAI_MULTI_AGENT_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
        }
        if (!id.includes("grok-3-mini")) return {}
        return Object.fromEntries(XAI_CHAT_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/openai":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/openai
        if (id === "gpt-5-pro") return {}
        if (model.api.id === "gpt-5.4-pro") {
          const proEfforts = ["medium", "high", "xhigh"]
          return Object.fromEntries(
            proEfforts.map((effort) => [
              effort,
              {
                reasoningEffort: effort,
                reasoningSummary: "auto",
                include: ["reasoning.encrypted_content"],
              },
            ]),
          )
        }
        const openaiEfforts = iife(() => {
          if (id.includes("codex")) {
            const codexEfforts = [...WIDELY_SUPPORTED_EFFORTS]
            // OpenAI Codex reasoning uses the four effort levels: low, medium, high, xhigh.
            // xhigh is supported by the newer Codex line (for example GPT-5.2+ Codex).
            if (id.includes("codex-max") || model.release_date >= "2025-12-04") {
              codexEfforts.push("xhigh")
            }
            return codexEfforts
          }
          const arr = [...WIDELY_SUPPORTED_EFFORTS]
          if (id.includes("gpt-5-") || id === "gpt-5") {
            arr.unshift("minimal")
          }
          if (model.release_date >= "2025-11-13") {
            arr.unshift("none")
          }
          if (model.release_date >= "2025-12-04") {
            arr.push("xhigh")
          }
          return arr
        })
        return Object.fromEntries(
          openaiEfforts.map((effort) => [
            effort,
            {
              reasoningEffort: effort,
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          ]),
        )

      case "@ai-sdk/anthropic":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/anthropic
        return {
          low: {
            thinking: {
              type: "enabled",
              budgetTokens: THINKING_BUDGETS.low,
            },
          },
          medium: {
            thinking: {
              type: "enabled",
              budgetTokens: THINKING_BUDGETS.medium,
            },
          },
          high: {
            thinking: {
              type: "enabled",
              budgetTokens: THINKING_BUDGETS.high,
            },
          },
          max: {
            thinking: {
              type: "enabled",
              budgetTokens: THINKING_BUDGETS.max,
            },
          },
        }

      case "@ai-sdk/google":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
        if (id.includes("2.5")) {
          return {
            low: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: THINKING_BUDGETS.low,
              },
            },
            medium: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: THINKING_BUDGETS.medium,
              },
            },
            high: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: THINKING_BUDGETS.high,
              },
            },
            max: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingBudget: THINKING_BUDGETS.max,
              },
            },
          }
        }
        if (id.includes("gemini-3-flash")) {
          return Object.fromEntries(
            ["minimal", "low", "medium", "high"].map((effort) => [
              effort,
              {
                thinkingConfig: {
                  includeThoughts: true,
                  thinkingLevel: effort,
                },
              },
            ]),
          )
        }
        return Object.fromEntries(
          ["low", "high"].map((effort) => [
            effort,
            {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: effort,
              },
            },
          ]),
        )
    }
    return {}
  }

  export function options(input: {
    model: Provider.Model
    sessionID: string
    providerOptions?: Record<string, any>
  }): Record<string, any> {
    const result: Record<string, any> = {}
    const cacheKey = input.sessionID

    // openai and providers using openai package should set store to false by default.
    if (input.model.providerID === "openai" || input.model.api.npm === "@ai-sdk/openai") {
      result["store"] = false
    }

    if (input.model.api.npm === "@openrouter/ai-sdk-provider") {
      result["usage"] = {
        include: true,
      }
      if (input.model.api.id.includes("gemini-3")) {
        result["reasoning"] = { effort: "high" }
      }
    }

    // Enable thinking mode for Z.AI/ZhipuAI models
    // Use .includes() to match provider IDs like "zai-coding-plan"
    if (
      (input.model.providerID.includes("zai") || input.model.providerID === "zhipuai") &&
      input.model.api.npm === "@ai-sdk/openai-compatible"
    ) {
      result["thinking"] = {
        type: "enabled",
        clear_thinking: false,
      }
    }

    if (input.model.providerID === "openai" || input.providerOptions?.setCacheKey) {
      result["promptCacheKey"] = cacheKey
    }

    if (input.model.api.npm === "@ai-sdk/google") {
      result["thinkingConfig"] = {
        includeThoughts: true,
      }
      if (input.model.api.id.includes("gemini-3")) {
        result["thinkingConfig"]["thinkingLevel"] = "high"
      }
    }

    if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
      if (input.model.providerID.includes("codex")) {
        result["store"] = false
      }

      if (!input.model.api.id.includes("codex") && !input.model.api.id.includes("gpt-5-pro")) {
        result["reasoningEffort"] = "medium"
      }

      // Only set textVerbosity for non-chat gpt-5.x models
      // Chat models (e.g. gpt-5.2-chat-latest) only support "medium" verbosity
      if (
        input.model.api.id.includes("gpt-5.") &&
        !input.model.api.id.includes("codex") &&
        !input.model.api.id.includes("-chat")
      ) {
        result["textVerbosity"] = "low"
      }

      // GPT-5 specific params for native OpenAI SDK only
      // These params are NOT supported by @ai-sdk/openai-compatible
      // and cause "Bad Request" errors if sent to openai-compatible backends
      if (input.model.providerID === "openai" && input.model.api.npm === "@ai-sdk/openai") {
        result["promptCacheKey"] = cacheKey
        result["include"] = ["reasoning.encrypted_content"]
        result["reasoningSummary"] = "auto"
      }
    }

    return result
  }

  export function smallOptions(model: Provider.Model) {
    if (
      model.providerID === "openai" ||
      model.api.npm === "@ai-sdk/openai" ||
      model.api.npm === "@ai-sdk/github-copilot"
    ) {
      if (model.api.id.includes("gpt-5")) {
        if (model.api.id.includes("5.")) {
          return { store: false, reasoningEffort: "low" }
        }
        return { store: false, reasoningEffort: "minimal" }
      }
      return { store: false }
    }
    if (model.providerID === "openrouter") {
      if (model.api.id.includes("google")) {
        return { reasoning: { enabled: false } }
      }
      return { reasoningEffort: "minimal" }
    }
    return {}
  }

  // Properties that should NOT be sent to provider APIs
  // These are zee metadata fields that may slip through
  const NON_PROVIDER_OPTIONS = new Set([
    "theme",
    "skill",
    "includes",
    "native",
    "hidden",
    "mode",
    "description",
    "color",
    "name",
    "systemPromptAdditions",
    "knowledge",
    "mcpServers",
    "permission",
    // Fallback config should never be sent to provider APIs
    "fallback",
    "fallbacks",
  ])

  /**
   * Provider SDK supported parameters.
   * Maps npm package name to the set of request body parameters that provider accepts.
   * Parameters not in this list will be filtered out before sending to the provider API.
   *
   * NOTE: This is a critical defense mechanism against API errors from unsupported params.
   * When adding new providers or parameters, verify against the provider's API documentation.
   *
   * Provider Parameter Reference:
   * - Anthropic: https://docs.anthropic.com/en/api/messages
   * - OpenAI: https://platform.openai.com/docs/api-reference/chat/create
   * - xAI: https://docs.x.ai/api
   * - OpenRouter: https://openrouter.ai/docs/parameters
   */
  const PROVIDER_SUPPORTED_PARAMS: Record<string, Set<string> | null> = {
    // ═══════════════════════════════════════════════════════════════════════
    // ANTHROPIC (Claude models)
    // ═══════════════════════════════════════════════════════════════════════
    "@ai-sdk/anthropic": new Set([
      // Thinking/reasoning
      "thinking", // { type: "enabled", budgetTokens: number }

      // Caching
      "cacheControl", // Enable prompt caching
      "promptCacheKey", // Custom cache key

      // Beta features
      "betas", // Array of beta feature flags

      // Request customization
      "headers", // Custom HTTP headers
    ]),

    // ═══════════════════════════════════════════════════════════════════════
    // OPENROUTER (explicitly retained router)
    // ═══════════════════════════════════════════════════════════════════════
    "@openrouter/ai-sdk-provider": new Set([
      "usage",
      "reasoning",
      "reasoningEffort",
      "provider",
      "transforms",
      "route",
    ]),

    // ═══════════════════════════════════════════════════════════════════════
    // OPENAI (GPT-4, o1, o3-mini models)
    // ═══════════════════════════════════════════════════════════════════════
    "@ai-sdk/openai": new Set([
      // Reasoning (o1, o3-mini)
      "reasoningEffort", // model-dependent (e.g., none|minimal|low|medium|high|xhigh)
      "reasoningSummary", // Include reasoning summary in response

      // Response content
      "include", // Array of additional response fields

      // Caching
      "promptCacheKey", // Custom cache key

      // Service configuration
      "serviceTier", // "auto" | "default" | "flex"
      "store", // Store conversation for fine-tuning

      // Tool calling
      "parallelToolCalls", // Allow parallel tool execution

      // User identification
      "user", // User ID for abuse detection

      // Output control
      "structuredOutputs", // Enable structured JSON outputs
      "logprobs", // Return log probabilities
      "topLogprobs", // Number of top logprobs to return

      // Sampling
      "seed", // Deterministic sampling
      "frequencyPenalty", // -2.0 to 2.0
      "presencePenalty", // -2.0 to 2.0
      "stop", // Stop sequences

      // Codex API (ChatGPT Pro/Plus OAuth)
      "instructions", // System instructions for Codex models
    ]),

    // ═══════════════════════════════════════════════════════════════════════
    // Z.AI / ZHIPUAI (GLM models via OpenAI-compatible API)
    // Uses @ai-sdk/openai-compatible but with specific param support
    // ═══════════════════════════════════════════════════════════════════════
    // Note: Z.AI is handled via openai-compatible, but we add thinking support
    // in the transform.ts options() function for zai/zhipuai providers

    // ═══════════════════════════════════════════════════════════════════════
    // OPENAI-COMPATIBLE (DeepSeek, Kimi, Z.AI, MiniMax coding plan)
    // ═══════════════════════════════════════════════════════════════════════
    "@ai-sdk/openai-compatible": new Set([
      // Thinking (DeepSeek R1, Qwen, etc.)
      "thinking", // Some compatible providers support this

      // Reasoning
      "reasoningEffort", // Pass through if backend supports

      // Template customization (local models)
      "chat_template_args", // Custom template arguments

      // Common OpenAI params that many providers accept
      "user",
      "seed",
      "stop",
    ]),

    // null = allow all params (fallback for unknown providers)
    // This ensures forward compatibility with new providers
  }

  /**
   * Filter options based on provider's supported parameters.
   * Returns a new object with only the supported parameters.
   */
  function filterProviderParams(npm: string, options: Record<string, any>): Record<string, any> {
    const supported = PROVIDER_SUPPORTED_PARAMS[npm]

    // If provider not in map or null, allow all params (backward compatible)
    if (supported === undefined || supported === null) {
      return options
    }

    const filtered: Record<string, any> = {}
    const removed: string[] = []

    for (const [key, value] of Object.entries(options)) {
      if (supported.has(key)) {
        filtered[key] = value
      } else if (value !== undefined) {
        removed.push(key)
      }
    }

    if (removed.length > 0) {
      log.info("filtered unsupported provider params", {
        npm,
        removed,
        hint: "These parameters are not supported by this provider SDK",
      })
    }

    return filtered
  }

  /**
   * Sanitize options by removing non-provider fields.
   * This is a defense-in-depth measure to prevent agent metadata from being sent to provider APIs.
   */
  function sanitizeOptions(options: { [x: string]: any }): { [x: string]: any } {
    const sanitized: { [x: string]: any } = {}
    const filtered: string[] = []
    for (const [key, value] of Object.entries(options)) {
      if (!NON_PROVIDER_OPTIONS.has(key) && value !== undefined) {
        sanitized[key] = value
      } else if (NON_PROVIDER_OPTIONS.has(key) && value !== undefined) {
        filtered.push(key)
      }
    }
    if (filtered.length > 0) {
      log.debug("filtered non-provider options", { filtered })
    }
    return sanitized
  }

  export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
    // First sanitize to remove zee metadata fields
    const sanitized = sanitizeOptions(options)
    // Then filter to only include params supported by this provider SDK
    // Use getProviderNpm() to get the ACTUAL provider backend, not model overrides
    let filtered = filterProviderParams(getProviderNpm(model), sanitized)

    // Kimi For Coding: Free tier doesn't support thinking budget or reasoning effort.
    // Reasoning is controlled by using the "-thinking" model variant.
    if (model.providerID === "kimi-for-coding") {
      const { thinking, reasoningEffort, reasoning_effort, thinkingBudget, ...rest } = filtered
      if (thinking || reasoningEffort || reasoning_effort || thinkingBudget) {
        log.info("filtered unsupported Kimi params", {
          model: model.id,
          hint: "Kimi free tier doesn't support thinking budget. Use kimi-k2.5-thinking model for reasoning.",
        })
      }
      filtered = rest
    }

    const key = sdkKey(model.api.npm) ?? model.providerID
    return { [key]: filtered }
  }

  /** Model-level max output tokens, capped at OUTPUT_TOKEN_MAX. Used for compaction reserve. */
  export function maxOutputTokens(model: Provider.Model): number
  /** Stream-level max output tokens with thinking budget and reasoning effort awareness. */
  export function maxOutputTokens(
    npm: string,
    options: Record<string, any>,
    modelLimit: number,
    globalLimit: number,
  ): number | undefined
  export function maxOutputTokens(
    npmOrModel: string | Provider.Model,
    options?: Record<string, any>,
    modelLimit?: number,
    globalLimit?: number,
  ): number | undefined {
    // Simplified model-level calculation for compaction reserve
    if (typeof npmOrModel !== "string") {
      return Math.min(npmOrModel.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX
    }

    const npm = npmOrModel
    const modelCap = (modelLimit || globalLimit)!
    const standardLimit = Math.min(modelCap, globalLimit!)

    // Validate thinking budget + max_tokens exclusivity
    // Some providers/models cannot have both set simultaneously
    const hasReasoningEffort = options?.["reasoningEffort"] || options?.["reasoning"]?.["effort"]
    const hasThinkingBudget = options?.["thinking"]?.["budgetTokens"] || options?.["thinkingBudget"]

    // OpenAI o-series, xAI: reasoningEffort is mutually exclusive with max_tokens
    if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/xai") {
      if (hasReasoningEffort) {
        log.debug("max_tokens disabled due to reasoningEffort", {
          npm,
          reasoningEffort: options?.["reasoningEffort"] ?? options?.["reasoning"]?.["effort"],
        })
        return undefined // Cannot set max_tokens when reasoning_effort is set
      }
    }

    if (npm === "@ai-sdk/anthropic") {
      const thinking = options?.["thinking"]
      const budgetTokens = typeof thinking?.["budgetTokens"] === "number" ? thinking["budgetTokens"] : 0
      const enabled = thinking?.["type"] === "enabled"
      if (enabled && budgetTokens > 0) {
        // Return text tokens so that text + thinking <= model cap, preferring 32k text when possible.
        if (budgetTokens + standardLimit <= modelCap) {
          return standardLimit
        }
        const adjustedMax = Math.max(1, modelCap - budgetTokens)
        log.debug("adjusting max_tokens for thinking budget", {
          budgetTokens,
          modelCap,
          adjustedMax,
        })
        return adjustedMax
      }
    }

    return standardLimit
  }

  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
    // Convert integer enums to string enums for Gemini-family APIs.
    if (model.api.id.includes("gemini")) {
      const sanitizeGemini = (obj: any): any => {
        if (obj === null || typeof obj !== "object") {
          return obj
        }

        if (Array.isArray(obj)) {
          return obj.map(sanitizeGemini)
        }

        const result: any = {}
        for (const [key, value] of Object.entries(obj)) {
          if (key === "enum" && Array.isArray(value)) {
            // Convert all enum values to strings
            result[key] = value.map((v) => String(v))
            // If we have integer type with enum, change type to string
            if (result.type === "integer" || result.type === "number") {
              result.type = "string"
            }
          } else if (typeof value === "object" && value !== null) {
            result[key] = sanitizeGemini(value)
          } else {
            result[key] = value
          }
        }

        // Filter required array to only include fields that exist in properties
        if (result.type === "object" && result.properties && Array.isArray(result.required)) {
          result.required = result.required.filter((field: any) => field in result.properties)
        }

        if (result.type === "array") {
          if (result.items == null) {
            result.items = {}
          }
          // Ensure items has at least a type if it's an empty object
          // This handles nested arrays like { type: "array", items: { type: "array", items: {} } }
          if (typeof result.items === "object" && !Array.isArray(result.items) && !result.items.type) {
            result.items.type = "string"
          }
        }

        // Remove properties/required from non-object types (Gemini rejects these)
        if (result.type && result.type !== "object") {
          delete result.properties
          delete result.required
        }

        return result
      }

      schema = sanitizeGemini(schema)
    }

    return schema as JSONSchema7
  }

  export function error(providerID: string, error: APICallError) {
    return error.message
  }
}
