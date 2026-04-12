import { afterAll, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"

const originalEnvNoNewLegacy = process.env.ZEE_NO_NEW_LEGACY
afterAll(() => {
  if (originalEnvNoNewLegacy === undefined) {
    delete process.env.ZEE_NO_NEW_LEGACY
  } else {
    process.env.ZEE_NO_NEW_LEGACY = originalEnvNoNewLegacy
  }
  reloadFlags()
})

const { LlmRoute } = await import("../../src/server/route/llm")

describe("llm.stream route", () => {
  test("blocks legacy bridge payload when no-new-legacy flag is enabled", async () => {
    try {
      process.env.ZEE_NO_NEW_LEGACY = "1"
      reloadFlags()

      const response = await LlmRoute.request("/v1/llm/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-4o",
          context: {
            messages: [{ role: "user", content: "hello" }],
          },
        }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { error?: string }
      expect(body.error).toBe("Legacy LLM bridge endpoint is disabled.")
    } finally {
      if (originalEnvNoNewLegacy === undefined) {
        delete process.env.ZEE_NO_NEW_LEGACY
      } else {
        process.env.ZEE_NO_NEW_LEGACY = originalEnvNoNewLegacy
      }
      reloadFlags()
    }
  })
})
