import { afterEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Env } from "../../src/env"

const FALLBACK_RULES = [
  {
    condition: "rate_limit" as const,
    fallbacks: ["anthropic/claude-opus-4-6", "xai/grok-4.20-experimental-beta-0304-reasoning"],
  },
]

afterEach(() => {
  mock.restore()
})

describe("FallbackChain costAware", () => {
  test("skips more expensive explicit fallback candidates", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "zee.jsonc"),
          JSON.stringify({
            $schema: "zee",
            provider: {
              openai: {
                models: {
                  "gpt-5.4": {
                    cost: {
                      input: 1,
                      output: 2,
                    },
                  },
                },
              },
              anthropic: {
                models: {
                  "claude-opus-4-6": {
                    cost: {
                      input: 5,
                      output: 5,
                    },
                  },
                },
              },
              xai: {
                models: {
                  "grok-4.20-experimental-beta-0304-reasoning": {
                    cost: {
                      input: 0.8,
                      output: 0.8,
                    },
                  },
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("OPENAI_API_KEY", "test-openai-key")
        Env.set("ANTHROPIC_API_KEY", "test-anthropic-key")
        Env.set("XAI_API_KEY", "test-xai-key")
      },
      fn: async () => {
        const { FallbackChain } = await import("../../src/provider/fallback-chain")
        const result = await FallbackChain.resolve(
          "openai/gpt-5.4",
          new Error("rate limit"),
          ["openai/gpt-5.4"],
          {
            enabled: true,
            maxAttempts: 3,
            rules: FALLBACK_RULES,
            costAware: true,
            notifyOnFallback: false,
          },
        )

        expect(result).toBe("xai/grok-4.20-experimental-beta-0304-reasoning")
      },
    })
  })
})
