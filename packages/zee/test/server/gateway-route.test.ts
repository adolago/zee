import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { FluxRecorder } from "../../src/flux"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

Log.init({ print: false })

describe("gateway routes", () => {
  const originalEnv = {
    ZEE_GATEWAY_URL: process.env.ZEE_GATEWAY_URL,
    ZEE_GATEWAY_PORT: process.env.ZEE_GATEWAY_PORT,
    ZEE_META_CLI_BIN: process.env.ZEE_META_CLI_BIN,
    ZEE_GATEWAY_TOKEN: process.env.ZEE_GATEWAY_TOKEN,
    ZEE_GATEWAY_PASSWORD: process.env.ZEE_GATEWAY_PASSWORD,
  }

  let gatewayServer: ReturnType<typeof Bun.serve> | null = null
  let lastSendParams: Record<string, unknown> | null = null
  let methodResponses: Record<
    string,
    {
      ok: boolean
      payload?: unknown
      error?: { code: string; message: string; details?: unknown }
    }
  > = {}
  let fakeMetaBinPath: string | null = null

  beforeAll(() => {
    gatewayServer = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req, { data: {} })) return
        return new Response("Not Found", { status: 404 })
      },
      websocket: {
        message(ws, message) {
          const raw = typeof message === "string" ? message : message.toString()
          const frame = JSON.parse(raw) as {
            type?: string
            id?: string
            method?: string
            params?: Record<string, unknown>
          }

          if (frame.type !== "req" || typeof frame.id !== "string" || typeof frame.method !== "string") return

          if (frame.method === "send") {
            lastSendParams = frame.params ?? null
          }

          const methodResponse = methodResponses[frame.method]
          if (methodResponse) {
            ws.send(
              JSON.stringify({
                type: "res",
                id: frame.id,
                ok: methodResponse.ok,
                ...(methodResponse.ok ? { payload: methodResponse.payload } : { error: methodResponse.error }),
              }),
            )
            return
          }

          ws.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "unknown", message: "unknown method" },
            }),
          )
        },
      },
    })

    process.env.ZEE_GATEWAY_URL = `ws://127.0.0.1:${gatewayServer.port}`
    delete process.env.ZEE_GATEWAY_PORT
  })

  afterAll(async () => {
    if (gatewayServer) gatewayServer.stop()
    gatewayServer = null
    lastSendParams = null

    if (originalEnv.ZEE_GATEWAY_URL === undefined) delete process.env.ZEE_GATEWAY_URL
    else process.env.ZEE_GATEWAY_URL = originalEnv.ZEE_GATEWAY_URL

    if (originalEnv.ZEE_GATEWAY_PORT === undefined) delete process.env.ZEE_GATEWAY_PORT
    else process.env.ZEE_GATEWAY_PORT = originalEnv.ZEE_GATEWAY_PORT

    if (originalEnv.ZEE_META_CLI_BIN === undefined) delete process.env.ZEE_META_CLI_BIN
    else process.env.ZEE_META_CLI_BIN = originalEnv.ZEE_META_CLI_BIN

    if (originalEnv.ZEE_GATEWAY_TOKEN === undefined) delete process.env.ZEE_GATEWAY_TOKEN
    else process.env.ZEE_GATEWAY_TOKEN = originalEnv.ZEE_GATEWAY_TOKEN

    if (originalEnv.ZEE_GATEWAY_PASSWORD === undefined) delete process.env.ZEE_GATEWAY_PASSWORD
    else process.env.ZEE_GATEWAY_PASSWORD = originalEnv.ZEE_GATEWAY_PASSWORD

    if (fakeMetaBinPath) {
      await fs.rm(fakeMetaBinPath, { force: true }).catch(() => {})
      fakeMetaBinPath = null
    }
  })

  beforeEach(() => {
    lastSendParams = null
    methodResponses = {
      connect: {
        ok: true,
        payload: { type: "hello-ok", protocol: 2 },
      },
      send: {
        ok: true,
        payload: { ok: true },
      },
      "skills.status": {
        ok: true,
        payload: {
          skills: [{ name: "home-assistant", status: "ready" }],
        },
      },
      "channels.status": {
        ok: true,
        payload: {
          channels: [{ name: "whatsapp", status: "connected" }],
        },
      },
      health: {
        ok: true,
        payload: { ok: true, uptimeMs: 1200 },
      },
      usage: {
        ok: true,
        payload: { sent: 12, received: 7 },
      },
    }
  })

  test("POST /gateway/whatsapp/send falls back to wacli when gateway is unavailable", async () => {
    const previousGatewayUrl = process.env.ZEE_GATEWAY_URL
    const previousWacliBin = process.env.ZEE_WACLI_BIN

    try {
      const before = FluxRecorder.list({ kind: "gateway.fallback.invoked" }).total
      process.env.ZEE_GATEWAY_URL = "ws://127.0.0.1:1"
      delete process.env.ZEE_GATEWAY_PORT

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wacli-fallback-"))
      fakeMetaBinPath = path.join(tmpDir, "wacli")
      await fs.writeFile(fakeMetaBinPath, "#!/usr/bin/env bash\nprintf '{\"success\":true,\"data\":{\"id\":\"test\",\"sent\":true}}\\n'\n", "utf8")
      await fs.chmod(fakeMetaBinPath, 0o755)
      process.env.ZEE_WACLI_BIN = fakeMetaBinPath

      const app = Server.App()
      const response = await app.request("/gateway/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: "15551234567", message: "fallback path" }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.provider).toBe("wacli")
      expect(Array.isArray(data.data.results)).toBe(true)
      expect(data.data.results.length).toBeGreaterThan(0)
      expect(FluxRecorder.list({ kind: "gateway.fallback.invoked" }).total).toBe(before + 1)
    } finally {
      if (previousGatewayUrl === undefined) delete process.env.ZEE_GATEWAY_URL
      else process.env.ZEE_GATEWAY_URL = previousGatewayUrl

      if (previousWacliBin === undefined) delete process.env.ZEE_WACLI_BIN
      else process.env.ZEE_WACLI_BIN = previousWacliBin
    }
  })

  test("POST /gateway/whatsapp/send uses Zee gateway RPC", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: "15551234567@c.us", message: "Hello" }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)

    expect(lastSendParams).not.toBeNull()
    expect(lastSendParams!.channel).toBe("whatsapp")
    expect(lastSendParams!.message).toBe("Hello")
    expect(lastSendParams!.to).toBe("15551234567")
  })

  test("POST /gateway/whatsapp/send propagates x-zee-agent-id to gateway send params", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/whatsapp/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-zee-agent-id": "ops.main-1",
      },
      body: JSON.stringify({ chatId: "15551234567@c.us", message: "Hello agent" }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)

    expect(lastSendParams).not.toBeNull()
    expect(lastSendParams!.agentId).toBe("ops.main-1")
  })

  // -------------------------------------------------------------------------
  // Inbound — meta-cli webhook forward
  // -------------------------------------------------------------------------

  test("POST /gateway/whatsapp/inbound accepts valid message", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/whatsapp/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "wamid.abc123",
        senderId: "15559876543",
        senderName: "Test User",
        body: "Hello from WhatsApp",
        timestamp: Date.now(),
        isGroup: false,
        platform: "whatsapp",
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  test("POST /gateway/whatsapp/inbound accepts message with media", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/whatsapp/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "wamid.media456",
        senderId: "15559876543",
        body: "Check this photo",
        timestamp: Date.now(),
        isGroup: false,
        platform: "whatsapp",
        media: [{ mediaId: "media_123", mimeType: "image/jpeg" }],
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  test("POST /gateway/whatsapp/inbound rejects invalid payload", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/whatsapp/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invalid: true }),
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
  })

  test("POST /gateway/whatsapp/inbound rejects non-JSON body", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/whatsapp/inbound", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
  })

  test("GET /gateway/skills bridges to skills.status", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/skills")

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.data).toEqual({
      skills: [{ name: "home-assistant", status: "ready" }],
    })
  })

  test("GET /gateway/channels/status bridges to channels.status", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/channels/status")

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.data).toEqual({
      channels: [{ name: "whatsapp", status: "connected" }],
    })
  })

  test("GET /gateway/status bridges to health", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/status")

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.data).toEqual({ ok: true, uptimeMs: 1200 })
  })

  test("GET /gateway/usage bridges to usage", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/usage")

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.data).toEqual({ sent: 12, received: 7 })
  })

  test("GET /gateway/usage returns 500 when usage method fails", async () => {
    methodResponses.usage = {
      ok: false,
      error: { code: "downstream_error", message: "usage unavailable" },
    }

    const app = Server.App()
    const response = await app.request("/gateway/usage")

    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain("usage unavailable")
  })

  test("POST /gateway/whatsapp/send requires gateway auth when secret is configured", async () => {
    const previousToken = process.env.ZEE_GATEWAY_TOKEN
    try {
      process.env.ZEE_GATEWAY_TOKEN = "gw-secret"
      const app = Server.App()

      const denied = await app.request("/gateway/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: "15551234567@c.us", message: "Hello" }),
      })
      expect(denied.status).toBe(401)

      const allowed = await app.request("/gateway/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-zee-gateway-token": "gw-secret",
        },
        body: JSON.stringify({ chatId: "15551234567@c.us", message: "Hello" }),
      })
      expect(allowed.status).toBe(200)
    } finally {
      if (previousToken === undefined) delete process.env.ZEE_GATEWAY_TOKEN
      else process.env.ZEE_GATEWAY_TOKEN = previousToken
    }
  })

  test("GET /gateway/status requires gateway auth for browser-originated requests when secret is configured", async () => {
    const previousToken = process.env.ZEE_GATEWAY_TOKEN
    try {
      process.env.ZEE_GATEWAY_TOKEN = "gw-secret"
      const app = Server.App()

      const denied = await app.request("/gateway/status", {
        method: "GET",
        headers: { Origin: "http://localhost:5173" },
      })
      expect(denied.status).toBe(401)

      const allowed = await app.request("/gateway/status", {
        method: "GET",
        headers: {
          Origin: "http://localhost:5173",
          Authorization: "Bearer gw-secret",
        },
      })
      expect(allowed.status).toBe(200)
    } finally {
      if (previousToken === undefined) delete process.env.ZEE_GATEWAY_TOKEN
      else process.env.ZEE_GATEWAY_TOKEN = previousToken
    }
  })

  test("gateway auth does not accept token query parameters", async () => {
    const previousToken = process.env.ZEE_GATEWAY_TOKEN
    try {
      process.env.ZEE_GATEWAY_TOKEN = "gw-secret"
      const app = Server.App()

      const denied = await app.request("/gateway/status?token=gw-secret", {
        method: "GET",
        headers: { Origin: "http://localhost:5173" },
      })
      expect(denied.status).toBe(401)

      const deniedAlt = await app.request("/gateway/status?x-zee-gateway-token=gw-secret", {
        method: "GET",
        headers: { Origin: "http://localhost:5173" },
      })
      expect(deniedAlt.status).toBe(401)
    } finally {
      if (previousToken === undefined) delete process.env.ZEE_GATEWAY_TOKEN
      else process.env.ZEE_GATEWAY_TOKEN = previousToken
    }
  })

  test("gateway routes reject invalid x-zee-agent-id header", async () => {
    const app = Server.App()
    const response = await app.request("/gateway/status", {
      headers: {
        "x-zee-agent-id": "bad value with space",
      },
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain("x-zee-agent-id")
  })
})
