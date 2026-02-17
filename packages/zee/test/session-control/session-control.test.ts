import path from "node:path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { SessionStatus } from "../../src/session/status"
import { SessionSteering } from "../../src/session/steering"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionControlClient, SessionControlError } from "../../src/session-control/client"
import { SessionControlServer } from "../../src/session-control/server"
import { getSessionControlDir } from "../../src/session-control/path"
import { reloadFlags } from "../../src/flag/flag"
import * as PromptModule from "../../src/session/prompt"

process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "true"

const originalStateDir = process.env.ZEE_STATE_DIR
const originalSessionControl = process.env.ZEE_SESSION_CONTROL

afterEach(async () => {
  mock.restore()
  await SessionControlServer.stopAll()
  if (originalStateDir === undefined) delete process.env.ZEE_STATE_DIR
  else process.env.ZEE_STATE_DIR = originalStateDir

  if (originalSessionControl === undefined) delete process.env.ZEE_SESSION_CONTROL
  else process.env.ZEE_SESSION_CONTROL = originalSessionControl

  reloadFlags()
})

async function seedAssistantText(sessionID: string, text: string): Promise<void> {
  const user: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "zee",
    model: { providerID: "mock", modelID: "mock-model" },
  }
  await Session.updateMessage(user)

  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    parentID: user.id,
    sessionID,
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
    time: { created: Date.now(), completed: Date.now() },
  }
  await Session.updateMessage(assistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: assistant.id,
    type: "text",
    text,
  })
}

describe("session-control", () => {
  test("send steer resolves alias and marks steering", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promptSpy = spyOn(PromptModule.SessionPrompt, "prompt").mockResolvedValue({} as any)

        const session = await Session.create({ title: "Alpha Session" })
        await SessionControlServer.start(session)
        SessionStatus.set(session.id, { type: "busy", activeTurnID: "turn-1" })

        const result = await SessionControlClient.send({
          sessionName: session.slug,
          message: "Interrupt this turn",
          mode: "steer",
          expectedTurnID: "turn-1",
          senderInfo: {
            sessionID: "sender-session",
            sessionName: "sender-name",
          },
        })

        expect(result.delivered).toBe(true)
        expect(result.mode).toBe("steer")
        expect(SessionSteering.check(session.id, "turn-1")).toBe(true)
        expect(promptSpy).toHaveBeenCalledTimes(1)
        expect(promptSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionID: session.id,
            noReply: true,
          }),
        )
        const sendText = (promptSpy.mock.calls[0]?.[0] as any)?.parts?.[0]?.text as string
        expect(sendText).toContain("<sender_info>")
        expect(sendText).toContain('"sessionID":"sender-session"')
        expect(sendText).toContain('"sessionName":"sender-name"')

        SessionSteering.clear(session.id)
      },
    })
  })

  test("send wait_until turn_end waits and returns last assistant message", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Wait Session" })
        await seedAssistantText(session.id, "Latest assistant output")
        await SessionControlServer.start(session)

        SessionStatus.set(session.id, { type: "busy", activeTurnID: "turn-wait" })
        const promptSpy = spyOn(PromptModule.SessionPrompt, "prompt").mockImplementation(async () => {
          SessionStatus.set(session.id, { type: "idle" })
          return {} as any
        })

        const result = await SessionControlClient.send({
          sessionID: session.id,
          message: "Wrap up now",
          mode: "steer",
          expectedTurnID: "turn-wait",
          waitUntil: "turn_end",
          waitTimeoutMs: 2_000,
          pollIntervalMs: 25,
        })

        expect(result.waitUntil).toBe("turn_end")
        expect(result.message?.text).toBe("Latest assistant output")
        expect(promptSpy).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("get_message returns most recent assistant message", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Message Session" })
        await seedAssistantText(session.id, "Hello from assistant")
        await SessionControlServer.start(session)

        const result = await SessionControlClient.getMessage({
          sessionName: session.slug,
        })

        expect(result.message).toBeDefined()
        expect(result.message?.text).toBe("Hello from assistant")
      },
    })
  })

  test("get_summary returns compact handoff summary", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Summary Session" })
        await seedAssistantText(session.id, "Summary assistant output")
        await SessionControlServer.start(session)

        const result = await SessionControlClient.getSummary({
          sessionID: session.id,
        })

        expect(result.summary).toContain("[Handoff Context")
        expect(result.summary).toContain("Assistant: Summary assistant output")
      },
    })
  })

  test("clear removes all messages and parts from target session", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Clear Session" })
        await seedAssistantText(session.id, "to be cleared")
        await SessionControlServer.start(session)

        const result = await SessionControlClient.clear({
          sessionID: session.id,
        })

        expect(result.cleared).toBe(true)
        expect(result.removedMessages).toBe(2)
        expect(result.removedParts).toBe(1)

        const messages = await Session.messages({ sessionID: session.id })
        expect(messages).toHaveLength(0)
      },
    })
  })

  test("abort proxies SessionPrompt.cancel", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Abort Session" })
        await SessionControlServer.start(session)

        const cancelSpy = spyOn(PromptModule.SessionPrompt, "cancel").mockImplementation(() => {})

        const result = await SessionControlClient.abort({
          sessionID: session.id,
        })

        expect(result.aborted).toBe(true)
        expect(cancelSpy).toHaveBeenCalledTimes(1)
        expect(cancelSpy).toHaveBeenCalledWith(session.id)
      },
    })
  })

  test("send steer rejects stale expected turn id", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promptSpy = spyOn(PromptModule.SessionPrompt, "prompt").mockResolvedValue({} as any)

        const session = await Session.create({ title: "Beta Session" })
        await SessionControlServer.start(session)
        SessionStatus.set(session.id, { type: "busy", activeTurnID: "turn-live" })

        let caught: unknown
        try {
          await SessionControlClient.send({
            sessionID: session.id,
            message: "Old steer",
            mode: "steer",
            expectedTurnID: "turn-stale",
          })
        } catch (error) {
          caught = error
        }

        expect(caught).toBeInstanceOf(SessionControlError)
        expect((caught as SessionControlError).data).toEqual({ activeTurnID: "turn-live" })
        expect(promptSpy).toHaveBeenCalledTimes(0)
      },
    })
  })

  test("list returns only live sockets with aliases", async () => {
    await using tmp = await tmpdir()
    process.env.ZEE_STATE_DIR = path.join(tmp.path, "state")
    process.env.ZEE_SESSION_CONTROL = "1"
    reloadFlags()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await Session.create({ title: "Gamma Session" })
        const second = await Session.create({ title: "Delta Session" })
        await SessionControlServer.start(first)
        await SessionControlServer.start(second)

        const controlDir = getSessionControlDir()
        await Bun.write(path.join(controlDir, "stale.sock"), "stale")

        const sessions = await SessionControlClient.list()

        const firstEntry = sessions.find((x) => x.sessionID === first.id)
        const secondEntry = sessions.find((x) => x.sessionID === second.id)
        expect(firstEntry).toBeDefined()
        expect(secondEntry).toBeDefined()
        expect(firstEntry?.aliases).toContain(first.slug)
        expect(secondEntry?.aliases).toContain(second.slug)
        expect(sessions.some((x) => x.sessionID === "stale")).toBe(false)
      },
    })
  })
})
