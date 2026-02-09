/**
 * Mock LLM Provider for testing
 *
 * Provides mock responses for LLM API calls to enable testing without
 * real API credentials or network access.
 */

// Define types inline as the AI SDK doesn't export these anymore
interface LanguageModelV2StreamPart {
  type: "text-delta" | "tool-call" | "finish" | "error"
  textDelta?: string
  toolCallId?: string
  toolName?: string
  args?: string
  finishReason?: "stop" | "tool-calls" | "length" | "content-filter" | "error"
  usage?: { promptTokens: number; completionTokens: number }
  error?: Error
}

interface LanguageModelV2Prompt {
  role: "user" | "assistant" | "system" | "tool"
  content: Array<{ type: string; text?: string }>
}

interface LanguageModelV2Options {
  prompt: LanguageModelV2Prompt[]
}

interface LanguageModelV2 {
  specificationVersion: string
  provider: string
  modelId: string
  defaultObjectGenerationMode: string
  doGenerate(options: LanguageModelV2Options): Promise<{
    text?: string
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>
    finishReason: string
    usage: { promptTokens: number; completionTokens: number }
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> }
    warnings: unknown[]
  }>
  doStream(options: LanguageModelV2Options): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> }
    warnings: unknown[]
  }>
}

export interface MockResponse {
  text?: string
  toolCalls?: Array<{
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason?: "stop" | "tool-calls" | "length" | "content-filter" | "error"
}

export interface MockProviderOptions {
  /** Pre-configured responses for specific prompts (matched by substring) */
  responses?: Map<string, MockResponse>
  /** Default response when no match found */
  defaultResponse?: MockResponse
  /** Artificial delay in ms */
  delay?: number
  /** Simulate errors */
  errorRate?: number
  /** Error to throw when errorRate triggers */
  errorType?: "network" | "auth" | "rate-limit" | "server"
}

const DEFAULT_RESPONSE: MockResponse = {
  text: "This is a mock response from the test LLM provider.",
  usage: {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  },
  finishReason: "stop",
}

export function createMockProvider(options: MockProviderOptions = {}): LanguageModelV2 {
  const {
    responses = new Map(),
    defaultResponse = DEFAULT_RESPONSE,
    delay = 0,
    errorRate = 0,
    errorType = "server",
  } = options

  function getResponseForPrompt(prompt: string): MockResponse {
    for (const [key, response] of responses) {
      if (prompt.includes(key)) {
        return response
      }
    }
    return defaultResponse
  }

  function maybeThrowError() {
    if (errorRate > 0 && Math.random() < errorRate) {
      switch (errorType) {
        case "network":
          throw new Error("Network error: Connection refused")
        case "auth":
          throw new Error("Authentication failed: Invalid API key")
        case "rate-limit":
          throw new Error("Rate limit exceeded: Too many requests")
        case "server":
        default:
          throw new Error("Server error: Internal server error")
      }
    }
  }

  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json",

    async doGenerate(options) {
      maybeThrowError()

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      const promptText = options.prompt
        .map((p) => {
          if (p.role === "user") {
            return p.content.map((c) => (c.type === "text" ? c.text : "")).join("")
          }
          return ""
        })
        .join("\n")

      const response = getResponseForPrompt(promptText)

      return {
        text: response.text,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason || "stop",
        usage: {
          promptTokens: response.usage?.promptTokens ?? 10,
          completionTokens: response.usage?.completionTokens ?? 20,
        },
        rawCall: {
          rawPrompt: null,
          rawSettings: {},
        },
        warnings: [],
      }
    },

    async doStream(options) {
      maybeThrowError()

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      const promptText = options.prompt
        .map((p) => {
          if (p.role === "user") {
            return p.content.map((c) => (c.type === "text" ? c.text : "")).join("")
          }
          return ""
        })
        .join("\n")

      const response = getResponseForPrompt(promptText)

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          // Emit text chunks
          if (response.text) {
            const words = response.text.split(" ")
            for (const word of words) {
              controller.enqueue({
                type: "text-delta",
                textDelta: word + " ",
              })
            }
          }

          // Emit tool calls
          if (response.toolCalls) {
            for (const tc of response.toolCalls) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: JSON.stringify(tc.args),
              })
            }
          }

          // Emit finish
          controller.enqueue({
            type: "finish",
            finishReason: response.finishReason || "stop",
            usage: {
              promptTokens: response.usage?.promptTokens ?? 10,
              completionTokens: response.usage?.completionTokens ?? 20,
            },
          })

          controller.close()
        },
      })

      return {
        stream,
        rawCall: {
          rawPrompt: null,
          rawSettings: {},
        },
        warnings: [],
      }
    },
  }
}

