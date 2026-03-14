import { afterAll, describe, expect, mock, test } from "bun:test"
import { Bus } from "../../src/bus"
import { reloadFlags } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { tmpdir } from "../fixture/fixture"

process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL = "true"

const ORIGINAL_ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ZEE_LLM_STREAM_START_TIMEOUT_MS: process.env.ZEE_LLM_STREAM_START_TIMEOUT_MS,
  ZEE_SESSION_FORCE_KILL_GRACE_PERIOD_MS: process.env.ZEE_SESSION_FORCE_KILL_GRACE_PERIOD_MS,
}

mock.module("../../src/provider/fallback", () => ({
  Fallback: {
    async stream() {
      async function* fullStream() {
        yield { type: "start" }
        await new Promise<void>(() => {})
      }
      return { fullStream: fullStream() }
    },
  },
}))

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  mock.restore()
})

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

describe("SessionPrompt force-kill timer", () => {
  test("does not force-kill a restarted run with a stale timer", async () => {
    process.env.OPENAI_API_KEY = "test-key"
    process.env.ZEE_LLM_STREAM_START_TIMEOUT_MS = "5000"
    process.env.ZEE_SESSION_FORCE_KILL_GRACE_PERIOD_MS = "100"
    reloadFlags()

    await using tmp = await tmpdir({
      git: true,
      config: {
        memory: { required: false },
      } as any,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.update(session.id, (draft) => {
          draft.title = "Force Kill Regression"
        })
        const errorMessages: string[] = []
        const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
          const message = (event.properties.error as { message?: unknown })?.message
          if (typeof message === "string") {
            errorMessages.push(message)
          }
        })

        try {
          const firstRun = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "zee",
            model: { providerID: "openai", modelID: "gpt-5.4" },
            tools: {},
            parts: [{ type: "text", text: "first run" }],
          }).catch((error) => error)
          await waitFor(() => SessionStatus.get(session.id).type === "busy", 1500, "first run to be busy")

          SessionPrompt.cancel(session.id)
          await waitFor(() => SessionStatus.get(session.id).type === "idle", 1500, "first run to be idle")

          const secondRun = SessionPrompt.prompt({
            sessionID: session.id,
            agent: "zee",
            model: { providerID: "openai", modelID: "gpt-5.4" },
            tools: {},
            parts: [{ type: "text", text: "second run" }],
          }).catch((error) => error)
          await waitFor(() => SessionStatus.get(session.id).type === "busy", 1500, "second run to be busy")

          await Bun.sleep(250)

          expect(errorMessages).not.toContain("Session force-killed after timeout grace period")
          expect(SessionStatus.get(session.id).type).toBe("busy")

          SessionPrompt.cancel(session.id)
          await waitFor(() => SessionStatus.get(session.id).type === "idle", 1500, "second run to be idle")

          await Promise.all([firstRun, secondRun])
        } finally {
          unsubscribe()
          SessionPrompt.cancel(session.id)
        }
      },
    })
  })
})
