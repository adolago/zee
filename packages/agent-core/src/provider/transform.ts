import type { APICallError, ModelMessage } from "ai"
import { unique } from "remeda"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "./provider"
import type { ModelsDev } from "./models"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
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

function mergeProviderOptions(
  existing: ProviderOptions | undefined,
  extra: ProviderOptions,
): ProviderOptions {
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
  // Maps npm package to the key the AI SDK expects for providerOptions
  function sdkKey(npm: string): string | undefined {
    switch (npm) {
      case "@ai-sdk/openai":
        return "openai"
      case "@ai-sdk/anthropic":
        return "anthropic"
      case "@ai-sdk/google":
        return "google"
      case "@openrouter/ai-sdk-provider":
        return "openrouter"
    }
    return undefined
  }

  function normalizeMessages(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    // Anthropic rejects messages with empty content - filter out empty string messages
    // and remove empty text/reasoning parts from array content
    if (model.api.npm === "@ai-sdk/anthropic") {
      msgs = msgs
        .map((msg) => {
          if (typeof msg.content === "string") {
            if (msg.content === "") return undefined
            return msg
          }
          if (!Array.isArray(msg.content)) return msg
          const filtered = msg.content.filter((part) => {
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
        : null

    if (interleavedField === "reasoning" || interleavedField === "reasoning_content" || interleavedField === "reasoning_details") {
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

        return msg
      })
    }

    return msgs
  }

  function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

    const providerOptions: ProviderOptions = {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
      bedrock: {
        cachePoint: { type: "default" },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
    }

    for (const msg of unique([...system, ...final])) {
      const useMessageLevelOptions = providerID === "anthropic" || providerID.includes("bedrock")
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
      msgs = applyCaching(msgs, model.providerID)
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
  const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

  export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    if (!model.capabilities.reasoning) return {}

    const id = model.id.toLowerCase()

    // GLM models only support variants when using Z.AI/ZhipuAI
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
        return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))

      case "@ai-sdk/gateway":
        return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/cerebras":
      case "@ai-sdk/togetherai":
      case "@ai-sdk/xai":
      case "@ai-sdk/deepinfra":
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
        return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

      case "@ai-sdk/azure": {
        if (id === "o1-mini") return {}
        const azureEfforts = ["low", "medium", "high"]
        if (id.includes("gpt-5-") || id === "gpt-5") {
          azureEfforts.unshift("minimal")
        }
        return Object.fromEntries(
          azureEfforts.map((effort) => [
            effort,
            {
              reasoningEffort: effort,
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          ]),
        )
      }

      case "@ai-sdk/openai":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/openai
        if (id === "gpt-5-pro") return {}
        const openaiEfforts = iife(() => {
          if (id.includes("codex")) {
            if (id.includes("5.2")) return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
            return WIDELY_SUPPORTED_EFFORTS
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
      case "@ai-sdk/google-vertex/anthropic":
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

      case "@ai-sdk/amazon-bedrock":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock
        if (model.api.id.includes("anthropic")) {
          return {
            low: {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: THINKING_BUDGETS.low,
              },
            },
            medium: {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: THINKING_BUDGETS.medium,
              },
            },
            high: {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: THINKING_BUDGETS.high,
              },
            },
            max: {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: THINKING_BUDGETS.max,
              },
            },
          }
        }
        return Object.fromEntries(
          WIDELY_SUPPORTED_EFFORTS.map((effort) => [
            effort,
            {
              reasoningConfig: {
                type: "enabled",
                maxReasoningEffort: effort,
              },
            },
          ]),
        )

      case "@ai-sdk/google-vertex":
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
        return Object.fromEntries(
          ["low", "high"].map((effort) => [
            effort,
            {
              includeThoughts: true,
              thinkingLevel: effort,
            },
          ]),
        )

      case "@ai-sdk/mistral":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/mistral
        return {}

      case "@ai-sdk/cohere":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/cohere
        return {}

      case "@ai-sdk/groq": {
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/groq
        const groqEffort = ["none", ...WIDELY_SUPPORTED_EFFORTS]
        return Object.fromEntries(
          groqEffort.map((effort) => [
            effort,
            {
              includeThoughts: true,
              thinkingLevel: effort,
            },
          ]),
        )
      }

      case "@ai-sdk/perplexity":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/perplexity
        return {}

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

    // Enable thinking mode for Baseten models - use chat_template_args
    if (input.model.providerID === "baseten") {
      result["chat_template_args"] = { enable_thinking: true }
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

    if (input.model.api.npm === "@ai-sdk/google" || input.model.api.npm === "@ai-sdk/google-vertex") {
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

      if (input.model.api.id.includes("gpt-5.") && input.model.providerID !== "azure") {
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

    if (input.model.providerID === "venice") {
      result["promptCacheKey"] = cacheKey
    }
    return result
  }

  export function smallOptions(model: Provider.Model) {
    if (model.providerID === "openai" || model.api.id.includes("gpt-5")) {
      if (model.api.id.includes("5.")) {
        return { reasoningEffort: "low" }
      }
      return { reasoningEffort: "minimal" }
    }
    if (model.providerID === "google" || model.providerID === "google-antigravity") {
      // gemini-3 uses thinkingLevel, gemini-2.5 uses thinkingBudget
      if (model.api.id.includes("gemini-3")) {
        return { thinkingConfig: { thinkingLevel: "minimal" } }
      }
      return { thinkingConfig: { thinkingBudget: 0 } }
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
  // These are agent-core metadata fields that may slip through
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
   * - Google: https://ai.google.dev/api/rest/v1beta/models/generateContent
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
    // OPENAI (GPT-4, o1, o3-mini models)
    // ═══════════════════════════════════════════════════════════════════════
    "@ai-sdk/openai": new Set([
      // Reasoning (o1, o3-mini)
      "reasoningEffort", // "low" | "medium" | "high"
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
    // GOOGLE AI (Gemini via ai.google.dev)
    // ═══════════════════════════════════════════════════════════════════════
    "@ai-sdk/google": new Set([
      // Thinking/reasoning (Gemini 2.0+ with thinking)
      "thinkingConfig", // { thinkingBudget: number }
      "thinkingLevel", // "none" | "low" | "medium" | "high"
      "thinkingBudget", // Direct budget number

      // Safety
      "safetySettings", // Array of safety category settings

      // Caching
      "cachedContent", // Cache name for context caching

      // Output
      "structuredOutputs", // Enable structured JSON outputs

      // Search grounding (Gemini 2.0+)
      "useSearchGrounding", // Enable Google Search grounding

      // Response modalities
      "responseModalities", // ["text"] | ["audio"] | ["text", "audio"]

      // Speech config
      "speechConfig", // { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } }
    ]),

    // ═══════════════════════════════════════════════════════════════════════
    // OPENROUTER (Multi-provider gateway)
    // ═══════════════════════════════════════════════════════════════════════
    "@openrouter/ai-sdk-provider": new Set([
      // Usage tracking
      "usage", // Include token usage in response

      // Reasoning (passed to underlying provider)
      "reasoning", // Enable reasoning mode
      "reasoningEffort", // Passed to underlying model if supported

      // Provider routing
      "provider", // { order: string[], allow_fallbacks: boolean }

      // Transforms
      "transforms", // ["middle-out"] for prompt compression

      // Model routing
      "route", // "fallback" for automatic fallback routing
    ]),

    // ═══════════════════════════════════════════════════════════════════════
    // Z.AI / ZHIPUAI (GLM models via OpenAI-compatible API)
    // Uses @ai-sdk/openai-compatible but with specific param support
    // ═══════════════════════════════════════════════════════════════════════
    // Note: Z.AI is handled via openai-compatible, but we add thinking support
    // in the transform.ts options() function for zai/zhipuai providers

    // ═══════════════════════════════════════════════════════════════════════
    // OPENAI-COMPATIBLE (Generic - Ollama, LM Studio, etc.)
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
  function filterProviderParams(
    npm: string,
    options: Record<string, any>,
  ): Record<string, any> {
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
    // First sanitize to remove agent-core metadata fields
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

  export function maxOutputTokens(
    npm: string,
    options: Record<string, any>,
    modelLimit: number,
    globalLimit: number,
  ): number | undefined {
    const modelCap = modelLimit || globalLimit
    const standardLimit = Math.min(modelCap, globalLimit)

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

    if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
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

  export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema) {
    /*
    if (["openai", "azure"].includes(providerID)) {
      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (schema.required?.includes(key)) continue
          schema.properties[key] = {
            anyOf: [
              value as JSONSchema.JSONSchema,
              {
                type: "null",
              },
            ],
          }
        }
      }
    }
    */

    // Convert integer enums to string enums for Google/Gemini
    if (model.providerID === "google" || model.providerID === "google-antigravity" || model.api.id.includes("gemini")) {
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

        if (result.type === "array" && result.items == null) {
          result.items = {}
        }

        return result
      }

      schema = sanitizeGemini(schema)
    }

    return schema
  }

  export function error(providerID: string, error: APICallError) {
    return error.message
  }
}
