import { describe, expect, test, mock, afterAll } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { PermissionNext } from "../../src/permission/next"
import { tmpdir } from "../fixture/fixture"
import { Identifier } from "../../src/id/id"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionSteering } from "../../src/session/steering"

// Prevent Config.get() from running slow dependency installs during tests
process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "true"

type StreamScenario = "steering" | "undefined-tool-calls" | "doom-loop"

let streamScenario: StreamScenario = "steering"
let streamFinishStepReached = false

// Mock the Fallback provider to yield a minimal stream that triggers the
// steering check: start -> start-step -> finish-step(tool-calls).
// No actual tool events needed -- the steering check only looks at finishReason.
mock.module("../../src/provider/fallback", () => ({
  Fallback: {
    async stream() {
      async function* fullStream() {
        yield { type: "start" }
        yield { type: "start-step" }

        if (streamScenario === "undefined-tool-calls") {
          yield {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read",
            input: { file: "foo.txt" },
          }
          yield {
            type: "tool-result",
            toolCallId: "call_1",
            input: { file: "foo.txt" },
            output: {
              title: "Read",
              metadata: {},
              output: "tool output",
            },
          }
          yield {
            type: "finish-step",
            usage: { inputTokens: 10, outputTokens: 5 },
            providerMetadata: {},
          }
          yield { type: "finish", finishReason: "stop" }
          return
        }

        if (streamScenario === "doom-loop") {
          for (let i = 1; i <= 3; i++) {
            const toolCallId = `call_${i}`
            const input = { file: "foo.txt" }
            yield {
              type: "tool-call",
              toolCallId,
              toolName: "read",
              input,
            }
            yield {
              type: "tool-result",
              toolCallId,
              input,
              output: {
                title: "Read",
                metadata: {},
                output: `tool output ${i}`,
              },
            }
          }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 5 },
            providerMetadata: {},
          }
          yield { type: "finish", finishReason: "stop" }
          return
        }

        yield {
          type: "finish-step",
          finishReason: "tool-calls",
          usage: { inputTokens: 10, outputTokens: 5 },
          providerMetadata: {},
        }
        // If we reach here, the stream was NOT broken by steering
        streamFinishStepReached = true
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
  mock.restore()
})

describe("SessionProcessor steering", () => {
  test("returns 'steered' when steering flag is set at tool-calls finish-step", async () => {
    streamScenario = "steering"
    streamFinishStepReached = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const user: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "zee",
          model: { providerID: "mock", modelID: "mock-model" },
        }
        await Session.updateMessage(user)

        const assistant: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          mode: "zee",
          agent: "zee",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "mock-model",
          providerID: "mock",
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistant)

        // Mark session for steering BEFORE processing starts.
        SessionSteering.mark(session.id, assistant.id)

        const { SessionProcessor } = await import("../../src/session/processor")
        const controller = new AbortController()
        const mockModel = {
          providerID: "mock",
          id: "mock-model",
          name: "mock-model",
          capabilities: { reasoning: false },
          api: { npm: "mock" },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 128000, output: 8192 },
        } as any
        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model: mockModel,
          abort: controller.signal,
        })

        const result = await processor.process({
          user,
          sessionID: session.id,
          model: mockModel,
          agent: { name: "zee" } as any,
          system: [],
          messages: [],
          tools: {},
          abort: controller.signal,
        })

        expect(result).toBe("steered")

        // Verify the assistant message was finalized without error
        expect(assistant.time.completed).toBeDefined()
        expect(assistant.error).toBeUndefined()

        // Verify the stream was exited early (second finish-step not reached)
        expect(streamFinishStepReached).toBe(false)

        // Clean up
        SessionSteering.clear(session.id, assistant.id)
      },
    })
  })

  test("infers tool-calls finish reason and persists tool parts when tool-input-start is missing", async () => {
    streamScenario = "undefined-tool-calls"
    streamFinishStepReached = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const user: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "zee",
          model: { providerID: "mock", modelID: "mock-model" },
        }
        await Session.updateMessage(user)

        const assistant: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          mode: "zee",
          agent: "zee",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "mock-model",
          providerID: "mock",
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistant)

        const { SessionProcessor } = await import("../../src/session/processor")
        const controller = new AbortController()
        const mockModel = {
          providerID: "mock",
          id: "mock-model",
          name: "mock-model",
          capabilities: { reasoning: false },
          api: { npm: "mock" },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 128000, output: 8192 },
        } as any
        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model: mockModel,
          abort: controller.signal,
        })

        const result = await processor.process({
          user,
          sessionID: session.id,
          model: mockModel,
          agent: { name: "zee" } as any,
          system: [],
          messages: [],
          tools: {},
          abort: controller.signal,
        })

        expect(result).toBe("continue")

        const stored = await MessageV2.get({ sessionID: session.id, messageID: assistant.id })
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role !== "assistant") throw new Error("Expected assistant message")
        expect(stored.info.finish).toBe("tool-calls")

        const parts = await MessageV2.parts(assistant.id)
        const toolPart = parts.find((part): part is MessageV2.ToolPart => part.type === "tool")
        expect(toolPart).toBeDefined()
        if (!toolPart) throw new Error("Expected tool part")
        expect(toolPart.state.status).toBe("completed")
      },
    })
  })

  test("doom-loop permission does not prompt in bypass mode", async () => {
    streamScenario = "doom-loop"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const askedPermissions: string[] = []

        const user: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "zee",
          model: { providerID: "mock", modelID: "mock-model" },
          mode: "bypass",
        }
        await Session.updateMessage(user)

        const assistant: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          mode: "zee",
          agent: "zee",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "mock-model",
          providerID: "mock",
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistant)

        const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, (event) => {
          if (event.properties.sessionID !== session.id) return
          askedPermissions.push(event.properties.permission)
        })

        try {
          const { SessionProcessor } = await import("../../src/session/processor")
          const controller = new AbortController()
          const mockModel = {
            providerID: "mock",
            id: "mock-model",
            name: "mock-model",
            capabilities: { reasoning: false },
            api: { npm: "mock" },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 128000, output: 8192 },
          } as any
          const processor = SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: session.id,
            model: mockModel,
            abort: controller.signal,
          })

          await processor.process({
            user,
            sessionID: session.id,
            model: mockModel,
            agent: { name: "zee" } as any,
            system: [],
            messages: [],
            tools: {},
            abort: controller.signal,
          })

          expect(askedPermissions).toHaveLength(0)
        } finally {
          unsubscribe()
        }
      },
    })
  })

})
