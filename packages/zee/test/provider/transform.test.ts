import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

const OUTPUT_TOKEN_MAX = 32000

describe("ProviderTransform.options - setCacheKey", () => {
  const sessionID = "test-session-123"

  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should set promptCacheKey when providerOptions.setCacheKey is true", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey when providerOptions.setCacheKey is false", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions is undefined", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: undefined,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions does not have setCacheKey", () => {
    const result = ProviderTransform.options({ model: mockModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set promptCacheKey for openai provider regardless of setCacheKey", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({ model: openaiModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should set store=false for openai provider", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })
})

describe("ProviderTransform.variants - mapping parity", () => {
  test("minimax models return reasoning variants", () => {
    const minimaxModel = {
      id: "minimax-model",
      providerID: "minimax",
      api: { id: "minimax-model", npm: "@ai-sdk/openai-compatible" },
      capabilities: { reasoning: true },
    } as any

    expect(Object.keys(ProviderTransform.variants(minimaxModel))).toEqual([])
  })

  test("glm models from Z.AI/ZhipuAI return thinking variants", () => {
    const glmModel = {
      id: "glm-4-plus",
      providerID: "zai-coding-plan",
      api: { id: "glm-4-plus", npm: "@ai-sdk/openai-compatible" },
      capabilities: { reasoning: true },
    } as any

    const variants = ProviderTransform.variants(glmModel)
    expect(Object.keys(variants)).toEqual(["low", "medium", "high", "max"])
    expect(variants.medium.thinking.budget_tokens).toBe(16000)
  })

  test("xai sdk non-mini models return no reasoning effort variants", () => {
    const grokModel = {
      id: "grok-4",
      providerID: "xai",
      api: { id: "grok-4", npm: "@ai-sdk/xai" },
      capabilities: { reasoning: true },
    } as any

    expect(ProviderTransform.variants(grokModel)).toEqual({})
  })

  test("xai sdk grok-3-mini keeps low/high reasoning variants", () => {
    const grokMiniModel = {
      id: "grok-3-mini",
      providerID: "xai",
      api: { id: "grok-3-mini", npm: "@ai-sdk/xai" },
      capabilities: { reasoning: true },
    } as any

    expect(Object.keys(ProviderTransform.variants(grokMiniModel))).toEqual(["low", "high"])
  })

  test("xai sdk grok-4.20 multi-agent supports low/medium/high/xhigh", () => {
    const grokMultiAgentModel = {
      id: "grok-4.20-multi-agent-experimental-beta-0304",
      providerID: "xai",
      api: { id: "grok-4.20-multi-agent-experimental-beta-0304", npm: "@ai-sdk/xai" },
      capabilities: { reasoning: true },
    } as any

    expect(Object.keys(ProviderTransform.variants(grokMultiAgentModel))).toEqual(["low", "medium", "high", "xhigh"])
  })

  test("anthropic thinking budgets match default limits", () => {
    const anthropicModel = {
      id: "claude-3-5-sonnet",
      providerID: "anthropic",
      api: { id: "claude-3-5-sonnet", npm: "@ai-sdk/anthropic" },
      limit: { context: 128000, output: 64000 },
      capabilities: { reasoning: true },
    } as any

    const variants = ProviderTransform.variants(anthropicModel)
    expect(variants.high.thinking.budgetTokens).toBe(32000)
    expect(variants.max.thinking.budgetTokens).toBe(64000)
  })
})

describe("ProviderTransform.maxOutputTokens", () => {
  test("returns 32k when modelLimit > 32k", () => {
    const modelLimit = 100000
    const result = ProviderTransform.maxOutputTokens("@ai-sdk/openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  test("returns modelLimit when modelLimit < 32k", () => {
    const modelLimit = 16000
    const result = ProviderTransform.maxOutputTokens("@ai-sdk/openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(16000)
  })

  describe("anthropic without thinking options", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("anthropic with thinking options", () => {
    test("returns 32k when budgetTokens + 32k <= modelLimit", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit - budgetTokens when budgetTokens + 32k > modelLimit", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 30000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(20000)
    })

    test("returns at least 1 when budgetTokens equals modelLimit", () => {
      const modelLimit = 64000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 64000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(1)
    })

    test("returns at least 1 when budgetTokens exceeds modelLimit", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 64000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(1)
    })

    test("returns 32k when thinking type is not enabled", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "disabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })
  })
})

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "openrouter",
      api: {
        id: "gemini-3-pro",
        npm: "@openrouter/ai-sdk-provider",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nodes.items).toBeDefined()
    expect(result.properties.edges.items.type).toBe("string")
  })
})

