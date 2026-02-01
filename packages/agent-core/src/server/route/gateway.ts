import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Log } from "../../util/log"
import {
  formatForSurface,
  WHATSAPP_CAPABILITIES,
  TELEGRAM_CAPABILITIES,
} from "../../surface/types"
import type { SurfaceCapabilities } from "../../surface/types"

const log = Log.create({ service: "server:gateway" })

const GatewayResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  data: z.unknown().optional(),
})

type GatewayResponse = z.infer<typeof GatewayResponseSchema>

const WhatsAppSendInput = z.object({
  chatId: z.string().optional(),
  to: z.string().optional(),
  message: z.string(),
  mediaUrl: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  gifPlayback: z.boolean().optional(),
  accountId: z.string().optional(),
  account: z.string().optional(),  // Alias for accountId (backward compatibility)
})

const TelegramSendInput = z.object({
  chatId: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
  message: z.string(),
  persona: z.enum(["zee", "stanley", "johny"]).optional(),
})

type GatewayRequestFrame = {
  type: "req"
  id: string
  method: string
  params?: unknown
}

type GatewayResponseFrame = {
  type: "res"
  id: string
  ok: boolean
  payload?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

const PROTOCOL_VERSION = 3
const DEFAULT_GATEWAY_PORT = 18789
const DEFAULT_GATEWAY_SEND_TIMEOUT_MS = 20_000

function resolveGatewayWsUrl(): string {
  const urlOverride = process.env.ZEE_GATEWAY_URL?.trim()
  if (urlOverride) return urlOverride

  const portRaw = Number.parseInt(process.env.ZEE_GATEWAY_PORT ?? "", 10)
  const port = Number.isFinite(portRaw) ? portRaw : DEFAULT_GATEWAY_PORT
  return `ws://127.0.0.1:${port}`
}

function normalizeWhatsAppRecipient(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error("chatId is required")

  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "").trim()
  const dmMatch = /^(\+?\d+)(?::\d+)?@c\.us$/i.exec(withoutPrefix)
  if (dmMatch?.[1]) return dmMatch[1]

  const waMatch = /^(\+?\d+)(?::\d+)?@s\.whatsapp\.net$/i.exec(withoutPrefix)
  if (waMatch?.[1]) return waMatch[1]

  return withoutPrefix
}

function parseGatewayResponseFrame(raw: unknown): GatewayResponseFrame | null {
  if (!raw || typeof raw !== "object") return null
  const frame = raw as Record<string, unknown>
  if (frame.type !== "res") return null
  if (typeof frame.id !== "string") return null
  if (typeof frame.ok !== "boolean") return null

  const error =
    frame.error && typeof frame.error === "object"
      ? (frame.error as Record<string, unknown>)
      : undefined

  return {
    type: "res",
    id: frame.id,
    ok: frame.ok,
    payload: frame.payload,
    error:
      error && typeof error.code === "string" && typeof error.message === "string"
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        : undefined,
  }
}

