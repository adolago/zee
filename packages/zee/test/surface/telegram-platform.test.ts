import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { TelegramPlatformHandler } from "../../src/surface/platforms/telegram"

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition")
    }
    await Bun.sleep(20)
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("telegram platform polling recovery", () => {
  test("recovers from transient polling failures and resumes inbound delivery", async () => {
    let getUpdatesCalls = 0
    const nowSec = Math.floor(Date.now() / 1000)

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.endsWith("/getMe")) {
        return jsonResponse({ ok: true, result: { username: "zee_test_bot" } })
      }

      if (url.endsWith("/getUpdates")) {
        getUpdatesCalls += 1
        if (getUpdatesCalls <= 2) {
          throw new Error(`simulated outage ${getUpdatesCalls}`)
        }
        if (getUpdatesCalls === 3) {
          return jsonResponse({
            ok: true,
            result: [
              {
                update_id: 1001,
                message: {
                  message_id: 42,
                  date: nowSec,
                  text: "Recovered from outage",
                  from: { id: 123, first_name: "Ops" },
                  chat: { id: 123, type: "private" },
                },
              },
            ],
          })
        }
        return jsonResponse({ ok: true, result: [] })
      }

      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    const handler = new TelegramPlatformHandler({
      token: "test-token",
      pollTimeoutSec: 1,
      mediaDir: path.join(tmp.path, "media"),
      stateFile: path.join(tmp.path, "telegram-state.json"),
    })

    const inbound: Array<{ body: string; senderId: string }> = []
    const unsubscribe = handler.onMessage((msg) => {
      inbound.push({ body: msg.body, senderId: msg.senderId })
    })

    try {
      await handler.connect()
      await waitFor(() => inbound.length > 0, 7000)
    } finally {
      unsubscribe()
      await handler.disconnect()
    }

    expect(getUpdatesCalls).toBeGreaterThanOrEqual(3)
    expect(inbound).toEqual([{ body: "Recovered from outage", senderId: "123" }])
  })
})

