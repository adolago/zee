import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
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

beforeEach(() => {
  process.env.ZEE_ENABLE_SERVER_AUTH = "1"
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  delete process.env.ZEE_SERVER_USERNAME
  process.env.ZEE_SERVER_PASSWORD = "test-password"
  reloadFlags()
  Server.reset()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  Server.reset()
})

describe("flux route scopes", () => {
  test("denies read-only scope for flux endpoints", async () => {
    process.env.ZEE_SERVER_SCOPES = "operator.read"
    reloadFlags()
    const app = Server.App()
    const res = await app.request("/v1/flux/schema", {
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(403)
  })

  test("allows observe scope for flux endpoints", async () => {
    process.env.ZEE_SERVER_SCOPES = "operator.observe"
    reloadFlags()
    const before = FluxRecorder.list({ kind: "auth.scope.checked" }).total
    const app = Server.App()
    const res = await app.request("/v1/flux/schema", {
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(200)
    expect(FluxRecorder.list({ kind: "auth.scope.checked" }).total).toBe(before + 1)
  })

  test("emits fallback telemetry when a control-plane prefix misses the explicit matrix", async () => {
    process.env.ZEE_SERVER_SCOPES = "operator.admin"
    reloadFlags()
    const before = FluxRecorder.list({ kind: "auth.scope.fallback" }).total
    const app = Server.App()
    const res = await app.request("/global/not-real", {
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(res.status).toBe(404)
    expect(FluxRecorder.list({ kind: "auth.scope.fallback" }).total).toBe(before + 1)
  })
})
