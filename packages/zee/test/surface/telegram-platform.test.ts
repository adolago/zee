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

  test("normalizes thread routing for DM topics and forum/non-forum groups", async () => {
    let getUpdatesCalls = 0
    const nowSec = Math.floor(Date.now() / 1000)

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.endsWith("/getMe")) {
        return jsonResponse({ ok: true, result: { username: "zee_test_bot" } })
      }

      if (url.endsWith("/getUpdates")) {
        getUpdatesCalls += 1
        if (getUpdatesCalls === 1) {
          return jsonResponse({
            ok: true,
            result: [
              {
                update_id: 2001,
                message: {
                  message_id: 101,
                  date: nowSec,
                  text: "dm topic message",
                  message_thread_id: 7,
                  from: { id: 700, first_name: "Alice" },
                  chat: { id: 700, type: "private" },
                },
              },
              {
                update_id: 2002,
                message: {
                  message_id: 102,
                  date: nowSec,
                  text: "non forum group reply thread",
                  message_thread_id: 42,
                  from: { id: 701, first_name: "Bob" },
                  chat: { id: -100100, type: "supergroup", title: "General Group" },
                },
              },
              {
                update_id: 2003,
                message: {
                  message_id: 103,
                  date: nowSec,
                  text: "forum topic message",
                  message_thread_id: 99,
                  from: { id: 702, first_name: "Carla" },
                  chat: { id: -100200, type: "supergroup", is_forum: true, title: "Forum Group" },
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

    const inbound: Array<{ id: string; isGroup: boolean; groupId?: string; threadId?: string }> = []
    const unsubscribe = handler.onMessage((msg) => {
      inbound.push({
        id: msg.id,
        isGroup: msg.isGroup,
        groupId: msg.groupId,
        threadId: msg.threadId,
      })
    })

    try {
      await handler.connect()
      await waitFor(() => inbound.length === 3, 7000)
    } finally {
      unsubscribe()
      await handler.disconnect()
    }

    expect(inbound[0]).toEqual({
      id: "101",
      isGroup: false,
      groupId: undefined,
      threadId: "700:topic:7",
    })
    expect(inbound[1]).toEqual({
      id: "102",
      isGroup: true,
      groupId: "-100100",
      threadId: "-100100",
    })
    expect(inbound[2]).toEqual({
      id: "103",
      isGroup: true,
      groupId: "-100200:topic:99",
      threadId: "-100200:topic:99",
    })
  })
})
