import { describe, expect, test } from "bun:test"
import { FallbackChain } from "../../src/provider/fallback-chain"

describe("FallbackChain defaults", () => {
  test("uses anthropic-first fallback order", () => {
    const firstRule = FallbackChain.DEFAULT_RULES[0]
    expect(firstRule.fallbacks[0]).toBe("anthropic")
  })

  test("any rule defaults to anthropic", () => {
    const anyRule = FallbackChain.DEFAULT_RULES.find((rule) => rule.condition === "any")
    expect(anyRule?.fallbacks[0]).toBe("anthropic")
  })
})
