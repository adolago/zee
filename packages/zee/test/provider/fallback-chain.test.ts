import { describe, expect, test } from "bun:test"
import { FallbackChain } from "../../src/provider/fallback-chain"

describe("FallbackChain defaults", () => {
  test("uses openai-first fallback order", () => {
    const firstRule = FallbackChain.DEFAULT_RULES[0]
    expect(firstRule.fallbacks[0]).toBe("openai")
  })

  test("any rule defaults to openai", () => {
    const anyRule = FallbackChain.DEFAULT_RULES.find((rule) => rule.condition === "any")
    expect(anyRule?.fallbacks[0]).toBe("openai")
  })
})
