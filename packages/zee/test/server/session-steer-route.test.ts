import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SessionRoute } from "../../src/server/route/session"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSteering } from "../../src/session/steering"
import { Log } from "../../src/util/log"

Log.init({ print: false })
const testDirectory = process.cwd()

async function assertSteerAcceptedWithRetry(
  app: typeof SessionRoute,
  sessionID: string,
  expectedTurnID: string,
  maxAttempts = 3,
) {
  let attempt = 0
  while (attempt < maxAttempts) {
    const response = await app.request(`/session/${sessionID}/steer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedTurnID,
        parts: [{ type: "text", text: "steer now" }],
      }),
    })

    if (response.status === 204) return

    const body = await response.text()
    const retriable = response.status === 500 || (response.status === 400 && body.includes("No active turn to steer."))

    if (!retriable || attempt >= maxAttempts - 1) {
      throw new Error(`unexpected steer status ${response.status}: ${body}`)
    }
    attempt++
    continue
  }

  throw new Error("unreachable")
}

describe("session.steer route", () => {
  test("accepts steer only when expectedTurnID matches active turn", async () => {
    await Instance.provide({
      directory: testDirectory,
      fn: async () => {
        const app = SessionRoute
        const session = await Session.create({})
        const activeTurnID = "turn_active_test"
        SessionStatus.set(session.id, { type: "busy", activeTurnID })

        await assertSteerAcceptedWithRetry(app, session.id, activeTurnID)
        expect(SessionSteering.check(session.id, activeTurnID)).toBe(true)
        SessionSteering.clear(session.id, activeTurnID)
        SessionStatus.set(session.id, { type: "idle" })
      },
    })
  })

  test("rejects steer when there is no active turn", async () => {
    await Instance.provide({
      directory: testDirectory,
      fn: async () => {
        const app = SessionRoute
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedTurnID: "turn_missing",
            parts: [{ type: "text", text: "steer now" }],
          }),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  test("rejects steer when expectedTurnID does not match active turn", async () => {
    await Instance.provide({
      directory: testDirectory,
      fn: async () => {
        const app = SessionRoute
        const session = await Session.create({})
        SessionStatus.set(session.id, { type: "busy", activeTurnID: "turn_actual" })

        const response = await app.request(`/session/${session.id}/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedTurnID: "turn_other",
            parts: [{ type: "text", text: "steer now" }],
          }),
        })

        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body.activeTurnID).toBe("turn_actual")
        SessionStatus.set(session.id, { type: "idle" })
      },
    })
  })
})
