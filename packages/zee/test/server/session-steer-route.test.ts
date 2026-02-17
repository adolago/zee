import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSteering } from "../../src/session/steering"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.steer route", () => {
  test("accepts steer only when expectedTurnID matches active turn", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})
        const activeTurnID = "turn_active_test"
        SessionStatus.set(session.id, { type: "busy", activeTurnID })

        const response = await app.request(`/session/${session.id}/steer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedTurnID: activeTurnID,
            parts: [{ type: "text", text: "steer now" }],
          }),
        })

        expect(response.status).toBe(204)
        expect(SessionSteering.check(session.id, activeTurnID)).toBe(true)
        SessionSteering.clear(session.id, activeTurnID)
        SessionStatus.set(session.id, { type: "idle" })
      },
    })
  })

  test("rejects steer when there is no active turn", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
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
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
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
