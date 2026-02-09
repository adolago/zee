import { describe, expect, test } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("app.agents endpoint", () => {
  test("returns agents with instance context from request", async () => {
    const app = Server.App()
    const response = await app.request(`/agent?directory=${encodeURIComponent(projectRoot)}`)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })
})
