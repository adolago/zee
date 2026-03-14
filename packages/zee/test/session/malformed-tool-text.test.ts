import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ModelMessage } from "ai"
import type { Provider } from "../../src/provider/provider"
import {
  buildMalformedToolTextRetryReminder,
  detectMalformedToolText,
  MALFORMED_TOOL_TEXT_FINISH,
} from "../../src/session/malformed-tool-text"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionSummary } from "../../src/session/summary"
import { tmpdir } from "../fixture/fixture"

process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "true"

const capturedPrimaryCalls: Array<{ system: string[]; messages: ModelMessage[] }> = []
let primaryResponseCall = 0

const originalSummarize = SessionSummary.summarize
const originalOpenAIKey = process.env.OPENAI_API_KEY

mock.module("../../src/provider/fallback", () => ({
  Fallback: {
    async stream(input: { purpose?: string; system: string[]; messages: ModelMessage[] }) {
      if (input.purpose === "primary_response") {
        primaryResponseCall += 1
        capturedPrimaryCalls.push({ system: input.system ?? [], messages: input.messages ?? [] })
      }

      async function* fullStream() {
        yield { type: "start" }
        yield { type: "start-step" }

        if (input.purpose !== "primary_response") {
          yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 }, providerMetadata: {} }
          yield { type: "finish", finishReason: "stop" }
          return
        }

        if (primaryResponseCall === 1) {
          yield { type: "text-start", id: "text_1" }
          yield {
            type: "text-delta",
            id: "text_1",
            delta: 'I will inspect the folder.\nto=glob {"pattern":"*"}\n<assistant recipient="bash">\n{"command":"pwd"}\n</assistant>',
          }
          yield { type: "text-end", id: "text_1" }
        } else {
          yield { type: "text-start", id: "text_2" }
          yield { type: "text-delta", id: "text_2", delta: "Recovered after native retry." }
          yield { type: "text-end", id: "text_2" }
        }

        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          providerMetadata: {},
        }
        yield { type: "finish", finishReason: "stop" }
      }

      return {
        fullStream: fullStream(),
        text: Promise.resolve("title"),
      }
    },
  },
}))

afterAll(() => {
  ;(SessionSummary as any).summarize = originalSummarize
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalOpenAIKey
  mock.restore()
})

beforeEach(() => {
  capturedPrimaryCalls.length = 0
  primaryResponseCall = 0
  ;(SessionSummary as any).summarize = async () => {}
})

const gpt5Model = {
  id: "gpt-5.4",
  providerID: "openai",
  api: {
    id: "gpt-5.4",
    url: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
  },
  name: "GPT-5.4",
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: true,
    toolcall: true,
    streaming: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
} as Provider.Model

describe("session.malformed-tool-text", () => {
  test("detects pseudo-tool text for eligible GPT-5 responses", () => {
    const detected = detectMalformedToolText({
      model: gpt5Model,
      userText: "Read the folder and summarize the documents.",
      parts: [
        {
          id: "p1",
          sessionID: "s1",
          messageID: "m1",
          type: "text",
          text: 'I will inspect the folder.\nto=glob {"pattern":"*"}\n<assistant recipient="bash">\n{"command":"pwd"}\n</assistant>',
        },
      ] as any,
    })

    expect(detected.matched).toBe(true)
    expect(detected.reason).toContain("strong=")
  })

  test("does not detect when the user explicitly asks about tool syntax", () => {
    const detected = detectMalformedToolText({
      model: gpt5Model,
      userText: 'Explain what `<assistant recipient="bash">` and `to=glob` mean.',
      parts: [
        {
          id: "p1",
          sessionID: "s1",
          messageID: "m1",
          type: "text",
          text: 'Example syntax:\n<assistant recipient="bash">\n{"command":"pwd"}\n</assistant>',
        },
      ] as any,
    })

    expect(detected.matched).toBe(false)
  })

  test("builds a retry reminder only when the latest assistant was malformed", () => {
    const reminder = buildMalformedToolTextRetryReminder({
      messages: [
        {
          info: {
            id: "u1",
            sessionID: "s1",
            role: "user",
            time: { created: 0 },
            agent: "zee",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
          parts: [{ id: "p1", sessionID: "s1", messageID: "u1", type: "text", text: "inspect the folder" }],
        },
        {
          info: {
            id: "a1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1 },
            parentID: "u1",
            modelID: "gpt-5.4",
            providerID: "openai",
            mode: "zee",
            agent: "zee",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: MALFORMED_TOOL_TEXT_FINISH,
          },
          parts: [],
        },
      ] as any,
    })

    expect(reminder).toContain("[MALFORMED TOOL OUTPUT]")
  })

  test("auto-retries malformed GPT-5 pseudo-tool output and hides it from follow-up context", async () => {
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
          draft.title = "Malformed Tool Recovery"
        })

        const { SessionPrompt } = await import("../../src/session/prompt")
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "zee",
          model: { providerID: "openai", modelID: "gpt-5.4" },
          parts: [{ type: "text", text: "Read the top-level files in this folder and summarize them." }],
        })

        const messages = await Session.messages({ sessionID: session.id })
        const assistants = messages.filter((message) => message.info.role === "assistant")

        expect(capturedPrimaryCalls).toHaveLength(2)
        expect(assistants).toHaveLength(2)
        expect(assistants[0]?.info.finish).toBe(MALFORMED_TOOL_TEXT_FINISH)
        expect(assistants[0]?.parts.find((part) => part.type === "text")).toMatchObject({
          type: "text",
          ignored: true,
        })
        expect(assistants[1]?.parts.find((part) => part.type === "text")).toMatchObject({
          type: "text",
          text: "Recovered after native retry.",
        })

        const secondCall = capturedPrimaryCalls[1]
        const serializedMessages = JSON.stringify(secondCall?.messages ?? [])
        expect(serializedMessages).toContain("[MALFORMED TOOL OUTPUT]")
        expect(serializedMessages).not.toContain('to=glob {"pattern":"*"}')
      },
    })
  })
})
