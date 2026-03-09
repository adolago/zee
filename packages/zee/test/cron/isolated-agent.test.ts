import { afterEach, describe, expect, test } from "bun:test"
import { runIsolatedAgentJob } from "../../src/cron/isolated-agent"
import type { CronJob } from "../../src/cron/types"

const originalFetch = globalThis.fetch

function makeJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    name: "isolated",
    enabled: true,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: {
      kind: "agentTurn",
      message: "run",
      model: "openai/gpt-5",
      agent: "zee",
    },
    state: { nextRunAtMs: 500 },
    ...overrides,
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("runIsolatedAgentJob", () => {
  test("sends PromptInput-compatible payload and extracts text parts", async () => {
    const job = makeJob()
    const calls: Array<{ url: string; body: any }> = []

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, body })

      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "ses_1" }), { status: 200 })
      }
      if (url.endsWith("/session/ses_1/message")) {
        return new Response(
          JSON.stringify({
            info: {},
            parts: [
              { type: "text", text: "  hello  " },
              { type: "text", text: "ignored", synthetic: true },
              { type: "text", text: "ignored", ignored: true },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const result = await runIsolatedAgentJob({
      job,
      message: "do the thing",
      serverUrl: "http://127.0.0.1:3210",
    })

    expect(result.status).toBe("ok")
    expect(result.outputText).toBe("hello")

    const messageCall = calls.find((call) => call.url.endsWith("/session/ses_1/message"))
    expect(messageCall).toBeDefined()
    expect(messageCall?.body?.parts).toEqual([{ type: "text", text: "do the thing" }])
    expect(messageCall?.body?.options?.senderId).toBe("cron")
    expect(messageCall?.body?.agent).toBe("zee")
    expect(messageCall?.body?.model).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  test("omits invalid model override formats", async () => {
    const job = makeJob({
      payload: {
        kind: "agentTurn",
        message: "run",
        model: "gpt-5",
        agent: "zee",
      },
    })
    let messageBody: any

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "ses_1" }), { status: 200 })
      }
      if (url.endsWith("/session/ses_1/message")) {
        messageBody = init?.body ? JSON.parse(String(init.body)) : undefined
        return new Response(JSON.stringify({ info: {}, parts: [] }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const result = await runIsolatedAgentJob({
      job,
      message: "do the thing",
      serverUrl: "http://127.0.0.1:3210",
    })

    expect(result.status).toBe("ok")
    expect(messageBody.model).toBeUndefined()
  })
})
