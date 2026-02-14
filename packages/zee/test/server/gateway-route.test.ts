import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

Log.init({ print: false })

describe("gateway routes", () => {
  const originalEnv = {
    ZEE_GATEWAY_URL: process.env.ZEE_GATEWAY_URL,
    ZEE_GATEWAY_PORT: process.env.ZEE_GATEWAY_PORT,
  }

  let gatewayServer: ReturnType<typeof Bun.serve> | null = null
  let lastSendParams: Record<string, unknown> | null = null

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

          if (frame.method === "connect") {
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { type: "hello-ok", protocol: 2 } }))
            return
          }

          if (frame.method === "send") {
            lastSendParams = frame.params ?? null
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { ok: true } }))
            return
          }

          ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: { code: "unknown", message: "unknown method" } }))
        },
      },
    })

    process.env.ZEE_GATEWAY_URL = `ws://127.0.0.1:${gatewayServer.port}`
    delete process.env.ZEE_GATEWAY_PORT
  })

  afterAll(() => {
    if (gatewayServer) gatewayServer.stop()
    gatewayServer = null
    lastSendParams = null

    if (originalEnv.ZEE_GATEWAY_URL === undefined) delete process.env.ZEE_GATEWAY_URL
    else process.env.ZEE_GATEWAY_URL = originalEnv.ZEE_GATEWAY_URL

    if (originalEnv.ZEE_GATEWAY_PORT === undefined) delete process.env.ZEE_GATEWAY_PORT
    else process.env.ZEE_GATEWAY_PORT = originalEnv.ZEE_GATEWAY_PORT
  })

  beforeEach(() => {
    lastSendParams = null
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

})
