import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionSummary } from "../../src/session/summary"
import { tmpdir } from "../fixture/fixture"

// Prevent Config.get() from running slow dependency installs during tests
process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "true"

const HOLD_MODE_SENTINEL = "PLAN MODE - Read-Only Constraint"
const capturedSystems: string[][] = []
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY
const originalSummarize = SessionSummary.summarize

// Capture the exact system prompt array passed through SessionPrompt -> SessionProcessor -> Fallback.
mock.module("../../src/provider/fallback", () => ({
  Fallback: {
    async stream(input: { system: string[] }) {
      capturedSystems.push(input.system ?? [])
      async function* fullStream() {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "text-start", id: "text_1" }
        yield { type: "text-delta", id: "text_1", delta: "ok" }
        yield { type: "text-end", id: "text_1" }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          providerMetadata: {},
        }
        yield { type: "finish", finishReason: "stop" }
      }
      return { fullStream: fullStream() }
    },
  },
}))

afterAll(() => {
  ;(SessionSummary as any).summarize = originalSummarize
  if (ORIGINAL_OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY
  mock.restore()
})

beforeEach(() => {
  capturedSystems.length = 0
  ;(SessionSummary as any).summarize = async () => {}
})

async function runPromptWithMode(mode: "plan" | "accept" | "bypass", sessionMode: "plan" | "accept" | "bypass") {
  process.env.OPENAI_API_KEY = "test-key"
  await using tmp = await tmpdir({
    git: true,
    config: {
      memory: { required: false },
    } as any,
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.createNext({ directory: tmp.path, surface: "cli" })
      await Session.update(session.id, (draft) => {
        draft.mode = sessionMode
        // Skip async title generation provider lookups in this integration test.
        draft.title = "Mode Prompt Injection"
      })

      const { SessionPrompt } = await import("../../src/session/prompt")
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "zee",
        model: { providerID: "openai", modelID: "gpt-5.2" },
        mode,
        // Deliberately contradictory legacy flags to ensure explicit mode wins.
        tools: { edit: false, write: false, notebook_edit: false },
        parts: [{ type: "text", text: `integration mode check: ${mode}` }],
      })
    },
  })

  return capturedSystems[capturedSystems.length - 1] ?? []
}

describe("SessionPrompt hold-mode prompt injection", () => {
  test("does not inject hold prompt when explicit mode is accept", async () => {
    const system = await runPromptWithMode("accept", "plan")
    expect(system.join("\n")).not.toContain(HOLD_MODE_SENTINEL)
  })

  test("does not inject hold prompt when explicit mode is bypass", async () => {
    const system = await runPromptWithMode("bypass", "plan")
    expect(system.join("\n")).not.toContain(HOLD_MODE_SENTINEL)
  })

  test("injects hold prompt when explicit mode is plan", async () => {
    const system = await runPromptWithMode("plan", "accept")
    expect(system.join("\n")).toContain(HOLD_MODE_SENTINEL)
  })
})
