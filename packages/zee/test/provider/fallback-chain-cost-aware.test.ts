import { afterEach, describe, expect, mock, test } from "bun:test"

const FALLBACK_RULES = [
  {
    condition: "rate_limit" as const,
    fallbacks: ["anthropic/claude-opus-4-6", "groq/openai/gpt-oss-120b"],
  },
]

afterEach(() => {
  mock.restore()
})

describe("FallbackChain costAware", () => {
  test("skips more expensive explicit fallback candidates", async () => {
    mock.module("../../src/provider/equivalence", () => ({
      ModelEquivalence: {
        parseModel(model: string) {
          const [providerID, ...rest] = model.split("/")
          return { providerID, modelID: rest.join("/") }
        },
        async findFallback() {
          return undefined
        },
      },
    }))

    mock.module("../../src/provider/provider", () => ({
      Provider: {
        async getModel(providerID: string, modelID: string) {
          const key = `${providerID}/${modelID}`
          if (key === "openai/gpt-5.2") {
            return { cost: { input: 1, output: 2 } }
          }
          if (key === "anthropic/claude-opus-4-6") {
            return { cost: { input: 5, output: 5 } }
          }
          if (key === "groq/openai/gpt-oss-120b") {
            return { cost: { input: 0.8, output: 0.8 } }
          }
          throw new Error(`Unknown model: ${key}`)
        },
      },
    }))

    const { FallbackChain } = await import("../../src/provider/fallback-chain")
    const result = await FallbackChain.resolve(
      "openai/gpt-5.2",
      new Error("rate limit"),
      ["openai/gpt-5.2"],
      {
        enabled: true,
        maxAttempts: 3,
        rules: FALLBACK_RULES,
        costAware: true,
        notifyOnFallback: false,
      },
    )

    expect(result).toBe("groq/openai/gpt-oss-120b")
  })
})