async function callGateway<T = unknown>(
  method: string,
  params?: unknown,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  log.debug("callGateway started", { method })
  const url = resolveGatewayWsUrl()
  const timeoutMs = options.timeoutMs ?? 10_000

  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim()
  let fileToken = ""
  try {
    const fs = await import("node:fs")
    fileToken = fs.readFileSync("/tmp/zee_gateway_token", "utf-8").trim()
  } catch {
    fileToken = ""
  }
  // Use env var or fallback to file
  const token = envToken || fileToken || undefined
  log.debug("Gateway auth", { hasEnvToken: !!envToken, hasFileToken: !!fileToken, hasToken: !!token })
  const password = process.env.ZEE_GATEWAY_PASSWORD?.trim() || undefined
  const auth = token || password ? { ...(token ? { token } : {}), ...(password ? { password } : {}) } : undefined

  const connectParams = {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: "cli",
      displayName: "agent-core",
      version: process.env.AGENT_CORE_VERSION?.trim() || "dev",
      platform: process.platform,
      mode: "backend",
    },
    caps: [],
    ...(auth ? { auth } : {}),
  }

  const connectId = crypto.randomUUID()
  const requestId = crypto.randomUUID()

  return await new Promise<T>((resolve, reject) => {
    let settled = false
    let stage: "connect" | "request" = "connect"

    const ws = new WebSocket(url)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch (error) {
        log.debug("Gateway websocket close failed", { error, stage: "timeout" })
      }
      reject(new Error(`Gateway timeout after ${timeoutMs}ms (${url})`))
    }, timeoutMs)

    const stop = (err?: Error, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch (error) {
        log.debug("Gateway websocket close failed", { error, stage: "cleanup" })
      }
      if (err) reject(err)
      else resolve(value as T)
    }

    ws.addEventListener("open", () => {
    
      const frame: GatewayRequestFrame = {
        type: "req",
        id: connectId,
        method: "connect",
        params: connectParams,
      }
      ws.send(JSON.stringify(frame))
    })

    ws.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data
      const rawText =
        typeof data === "string"
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString("utf8")
            : String(data)

      let parsed: unknown
      try {
        parsed = JSON.parse(rawText)
      } catch (error) {
        log.debug("Failed to parse gateway response", {
          error: error instanceof Error ? error.message : String(error),
          size: rawText.length,
        })
        return
      }

      const frame = parseGatewayResponseFrame(parsed)
      if (!frame) return

      if (stage === "connect" && frame.id === connectId) {
        if (!frame.ok) {
          stop(new Error(frame.error?.message || "Gateway connect failed"))
          return
        }
        stage = "request"
        const req: GatewayRequestFrame = {
          type: "req",
          id: requestId,
          method,
          params,
        }
        ws.send(JSON.stringify(req))
        return
      }

      if (stage === "request" && frame.id === requestId) {
        if (!frame.ok) {
          stop(new Error(frame.error?.message || "Gateway request failed"))
          return
        }
        stop(undefined, frame.payload as T)
      }
    })

    ws.addEventListener("close", (event) => {
      if (settled) return
      const ev = event as CloseEvent
      const reason = typeof ev.reason === "string" && ev.reason ? `: ${ev.reason}` : ""
      stop(new Error(`Gateway closed (${ev.code})${reason}`))
    })

    ws.addEventListener("error", () => {
      if (settled) return
      stop(new Error(`Failed to connect to gateway (${url})`))
    })
  })
}

const PLATFORM_CAPABILITIES: Record<string, SurfaceCapabilities> = {
  whatsapp: WHATSAPP_CAPABILITIES,
  telegram: TELEGRAM_CAPABILITIES,
}

async function sendViaGateway(input: {
  provider: "whatsapp" | "telegram"
  to: string
  message: string
  accountId?: string
  mediaUrl?: string
  mediaUrls?: string[]
  gifPlayback?: boolean
}): Promise<unknown> {
  // Format message for the target platform's capabilities
  const capabilities = PLATFORM_CAPABILITIES[input.provider]
  let messages = [input.message]
  if (capabilities && input.message) {
    messages = formatForSurface(input.message, capabilities)
  }

  // Send each chunk (for platforms with message length limits)
  let lastResult: unknown
  for (const chunk of messages) {
    lastResult = await callGateway("send", {
      to: input.to,
      message: chunk,
      channel: input.provider,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
      ...(input.mediaUrls?.length ? { mediaUrls: input.mediaUrls } : {}),
      ...(input.gifPlayback ? { gifPlayback: input.gifPlayback } : {}),
      idempotencyKey: crypto.randomUUID(),
    }, { timeoutMs: DEFAULT_GATEWAY_SEND_TIMEOUT_MS })
    // Only attach media to the first chunk
    input = { ...input, mediaUrl: undefined, mediaUrls: undefined }
  }
  return lastResult
}