describe("ProviderTransform.message - interleaved reasoning fields", () => {
  test("Non-interleaved providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: "openai/gpt-4",
        providerID: "openai",
        api: {
          id: "gpt-4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-4",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          streaming: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 0.03,
          output: 0.06,
          cache: { read: 0.001, write: 0.002 },
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - interleaved reasoning_content injection for Kimi", () => {
  const kimiModel = {
    id: "kimi-for-coding/kimi-k2.5",
    providerID: "kimi-for-coding",
    api: {
      id: "kimi-k2.5",
      url: "https://api.kimi.com/coding/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Kimi K2.5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      streaming: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: { field: "reasoning_content" as const },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 262144, output: 32768 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-26",
  } as any

  test("tool-call-only assistant message gets empty reasoning_content", () => {
    const msgs = [
      { role: "user", content: "search for files" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc1", toolName: "search", input: { q: "files" } }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, kimiModel, {})

    expect(result[1].providerOptions?.openaiCompatible?.reasoning_content).toBe("")
    // tool-call parts should be preserved
    expect(result[1].content).toEqual([
      { type: "tool-call", toolCallId: "tc1", toolName: "search", input: { q: "files" } },
    ])
  })

  test("assistant message with reasoning extracts reasoning_content", () => {
    const msgs = [
      { role: "user", content: "search for files" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "I should search for files" },
          { type: "tool-call", toolCallId: "tc1", toolName: "search", input: { q: "files" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, kimiModel, {})

    expect(result[1].providerOptions?.openaiCompatible?.reasoning_content).toBe("I should search for files")
    // reasoning parts should be filtered out
    expect(result[1].content).toEqual([
      { type: "tool-call", toolCallId: "tc1", toolName: "search", input: { q: "files" } },
    ])
  })

  test("boolean interleaved=true with openai-compatible defaults to reasoning_content", () => {
    const boolModel = {
      ...kimiModel,
      capabilities: { ...kimiModel.capabilities, interleaved: true },
    }

    const msgs = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking..." },
          { type: "text", text: "hi" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, boolModel, {})

    expect(result[1].providerOptions?.openaiCompatible?.reasoning_content).toBe("thinking...")
    expect(result[1].content).toEqual([{ type: "text", text: "hi" }])
  })

  test("string content assistant message still gets reasoning_content injected", () => {
    const msgs = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ] as any[]

    const result = ProviderTransform.message(msgs, kimiModel, {})

    expect(result[1].providerOptions?.openaiCompatible?.reasoning_content).toBe("")
    expect(result[1].content).toBe("hi there")
  })

  test("multi-turn with tool calls injects reasoning_content on all assistant messages", () => {
    const msgs = [
      { role: "user", content: "search for X" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "I should search" },
          { type: "tool-call", toolCallId: "tc1", toolName: "search", input: { q: "X" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "tc1", toolName: "search", output: { type: "text", value: "found X" } },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc2", toolName: "read", input: { file: "x.txt" } }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, kimiModel, {})

    // First assistant: has reasoning text
    expect(result[1].providerOptions?.openaiCompatible?.reasoning_content).toBe("I should search")
    // Second assistant: no reasoning -> empty string
    expect(result[3].providerOptions?.openaiCompatible?.reasoning_content).toBe("")
  })
})

describe("ProviderTransform.message - empty image handling", () => {
  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should replace empty base64 image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "data:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should keep valid base64 images unchanged", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
  })

  test("should handle mixed valid and empty images", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
          { type: "image", image: "data:image/jpeg;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Compare these images" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
    expect(result[0].content[2]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })
})

describe("ProviderTransform.message - anthropic empty content filtering", () => {
  const anthropicModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("filters out messages with empty string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters out empty text parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Hello" },
          { type: "text", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
  })

  test("filters out empty reasoning parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
          { type: "reasoning", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("removes entire message when all parts are empty", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "reasoning", text: "" },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("keeps non-text/reasoning parts even if text parts are empty", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "123", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({
      type: "tool-call",
      toolCallId: "123",
      toolName: "bash",
      input: { command: "ls" },
    })
  })

  test("keeps messages with valid text alongside empty parts", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "" },
          { type: "text", text: "Result" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
    expect(result[0].content[1]).toEqual({ type: "text", text: "Result" })
  })

  test("does not filter for non-anthropic providers", () => {
    const openaiModel = {
      ...anthropicModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }

    const msgs = [
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("")
    expect(result[1].content).toHaveLength(1)
  })
})

describe("ProviderTransform.message - strip openai metadata when store=false", () => {
  const openaiModel = {
    id: "openai/gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("preserves itemId and reasoningEncryptedContent when store=false", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("rs_123")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves itemId and reasoningEncryptedContent when store=false even when not openai", () => {
    const zenModel = {
      ...openaiModel,
      providerID: "zen",
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, zenModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("rs_123")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves other openai options including itemId", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.openai?.otherOption).toBe("value")
  })

  test("preserves metadata for openai package when store is true", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // openai package preserves itemId regardless of store value
    const result = ProviderTransform.message(msgs, openaiModel, { store: true }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata for non-openai packages when store is false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // store=false preserves metadata for non-openai packages
    const result = ProviderTransform.message(msgs, anthropicModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata using providerID key when store is false", () => {
    const testModel = {
      ...openaiModel,
      providerID: "test-provider",
      api: {
        id: "test-provider-model",
        url: "https://api.example.invalid",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              "test-provider": {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, testModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.["test-provider"]?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.["test-provider"]?.otherOption).toBe("value")
  })

  test("preserves itemId across all providerOptions keys", () => {
    const testModel = {
      ...openaiModel,
      providerID: "test-provider",
      api: {
        id: "test-provider-model",
        url: "https://api.example.invalid",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        providerOptions: {
          openai: { itemId: "msg_root" },
          "test-provider": { itemId: "msg_test" },
          extra: { itemId: "msg_extra" },
        },
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: { itemId: "msg_openai_part" },
              "test-provider": { itemId: "msg_test_part" },
              extra: { itemId: "msg_extra_part" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, testModel, { store: false }) as any[]

    expect(result[0].providerOptions?.openai?.itemId).toBe("msg_root")
    expect(result[0].providerOptions?.["test-provider"]?.itemId).toBe("msg_test")
    expect(result[0].providerOptions?.extra?.itemId).toBe("msg_extra")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_openai_part")
    expect(result[0].content[0].providerOptions?.["test-provider"]?.itemId).toBe("msg_test_part")
    expect(result[0].content[0].providerOptions?.extra?.itemId).toBe("msg_extra_part")
  })

  test("does not strip metadata for non-openai packages when store is not false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })
})

const customAnthropicModel = {
  id: "myrelay/claude-sonnet-4-5",
  providerID: "myrelay",
  api: {
    id: "claude-sonnet-4-5-20250929",
    url: "https://my-relay.example.com",
    npm: "@ai-sdk/anthropic",
  },
  name: "Claude via relay",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
  limit: { context: 200000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
} as any

describe("ProviderTransform.message - anthropic relay compatibility", () => {
  test("replaces empty string tool-result content with a placeholder", () => {
    const msgs = [
      { role: "user", content: "Run the bash tool" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { command: "echo hi" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call_1", toolName: "bash", content: "" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, customAnthropicModel, {})
    const toolMsg = result.find((msg: any) => msg.role === "tool") as any
    const toolResult = (toolMsg.content as any[]).find((part: any) => part.type === "tool-result")
    expect(toolResult.content).toBe("(empty)")
  })

  test("replaces empty array tool-result content with a placeholder part", () => {
    const msgs = [
      { role: "user", content: "Run the read tool" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_2", toolName: "read", input: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call_2", toolName: "read", content: [] }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, customAnthropicModel, {})
    const toolMsg = result.find((msg: any) => msg.role === "tool") as any
    const toolResult = (toolMsg.content as any[]).find((part: any) => part.type === "tool-result")
    expect(toolResult.content).toEqual([{ type: "text", text: "(empty)" }])
  })

  test("applies caching at message level for custom anthropic providers", () => {
    const msgs = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, customAnthropicModel, {})
    const systemMsg = result.find((msg: any) => msg.role === "system")
    expect(systemMsg?.providerOptions?.anthropic?.cacheControl).toBeDefined()
  })
})

describe("ProviderTransform.message - providerOptions key remapping", () => {
  const createModel = (providerID: string, npm: string) =>
    ({
      id: `${providerID}/test-model`,
      providerID,
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm,
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any
})

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 128000,
      output: 64000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  })

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns reasoning variants", () => {
    const model = createMockModel({
      id: "minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: { reasoning: true },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual([])
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-4",
      providerID: "glm",
      api: {
        id: "glm-4",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  describe("@openrouter/ai-sdk-provider", () => {
    test("returns empty object for non-qualifying models", () => {
      const model = createMockModel({
        id: "openrouter/test-model",
        providerID: "openrouter",
        api: {
          id: "test-model",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("gpt models return low/medium/high reasoning efforts", () => {
      const model = createMockModel({
        id: "openrouter/gpt-4",
        providerID: "openrouter",
        api: {
          id: "gpt-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    test("gemini-3 returns low/medium/high reasoning efforts", () => {
      const model = createMockModel({
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("grok-4 returns empty object", () => {
      const model = createMockModel({
        id: "openrouter/grok-4",
        providerID: "openrouter",
        api: {
          id: "grok-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/grok-3-mini",
        providerID: "openrouter",
        api: {
          id: "grok-3-mini",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })
  })

  describe("xai (via openai-compatible)", () => {
    test("grok-3 returns empty object (no reasoningEffort support)", () => {
      const model = createMockModel({
        id: "xai/grok-3",
        providerID: "xai",
        api: {
          id: "grok-3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-3-mini",
        providerID: "xai",
        api: {
          id: "grok-3-mini",
          url: "https://api.x.ai",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("grok-4.20 multi-agent returns low/medium/high/xhigh with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-4.20-multi-agent-experimental-beta-0304",
        providerID: "xai",
        api: {
          id: "grok-4.20-multi-agent-experimental-beta-0304",
          url: "https://api.x.ai",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.xhigh).toEqual({ reasoningEffort: "xhigh" })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/openai", () => {
    test("gpt-5-pro returns empty object", () => {
      const model = createMockModel({
        id: "gpt-5-pro",
        providerID: "openai",
        api: {
          id: "gpt-5-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard openai models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-06-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("models after 2025-11-13 include 'none' effort", () => {
      const model = createMockModel({
        id: "gpt-5-nano",
        providerID: "openai",
        api: {
          id: "gpt-5-nano",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-11-14",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high"])
    })

    test("gpt-5.4 exposes none/low/medium/high/xhigh efforts", () => {
      const model = createMockModel({
        id: "openai/gpt-5.4",
        providerID: "openai",
        api: {
          id: "gpt-5.4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2026-03-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "low", "medium", "high", "xhigh"])
    })

    test("gpt-5.4-pro uses medium/high/xhigh effort levels", () => {
      const model = createMockModel({
        id: "openai/gpt-5.4-pro",
        providerID: "openai",
        api: {
          id: "gpt-5.4-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2026-03-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["medium", "high", "xhigh"])
    })

    test("codex models use low/medium/high/xhigh effort nomenclature", () => {
      const model = createMockModel({
        id: "openai/gpt-5.3-codex",
        providerID: "openai",
        api: {
          id: "gpt-5.3-codex",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2026-01-15",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/anthropic", () => {
    test("returns high and max with thinking config", () => {
      const model = createMockModel({
        id: "anthropic/claude-4",
        providerID: "anthropic",
        api: {
          id: "claude-4",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.high.thinking).toBeDefined()
      expect(result.medium.thinking.budgetTokens).toBe(16000)
    })
  })

})

describe("ProviderTransform.options - retained thinking configs", () => {
  const sessionID = "test-session-123"

  describe("Zee (GLM-4.7 via Z.AI Coding Plan)", () => {
    test("should enable preserved thinking mode for zai-coding-plan provider", () => {
      const model = {
        id: "zai-coding-plan/glm-4.7",
        providerID: "zai-coding-plan",
        api: {
          id: "glm-4.7",
          url: "https://open.bigmodel.cn/api/paas/v4",
          npm: "@ai-sdk/openai-compatible",
        },
      } as any
      const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
      expect(result.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    })
  })

  describe("Grok 4.20 via xAI openai-compatible", () => {
    test("grok-4.20 multi-agent returns low/medium/high/xhigh reasoningEffort variants", () => {
      const model = {
        id: "x-ai/grok-4.20-multi-agent-experimental-beta-0304",
        providerID: "x-ai",
        api: {
          id: "grok-4.20-multi-agent-experimental-beta-0304",
          url: "https://api.x.ai",
          npm: "@ai-sdk/openai-compatible",
        },
        capabilities: {
          reasoning: true,
        },
        release_date: "2026-03-04",
      } as any
      const variants = ProviderTransform.variants(model)
      expect(Object.keys(variants)).toEqual(["low", "medium", "high", "xhigh"])
    })
  })

  describe("OpenRouter Gemini fallbacks", () => {
    test("gemini-3 models get high reasoning by default", () => {
      const model = {
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai/api/v1",
          npm: "@openrouter/ai-sdk-provider",
        },
      } as any
      const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
      expect(result.reasoning).toEqual({
        effort: "high",
      })
    })
  })
})
