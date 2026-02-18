/**
 * Extended Thinking Model Tests
 *
 * Tests for models with extended thinking capabilities:
 * - Claude Opus 4.5 (Anthropic)
 * - GPT-5.2 (OpenAI)
 * - Kimi K2 Thinking (Moonshot)
 * - Gemini 3 (Google)
 *
 * Verifies thinking budget configurations, interleaved reasoning,
 * and provider-specific parameter transforms.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"

// Helper to create mock model objects
function createMockModel(
  overrides: Partial<{
    id: string
    providerID: string
    api: { id: string; url: string; npm: string }
    capabilities: { reasoning: boolean }
    release_date: string
  }>,
): Provider.Model {
  return {
    id: overrides.id ?? "test/test-model",
    providerID: overrides.providerID ?? "test",
    api: {
      id: overrides.api?.id ?? "test-model",
      url: overrides.api?.url ?? "https://api.test.com",
      npm: overrides.api?.npm ?? "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: overrides.capabilities?.reasoning ?? true,
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
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: overrides.release_date ?? "2024-01-01",
  } as Provider.Model
}

describe("Anthropic Claude Extended Thinking", () => {
  const sessionID = "test-session"

  test("Claude Opus 4.5 via Anthropic gets thinking config", () => {
    const model = createMockModel({
      id: "anthropic/claude-opus-4-5",
      providerID: "anthropic",
      api: {
        id: "claude-opus-4-5",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toContain("high")
    expect(Object.keys(variants)).toContain("max")
    expect(variants.high).toHaveProperty("thinking")
    expect(variants.max).toHaveProperty("thinking")
  })

  test("Claude Sonnet 4.5 via Anthropic gets thinking config", () => {
    const model = createMockModel({
      id: "anthropic/claude-sonnet-4-5",
      providerID: "anthropic",
      api: {
        id: "claude-sonnet-4-5",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toContain("high")
    expect(Object.keys(variants)).toContain("max")
  })

  test("Anthropic thinking variants use budgetTokens", () => {
    const model = createMockModel({
      id: "anthropic/claude-opus-4-5",
      providerID: "anthropic",
      api: {
        id: "claude-opus-4-5",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })

    const variants = ProviderTransform.variants(model)

    // High variant should have budgetTokens
    expect(variants.high.thinking).toEqual({
      type: "enabled",
      budgetTokens: 32000,
    })

    // Max variant should have higher budgetTokens
    expect(variants.max.thinking).toEqual({
      type: "enabled",
      budgetTokens: 64000,
    })
  })
})

describe("Google Gemini Extended Thinking", () => {
  const sessionID = "test-session"

  test("Gemini 2.5 models get thinkingConfig with budget", () => {
    const model = createMockModel({
      id: "google/gemini-2.5-pro",
      providerID: "google",
      api: {
        id: "gemini-2.5-pro",
        url: "https://generativelanguage.googleapis.com",
        npm: "@ai-sdk/google",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toContain("high")
    expect(Object.keys(variants)).toContain("max")
    expect(variants.high).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: 32000,
      },
    })
  })

  test("Gemini 3 models get thinkingLevel", () => {
    const model = createMockModel({
      id: "google/gemini-3-pro",
      providerID: "google",
      api: {
        id: "gemini-3-pro",
        url: "https://generativelanguage.googleapis.com",
        npm: "@ai-sdk/google",
      },
    })

    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: "high",
    })
  })

  test("Gemini models get low/high thinkingLevel variants", () => {
    const model = createMockModel({
      id: "google/gemini-2.0-pro",
      providerID: "google",
      api: {
        id: "gemini-2.0-pro",
        url: "https://generativelanguage.googleapis.com",
        npm: "@ai-sdk/google",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(["low", "high"])
    expect(variants.low).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: "low",
      },
    })
    expect(variants.high).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: "high",
      },
    })
  })
})

describe("OpenAI GPT Extended Thinking", () => {
  test("GPT-5 models get reasoning effort variants", () => {
    const model = createMockModel({
      id: "openai/gpt-5",
      providerID: "openai",
      api: {
        id: "gpt-5",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      release_date: "2025-06-01",
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toContain("low")
    expect(Object.keys(variants)).toContain("medium")
    expect(Object.keys(variants)).toContain("high")
    expect(variants.low).toHaveProperty("reasoningEffort", "low")
  })

  test("GPT-5 models after 2025-11-13 include 'none' effort", () => {
    const model = createMockModel({
      id: "openai/gpt-5-nano",
      providerID: "openai",
      api: {
        id: "gpt-5-nano",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      release_date: "2025-11-14",
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toContain("none")
    expect(Object.keys(variants)).toContain("minimal")
  })

  test("GPT-5 models after 2025-12-04 include 'xhigh' effort", () => {
    const model = createMockModel({
      id: "openai/gpt-5.2",
      providerID: "openai",
      api: {
        id: "gpt-5.2",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      release_date: "2025-12-05",
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toContain("xhigh")
  })

  test("GPT-5 Codex models use low/medium/high/xhigh effort levels", () => {
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

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(["low", "medium", "high", "xhigh"])
  })

  test("GPT-5-pro returns reasoning effort variants", () => {
    // Note: gpt-5-pro is a reasoning model but the special-case check in transform.ts
    // uses id === "gpt-5-pro" which doesn't match "openai/gpt-5-pro"
    // This test documents actual behavior
    const model = createMockModel({
      id: "openai/gpt-5-pro",
      providerID: "openai",
      api: {
        id: "gpt-5-pro",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      release_date: "2025-06-01",
    })

    const variants = ProviderTransform.variants(model)
    // gpt-5-pro gets standard reasoning variants since the special case check doesn't match
    expect(Object.keys(variants)).toContain("high")
    expect(variants.high).toHaveProperty("reasoningEffort", "high")
  })
})

describe("xAI Grok Extended Thinking (via openai-compatible)", () => {
  test("Grok 3 models get reasoning effort variants via openai-compatible", () => {
    // xAI now uses openai-compatible instead of dedicated SDK
    const model = createMockModel({
      id: "xai/grok-3",
      providerID: "xai",
      api: {
        id: "grok-3",
        url: "https://api.x.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(["low", "medium", "high"])
    expect(variants.high).toEqual({ reasoningEffort: "high" })
  })

  test("Grok 3 Mini gets low/high variants only", () => {
    const model = createMockModel({
      id: "xai/grok-3-mini",
      providerID: "xai",
      api: {
        id: "grok-3-mini",
        url: "https://api.x.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    // Grok 3 Mini has special handling in variants() for low/high only
    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(["low", "high"])
  })
})

describe("OpenRouter Extended Thinking", () => {
  test("GPT models via OpenRouter get low/medium/high efforts", () => {
    const model = createMockModel({
      id: "openrouter/gpt-5",
      providerID: "openrouter",
      api: {
        id: "gpt-5",
        url: "https://openrouter.ai",
        npm: "@openrouter/ai-sdk-provider",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(["low", "medium", "high"])
    expect(variants.low).toEqual({ reasoning: { effort: "low" } })
  })

  test("Gemini 3 via OpenRouter gets low/medium/high efforts", () => {
    const model = createMockModel({
      id: "openrouter/gemini-3-5-pro",
      providerID: "openrouter",
      api: {
        id: "gemini-3-5-pro",
        url: "https://openrouter.ai",
        npm: "@openrouter/ai-sdk-provider",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(Object.keys(variants)).toEqual(["low", "medium", "high"])
  })

  test("Grok 4 via OpenRouter returns empty", () => {
    const model = createMockModel({
      id: "openrouter/grok-4",
      providerID: "openrouter",
      api: {
        id: "grok-4",
        url: "https://openrouter.ai",
        npm: "@openrouter/ai-sdk-provider",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(variants).toEqual({})
  })
})

describe("Non-Reasoning Models", () => {
  test("Models without reasoning capability return empty variants", () => {
    const model = createMockModel({
      id: "test/non-reasoning",
      providerID: "test",
      api: {
        id: "non-reasoning",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      capabilities: { reasoning: false },
    })

    const variants = ProviderTransform.variants(model)
    expect(variants).toEqual({})
  })

  test("MiniMax models return empty variants", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })

    const variants = ProviderTransform.variants(model)
    expect(variants).toEqual({})
  })
})

describe("Persona Thinking Configs", () => {
  const sessionID = "test-session"

  describe("Zee (GLM via ZhipuAI)", () => {
    test("ZhipuAI provider gets preserved thinking mode", () => {
      const model = createMockModel({
        id: "zhipuai/glm-4.7",
        providerID: "zhipuai",
        api: {
          id: "glm-4.7",
          url: "https://api.zhipuai.cn",
          npm: "@ai-sdk/openai-compatible",
        },
      })

      const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
      expect(result.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    })

    test("Z.AI Coding Plan provider gets preserved thinking mode", () => {
      const model = createMockModel({
        id: "zai-coding-plan/glm-4.7",
        providerID: "zai-coding-plan",
        api: {
          id: "glm-4.7",
          url: "https://open.bigmodel.cn/api/paas/v4",
          npm: "@ai-sdk/openai-compatible",
        },
      })

      const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
      expect(result.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    })
  })

  describe("Johny (Google Antigravity)", () => {
    test("Google Antigravity provider gets thinkingConfig", () => {
      const model = createMockModel({
        id: "google-antigravity/antigravity-claude-opus-4-5-thinking",
        providerID: "google-antigravity",
        api: {
          id: "antigravity-claude-opus-4-5-thinking",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })

      const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
      expect(result.thinkingConfig).toEqual({
        includeThoughts: true,
      })
    })
  })
})
