import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { Server } from "../../src/server/server"

function basicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf-8").toString("base64")
  return `Basic ${token}`
}

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_USERNAME: process.env.ZEE_SERVER_USERNAME,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
  ZEE_SERVER_SCOPES: process.env.ZEE_SERVER_SCOPES,
}

beforeAll(() => {
  process.env.ZEE_ENABLE_SERVER_AUTH = "1"
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  delete process.env.ZEE_SERVER_USERNAME
  process.env.ZEE_SERVER_PASSWORD = "test-password"
  process.env.ZEE_SERVER_SCOPES = "operator.read"
  reloadFlags()
  Server.App.reset()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  Server.App.reset()
})

describe("HTTP auth and scopes", () => {
  test("returns 401 when auth is enabled but Authorization header is missing", async () => {
    const app = Server.App()
    const res = await app.request("/global/health", { method: "GET" })
    expect(res.status).toBe(401)
  })

  test("returns 401 for liveness endpoint when auth header is missing", async () => {
    const app = Server.App()
    const res = await app.request("/global/health/live", { method: "GET" })
    expect(res.status).toBe(401)
  })

  test("allows read-only scopes to access read endpoints", async () => {
    const app = Server.App()
    const res = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(200)
  })

  test("allows read-only scopes to access liveness endpoint", async () => {
    const app = Server.App()
    const res = await app.request("/global/health/live", {
      method: "GET",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(200)
  })

  test("forbids non-admin scopes from accessing admin endpoints (POST /pty)", async () => {
    const app = Server.App()
    const res = await app.request("/pty", {
      method: "POST",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  test("forbids non-admin scopes from listing cached instances (GET /global/instances)", async () => {
    const app = Server.App()
    const res = await app.request("/global/instances", {
      method: "GET",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(403)
  })

  test("forbids non-admin scopes from disposing instances (POST /instance/dispose)", async () => {
    const app = Server.App()
    const res = await app.request("/instance/dispose", {
      method: "POST",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(403)
  })

  test("forbids non-admin scopes from global dispose (POST /global/dispose)", async () => {
    const app = Server.App()
    const res = await app.request("/global/dispose", {
      method: "POST",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(403)
  })
})
