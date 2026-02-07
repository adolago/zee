import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Log } from "../../util/log"
import { formatForSurface, WHATSAPP_CAPABILITIES, MATRIX_CAPABILITIES } from "../../surface/types"
import type { SurfaceCapabilities } from "../../surface/types"
import { readZeeGatewayTokenFromFile } from "@/gateway/token"
import { GatewayWsClient } from "@/gateway/ws-client"

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
  account: z.string().optional(), // Alias for accountId (backward compatibility)
})

const MatrixSendInput = z.object({
  roomId: z.string().optional(),
  to: z.string().optional(),
  message: z.string(),
  mediaUrl: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
  accountId: z.string().optional(),
  account: z.string().optional(), // Alias for accountId (backward compatibility)
})

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

async function buildGatewayConnectParams() {
  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim()
  const fileToken = (await readZeeGatewayTokenFromFile({ log }).catch(() => undefined)) ?? ""
  // Use env var or fallback to file
  const token = envToken || fileToken || undefined
  log.debug("Gateway auth", { hasEnvToken: !!envToken, hasFileToken: !!fileToken, hasToken: !!token })
  const password = process.env.ZEE_GATEWAY_PASSWORD?.trim() || undefined
  const auth = token || password ? { ...(token ? { token } : {}), ...(password ? { password } : {}) } : undefined

  return {
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
}

const gatewayClient = new GatewayWsClient({
  resolveUrl: resolveGatewayWsUrl,
  getConnectParams: buildGatewayConnectParams,
  log,
  // Reduce connect-per-call overhead but do not pin a connection forever.
  idleCloseMs: 30_000,
})

async function callGateway<T = unknown>(
  method: string,
  params?: unknown,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  log.debug("callGateway started", { method })
  const timeoutMs = options.timeoutMs ?? 10_000
  return await gatewayClient.call<T>(method, params, { timeoutMs })
}

const PLATFORM_CAPABILITIES: Record<string, SurfaceCapabilities> = {
  whatsapp: WHATSAPP_CAPABILITIES,
  matrix: MATRIX_CAPABILITIES,
}

async function sendViaGateway(input: {
  provider: "whatsapp" | "matrix"
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
    lastResult = await callGateway(
      "send",
      {
        to: input.to,
        message: chunk,
        channel: input.provider,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
        ...(input.mediaUrls?.length ? { mediaUrls: input.mediaUrls } : {}),
        ...(input.gifPlayback ? { gifPlayback: input.gifPlayback } : {}),
        idempotencyKey: crypto.randomUUID(),
      },
      { timeoutMs: DEFAULT_GATEWAY_SEND_TIMEOUT_MS },
    )
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
    "/matrix/send",
    describeRoute({
      summary: "Send Matrix message (via Zee gateway)",
      description: "Send a Matrix message via the local Zee gateway (WebSocket RPC).",
      operationId: "gateway.matrix.send",
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

      const parsed = MatrixSendInput.safeParse(body)
      if (!parsed.success) {
        const payload: GatewayResponse = { success: false, error: "Invalid request body" }
        return c.json(payload, 400)
      }

      const toRaw = parsed.data.roomId ?? parsed.data.to
      if (toRaw === undefined || toRaw === null || toRaw.trim() === "") {
        const payload: GatewayResponse = { success: false, error: 'Missing "roomId" (or "to")' }
        return c.json(payload, 400)
      }

      try {
        const to = toRaw
        const accountId = parsed.data.accountId ?? parsed.data.account
        const data = await sendViaGateway({
          provider: "matrix",
          to,
          message: parsed.data.message,
          accountId,
          mediaUrl: parsed.data.mediaUrl,
          mediaUrls: parsed.data.mediaUrls,
        })
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("matrix send failed", { error: message })
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
        200: {
          description: "Skills status",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Gateway error",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
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
        200: {
          description: "Channel status",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Gateway error",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
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
        200: {
          description: "Gateway healthy",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Gateway unreachable",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
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
        200: {
          description: "Usage data",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Gateway error",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
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