export const GatewayRoute = new Hono()
  .post(
    "/whatsapp/send",
    describeRoute({
      summary: "Send WhatsApp message (via Zee gateway)",
      description: "Send a WhatsApp message via the local Zee gateway (WebSocket RPC).",
      operationId: "gateway.whatsapp.send",
      responses: {
        200: {
          description: "Send result",
          content: {
            "application/json": {
              schema: resolver(GatewayResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(GatewayResponseSchema),
            },
          },
        },
        500: {
          description: "Server error",
          content: {
            "application/json": {
              schema: resolver(GatewayResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        const payload: GatewayResponse = { success: false, error: "Invalid JSON body" }
        return c.json(payload, 400)
      }

      const parsed = WhatsAppSendInput.safeParse(body)
      if (!parsed.success) {
        const payload: GatewayResponse = { success: false, error: "Invalid request body" }
        return c.json(payload, 400)
      }

      const toRaw = parsed.data.chatId ?? parsed.data.to
      if (!toRaw) {
        const payload: GatewayResponse = { success: false, error: 'Missing "chatId" (or "to")' }
        return c.json(payload, 400)
      }

      try {
        const to = normalizeWhatsAppRecipient(toRaw)
        const accountId = parsed.data.accountId ?? parsed.data.account
        const data = await sendViaGateway({
          provider: "whatsapp",
          to,
          message: parsed.data.message,
          accountId,
          mediaUrl: parsed.data.mediaUrl,
          mediaUrls: parsed.data.mediaUrls,
          gifPlayback: parsed.data.gifPlayback,
        })
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("whatsapp send failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )
  .post(
    "/telegram/send",
    describeRoute({
      summary: "Send Telegram message (via Zee gateway)",
      description: "Send a Telegram message via the local Zee gateway (WebSocket RPC).",
      operationId: "gateway.telegram.send",
      responses: {
        200: {
          description: "Send result",
          content: {
            "application/json": {
              schema: resolver(GatewayResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid request",
          content: {
            "application/json": {
              schema: resolver(GatewayResponseSchema),
            },
          },
        },
        500: {
          description: "Server error",
          content: {
            "application/json": {
              schema: resolver(GatewayResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        const payload: GatewayResponse = { success: false, error: "Invalid JSON body" }
        return c.json(payload, 400)
      }

      const parsed = TelegramSendInput.safeParse(body)
      if (!parsed.success) {
        const payload: GatewayResponse = { success: false, error: "Invalid request body" }
        return c.json(payload, 400)
      }

      const toRaw = parsed.data.chatId ?? parsed.data.to
      if (toRaw === undefined || toRaw === null || String(toRaw).trim() === "") {
        const payload: GatewayResponse = { success: false, error: 'Missing "chatId" (or "to")' }
        return c.json(payload, 400)
      }

      const accountId = parsed.data.persona ?? "stanley"

      try {
        const to = String(toRaw)
        const data = await sendViaGateway({
          provider: "telegram",
          to,
          message: parsed.data.message,
          accountId,
        })
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("telegram send failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )

  // ---------------------------------------------------------------------------
  // Gateway Method Bridge
  //
  // These endpoints bridge Zee gateway WS methods to REST so web/canvas
  // clients can access gateway features without a WebSocket connection.
  // ---------------------------------------------------------------------------

  .get(
    "/skills",
    describeRoute({
      summary: "List gateway skills",
      description: "Get skill status from the Zee gateway (bridged from WS skills.status method).",
      operationId: "gateway.skills.status",
      responses: {
        200: { description: "Skills status", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
        500: { description: "Gateway error", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
      },
    }),
    async (c) => {
      try {
        const data = await callGateway("skills.status", {})
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("gateway skills.status failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )
  .get(
    "/channels/status",
    describeRoute({
      summary: "Get channel status",
      description: "Get messaging channel connection status from the Zee gateway.",
      operationId: "gateway.channels.status",
      responses: {
        200: { description: "Channel status", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
        500: { description: "Gateway error", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
      },
    }),
    async (c) => {
      try {
        const data = await callGateway("channels.status", {})
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("gateway channels.status failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )
  .get(
    "/status",
    describeRoute({
      summary: "Gateway health status",
      description: "Check whether the Zee gateway is reachable and responding.",
      operationId: "gateway.health",
      responses: {
        200: { description: "Gateway healthy", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
        500: { description: "Gateway unreachable", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
      },
    }),
    async (c) => {
      try {
        const data = await callGateway("health", {}, { timeoutMs: 5_000 })
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )
  .get(
    "/usage",
    describeRoute({
      summary: "Gateway usage statistics",
      description: "Get message counts and token usage from the Zee gateway.",
      operationId: "gateway.usage",
      responses: {
        200: { description: "Usage data", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
        500: { description: "Gateway error", content: { "application/json": { schema: resolver(GatewayResponseSchema) } } },
      },
    }),
    async (c) => {
      try {
        const data = await callGateway("usage", {})
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("gateway usage failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )
