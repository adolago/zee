import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { SessionRoute } from "../../src/server/route/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const model: Provider.Model = {
  id: "note-model",
  providerID: "zee",
  api: {
    id: "note-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Note Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: false,
    streaming: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

describe("session.note route", () => {
  test("appends a persisted ignored user note and emits message events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        let messageUpdated = 0
        let partUpdated = 0
        const unsubMessage = Bus.subscribe(MessageV2.Event.Updated, () => {
          messageUpdated += 1
        })
        const unsubPart = Bus.subscribe(MessageV2.Event.PartUpdated, () => {
          partUpdated += 1
        })

        try {
          const response = await SessionRoute.request(`/session/${session.id}/note`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              role: "user",
              text: "Benchmark: openai/gpt-5.4",
              ignored: true,
              metadata: { kind: "benchmark" },
            }),
          })

          expect(response.status).toBe(200)
          const body = await response.json()
          expect(body.info.role).toBe("user")
          expect(body.parts).toHaveLength(1)
          expect(body.parts[0].type).toBe("text")
          expect(body.parts[0].ignored).toBe(true)
          expect(body.parts[0].metadata).toEqual({ kind: "benchmark" })

          const messages = await Session.messages({ sessionID: session.id })
          expect(messages).toHaveLength(1)
          expect(messages[0]?.info.role).toBe("user")
          expect(messages[0]?.parts[0]).toMatchObject({
            type: "text",
            text: "Benchmark: openai/gpt-5.4",
            ignored: true,
          })

          expect(await MessageV2.toModelMessage(messages, model)).toEqual([])
          expect(messageUpdated).toBe(1)
          expect(partUpdated).toBe(1)
        } finally {
          unsubMessage()
          unsubPart()
        }
      },
    })
  })

  test("supports assistant notes when the session already has a message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await SessionRoute.request(`/session/${session.id}/note`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: "user",
            text: "Seed note",
          }),
        })

        const response = await SessionRoute.request(`/session/${session.id}/note`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: "assistant",
            text: "Assistant benchmark note",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.info.role).toBe("assistant")
        expect(body.parts[0].text).toBe("Assistant benchmark note")
      },
    })
  })
})