/**
 * Create a mock provider that tracks all calls for assertions
 */
export function createTrackingMockProvider(options: MockProviderOptions = {}) {
  const calls: Array<{
    method: "doGenerate" | "doStream"
    prompt: string
    timestamp: number
  }> = []

  const provider = createMockProvider(options)

  const originalDoGenerate = provider.doGenerate.bind(provider)
  const originalDoStream = provider.doStream.bind(provider)

  provider.doGenerate = async (opts) => {
    const promptText = opts.prompt
      .map((p) => (p.role === "user" ? p.content.map((c) => (c.type === "text" ? c.text : "")).join("") : ""))
      .join("\n")

    calls.push({
      method: "doGenerate",
      prompt: promptText,
      timestamp: Date.now(),
    })

    return originalDoGenerate(opts)
  }

  provider.doStream = async (opts) => {
    const promptText = opts.prompt
      .map((p) => (p.role === "user" ? p.content.map((c) => (c.type === "text" ? c.text : "")).join("") : ""))
      .join("\n")

    calls.push({
      method: "doStream",
      prompt: promptText,
      timestamp: Date.now(),
    })

    return originalDoStream(opts)
  }

  return {
    provider,
    getCalls: () => [...calls],
    clearCalls: () => {
      calls.length = 0
    },
    getLastCall: () => calls[calls.length - 1],
  }
}

/**
 * Extended mock provider options for advanced simulation scenarios
 */
export interface ExtendedMockProviderOptions extends MockProviderOptions {
  /** Delay between each streamed chunk in ms (simulates slow network) */
  chunkDelay?: number
  /** Simulate stall after N chunks (for testing stall detection) */
  stallAfterChunks?: number
  /** Duration of simulated stall in ms */
  stallDurationMs?: number
  /** Simulate partial response (stream stops early) */
  truncateAfterChunks?: number
  /** Add reasoning/thinking content before text */
  reasoning?: string
  /** Model ID to report */
  modelId?: string
  /** Provider name to report */
  providerName?: string
}

/**
 * Create an advanced mock provider with extended simulation capabilities
 *
 * Supports:
 * - Chunk-by-chunk streaming delays
 * - Simulated stalls (for testing stall detection)
 * - Truncated responses
 * - Reasoning/thinking content
 */
export function createAdvancedMockProvider(options: ExtendedMockProviderOptions = {}): LanguageModelV2 {
  const {
    responses = new Map(),
    defaultResponse = DEFAULT_RESPONSE,
    delay = 0,
    chunkDelay = 0,
    stallAfterChunks,
    stallDurationMs = 5000,
    truncateAfterChunks,
    reasoning,
    errorRate = 0,
    errorType = "server",
    modelId = "advanced-mock-model",
    providerName = "advanced-mock",
  } = options

  function getResponseForPrompt(prompt: string): MockResponse {
    for (const [key, response] of responses) {
      if (prompt.includes(key)) {
        return response
      }
    }
    return defaultResponse
  }

  function maybeThrowError() {
    if (errorRate > 0 && Math.random() < errorRate) {
      switch (errorType) {
        case "network":
          throw new Error("Network error: Connection refused")
        case "auth":
          throw new Error("Authentication failed: Invalid API key")
        case "rate-limit":
          throw new Error("Rate limit exceeded: Too many requests")
        case "server":
        default:
          throw new Error("Server error: Internal server error")
      }
    }
  }

  return {
    specificationVersion: "v2",
    provider: providerName,
    modelId,
    defaultObjectGenerationMode: "json",

    async doGenerate(opts) {
      maybeThrowError()

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      const promptText = opts.prompt
        .map((p) => {
          if (p.role === "user") {
            return p.content.map((c) => (c.type === "text" ? c.text : "")).join("")
          }
          return ""
        })
        .join("\n")

      const response = getResponseForPrompt(promptText)

      return {
        text: response.text,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason || "stop",
        usage: {
          promptTokens: response.usage?.promptTokens ?? 10,
          completionTokens: response.usage?.completionTokens ?? 20,
        },
        rawCall: {
          rawPrompt: null,
          rawSettings: {},
        },
        warnings: [],
      }
    },

    async doStream(opts) {
      maybeThrowError()

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      const promptText = opts.prompt
        .map((p) => {
          if (p.role === "user") {
            return p.content.map((c) => (c.type === "text" ? c.text : "")).join("")
          }
          return ""
        })
        .join("\n")

      const response = getResponseForPrompt(promptText)

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          let chunkCount = 0

          // Helper to emit with optional delay and stall handling
          async function emitChunk(part: LanguageModelV2StreamPart) {
            chunkCount++

            // Check for truncation
            if (truncateAfterChunks !== undefined && chunkCount > truncateAfterChunks) {
              controller.close()
              return false
            }

            // Check for stall simulation
            if (stallAfterChunks !== undefined && chunkCount === stallAfterChunks) {
              await new Promise((resolve) => setTimeout(resolve, stallDurationMs))
            }

            // Apply chunk delay
            if (chunkDelay > 0) {
              await new Promise((resolve) => setTimeout(resolve, chunkDelay))
            }

            controller.enqueue(part)
            return true
          }

          // Emit reasoning first if provided
          if (reasoning) {
            const reasoningWords = reasoning.split(" ")
            for (const word of reasoningWords) {
              const shouldContinue = await emitChunk({
                type: "text-delta",
                textDelta: word + " ",
              })
              if (!shouldContinue) return
            }
          }

          // Emit text chunks
          if (response.text) {
            const words = response.text.split(" ")
            for (const word of words) {
              const shouldContinue = await emitChunk({
                type: "text-delta",
                textDelta: word + " ",
              })
              if (!shouldContinue) return
            }
          }

          // Emit tool calls
          if (response.toolCalls) {
            for (const tc of response.toolCalls) {
              const shouldContinue = await emitChunk({
                type: "tool-call",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: JSON.stringify(tc.args),
              })
              if (!shouldContinue) return
            }
          }

          // Emit finish
          controller.enqueue({
            type: "finish",
            finishReason: response.finishReason || "stop",
            usage: {
              promptTokens: response.usage?.promptTokens ?? 10,
              completionTokens: response.usage?.completionTokens ?? 20,
            },
          })

          controller.close()
        },
      })

      return {
        stream,
        rawCall: {
          rawPrompt: null,
          rawSettings: {},
        },
        warnings: [],
      }
    },
  }
}

/**
 * Create a provider that simulates extended thinking behavior
 *
 * Simulates models like Claude Opus 4.5 or GPT-5.2 that may:
 * - Emit reasoning tokens before text
 * - Have longer initial delay ("thinking" time)
 * - Produce tool calls with or without synthesis text
 */
export function createThinkingMockProvider(options: {
  thinkingContent?: string
  thinkingDelayMs?: number
  responses?: Map<string, MockResponse>
  defaultResponse?: MockResponse
}) {
  const {
    thinkingContent = "Let me think about this carefully...",
    thinkingDelayMs = 100,
    responses = new Map(),
    defaultResponse = DEFAULT_RESPONSE,
  } = options

  return createAdvancedMockProvider({
    delay: thinkingDelayMs,
    reasoning: thinkingContent,
    responses,
    defaultResponse,
    modelId: "thinking-mock-model",
    providerName: "thinking-mock",
  })
}

/**
 * Create a provider that simulates slow/stalling behavior
 *
 * Useful for testing:
 * - Stall detection warnings
 * - Timeout handling
 * - Recovery after stall
 */
export function createStallingMockProvider(options: {
  stallAfterMs?: number
  stallDurationMs?: number
  responses?: Map<string, MockResponse>
  defaultResponse?: MockResponse
}) {
  const {
    stallAfterMs = 0,
    stallDurationMs = 5000,
    responses = new Map(),
    defaultResponse = DEFAULT_RESPONSE,
  } = options

  return createAdvancedMockProvider({
    delay: stallAfterMs,
    stallAfterChunks: 3, // Stall after 3 chunks
    stallDurationMs,
    responses,
    defaultResponse,
    modelId: "stalling-mock-model",
    providerName: "stalling-mock",
  })
}

/**
 * Create a provider that simulates multi-tool calling patterns
 *
 * Useful for testing:
 * - Parallel tool execution
 * - Tool-only responses (no final synthesis)
 * - Tool result handling
 */
export function createMultiToolMockProvider(options: {
  toolCount?: number
  includeSynthesis?: boolean
  toolNames?: string[]
}) {
  const {
    toolCount = 3,
    includeSynthesis = false,
    toolNames = ["Read", "Glob", "Grep"],
  } = options

  const toolCalls = Array.from({ length: toolCount }, (_, i) => ({
    toolCallId: `call_${String(i + 1).padStart(3, "0")}`,
    toolName: toolNames[i % toolNames.length],
    args: { index: i },
  }))

  const response: MockResponse = {
    text: includeSynthesis ? "Based on the tool results, here is my analysis." : undefined,
    toolCalls,
    finishReason: "tool-calls",
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
  }

  return createMockProvider({
    defaultResponse: response,
  })
}
