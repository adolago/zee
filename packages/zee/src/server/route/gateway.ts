import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Log } from "../../util/log"
import { formatForSurface, TELEGRAM_CAPABILITIES, WHATSAPP_CAPABILITIES } from "../../surface/types"
import type { SurfaceCapabilities } from "../../surface/types"
import { readZeeGatewayTokenFromFile } from "@/gateway/token"
import { GatewayWsClient } from "@/gateway/ws-client"
import { sendWhatsAppMessage } from "@root/domain/zee/whatsapp-send"
import { emitInboundMessage, toPlatformMessage, type ForwardedMessage } from "../../surface/platforms/whatsapp"
import { TelegramPlatformHandler } from "../../surface/platforms/telegram"
import { FluxRecorder } from "@/flux"
import { RequestMeta } from "../request-meta"
import { extractGatewayRouteSecret, isMatchingSecret } from "@/security"
import { Config } from "@/config/config"
import { getServerRuntimeConfig, isTrustedControlOrigin } from "../auth"
import { recordOpenCodeRuntimeRoute } from "@/runtime/opencode-rollout"

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
})

const TelegramSendInput = z.object({
  chatId: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
  message: z.string(),
  replyToId: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaUrls: z.array(z.string()).optional(),
})

const TelegramMetadataInput = z.object({
  chatId: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
})

const TelegramModerationDeleteInput = z.object({
  chatId: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
  messageId: z.union([z.string(), z.number()]),
})

const WhatsAppInboundInput = z.object({
  id: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
  body: z.string(),
  timestamp: z.number(),
  media: z
    .array(
      z.object({
        mediaId: z.string(),
        mimeType: z.string().optional(),
        filename: z.string().optional(),
      }),
    )
    .optional(),
  isGroup: z.boolean(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  replyToId: z.string().optional(),
  platform: z.literal("whatsapp"),
})

const PROTOCOL_VERSION = 3
const DEFAULT_GATEWAY_PORT = 18789
const DEFAULT_GATEWAY_SEND_TIMEOUT_MS = 20_000

async function resolveGatewayRouteSecret(): Promise<{ secret: string; source: string } | undefined> {
  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim()
  if (envToken) return { secret: envToken, source: "env:ZEE_GATEWAY_TOKEN" }

  const fileToken = await readZeeGatewayTokenFromFile({ log }).catch(() => undefined)
  if (fileToken) return { secret: fileToken, source: "file:gateway-token" }

  const password = process.env.ZEE_GATEWAY_PASSWORD?.trim()
  if (password) return { secret: password, source: "env:ZEE_GATEWAY_PASSWORD" }
  return undefined
}

function resolveProvidedGatewayRouteSecret(req: Request): string | undefined {
  return extractGatewayRouteSecret(req.headers)
}

function shouldRequireGatewayRouteAuth(req: Request): boolean {
  const method = req.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD") return true
  // Browser-originated reads should authenticate when a gateway secret is configured.
  return Boolean(req.headers.get("origin"))
}

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

type TelegramActionCategory = "messageActions" | "moderationActions" | "metadataActions"

type TelegramActionPackPolicy = {
  enabled: boolean
  messageActions: boolean
  moderationActions: boolean
  metadataActions: boolean
}

const DEFAULT_TELEGRAM_ACTION_PACK_POLICY: TelegramActionPackPolicy = {
  enabled: true,
  messageActions: true,
  moderationActions: false,
  metadataActions: true,
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function resolveTelegramTarget(chatIdOrTo: string | number | undefined): string {
  if (chatIdOrTo === undefined || chatIdOrTo === null) {
    throw new Error('Missing "chatId" (or "to")')
  }
  const target = String(chatIdOrTo).trim()
  if (!target) throw new Error('Missing "chatId" (or "to")')
  return target
}

async function resolveTelegramActionPackPolicy(): Promise<TelegramActionPackPolicy> {
  const config = await Config.get().catch(() => undefined)
  const gateway =
    config && typeof config.gateway === "object" && config.gateway && !Array.isArray(config.gateway)
      ? (config.gateway as Record<string, unknown>)
      : {}
  const actionPacks =
    typeof gateway.actionPacks === "object" && gateway.actionPacks && !Array.isArray(gateway.actionPacks)
      ? (gateway.actionPacks as Record<string, unknown>)
      : {}
  const telegram =
    typeof actionPacks.telegram === "object" && actionPacks.telegram && !Array.isArray(actionPacks.telegram)
      ? (actionPacks.telegram as Record<string, unknown>)
      : {}

  return {
    enabled: resolveBoolean(telegram.enabled, DEFAULT_TELEGRAM_ACTION_PACK_POLICY.enabled),
    messageActions: resolveBoolean(telegram.messageActions, DEFAULT_TELEGRAM_ACTION_PACK_POLICY.messageActions),
    moderationActions: resolveBoolean(telegram.moderationActions, DEFAULT_TELEGRAM_ACTION_PACK_POLICY.moderationActions),
    metadataActions: resolveBoolean(telegram.metadataActions, DEFAULT_TELEGRAM_ACTION_PACK_POLICY.metadataActions),
  }
}

async function enforceTelegramActionPolicy(
  category: TelegramActionCategory,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const policy = await resolveTelegramActionPackPolicy()
  if (!policy.enabled) {
    return { allowed: false, reason: "Telegram action pack is disabled by policy." }
  }
  if (!policy[category]) {
    return { allowed: false, reason: `Telegram ${category} is disabled by policy.` }
  }
  return { allowed: true }
}

async function createTelegramPlatformHandler(): Promise<TelegramPlatformHandler> {
  const config = await Config.get().catch(() => undefined)
  const telegramSurface = config?.experimental?.surfaces?.telegram
  const tokenFromConfig = typeof telegramSurface?.token === "string" ? telegramSurface.token.trim() : ""
  const tokenFromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? ""
  const token = tokenFromConfig || tokenFromEnv
  if (!token) {
    throw new Error("Telegram bot token is not configured (set experimental.surfaces.telegram.token or TELEGRAM_BOT_TOKEN).")
  }

  const allowedChatIds = Array.isArray(telegramSurface?.allowedChatIds)
    ? telegramSurface.allowedChatIds.filter((entry): entry is string | number => typeof entry === "string" || typeof entry === "number")
    : undefined

  return new TelegramPlatformHandler({
    token,
    apiBaseUrl: typeof telegramSurface?.apiBaseUrl === "string" ? telegramSurface.apiBaseUrl : undefined,
    pollTimeoutSec: typeof telegramSurface?.pollTimeoutSec === "number" ? telegramSurface.pollTimeoutSec : undefined,
    allowedChatIds,
    mediaMaxMb: typeof telegramSurface?.mediaMaxMb === "number" ? telegramSurface.mediaMaxMb : undefined,
  })
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
      displayName: "zee",
      version: process.env.ZEE_VERSION?.trim() || process.env.ZEE_VERSION?.trim() || "dev",
      platform: process.platform,
      mode: "backend",
    },
    caps: [],
    scopes: ["operator.admin"],
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
  options: { timeoutMs?: number; traceID?: string; requestID?: string; sessionID?: string; agentID?: string } = {},
): Promise<T> {
  log.debug("callGateway started", { method })
  const timeoutMs = options.timeoutMs ?? 10_000
  const traceID = options.traceID ?? crypto.randomUUID()
  recordOpenCodeRuntimeRoute({
    surface: "gateway",
    traceID,
    requestID: options.requestID,
    sessionID: options.sessionID,
    metadata: {
      method,
      timeoutMs,
      agentID: options.agentID,
    },
  })
  const startedAt = Date.now()
  FluxRecorder.record({
    traceID,
    requestID: options.requestID,
    sessionID: options.sessionID,
    direction: "outbound",
    domain: "gateway",
    kind: "gateway.rpc.request",
    status: "ok",
    metadata: {
      method,
      timeoutMs,
      ...(options.agentID ? { agentID: options.agentID } : {}),
    },
  })
  try {
    const result = await gatewayClient.call<T>(method, params, { timeoutMs })
    FluxRecorder.record({
      traceID,
      requestID: options.requestID,
      sessionID: options.sessionID,
      direction: "outbound",
      domain: "gateway",
      kind: "gateway.rpc.response",
      status: "ok",
      latencyMs: Date.now() - startedAt,
      metadata: {
        method,
        ...(options.agentID ? { agentID: options.agentID } : {}),
      },
    })
    return result
  } catch (error) {
    FluxRecorder.record({
      traceID,
      requestID: options.requestID,
      sessionID: options.sessionID,
      direction: "outbound",
      domain: "gateway",
      kind: "gateway.rpc.response",
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: {
        code: "gateway_rpc_error",
        message: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        method,
        ...(options.agentID ? { agentID: options.agentID } : {}),
      },
    })
    throw error
  }
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
  traceID?: string
  requestID?: string
  sessionID?: string
  agentID?: string
}): Promise<unknown> {
  const originalInput = {
    ...input,
    mediaUrls: input.mediaUrls ? [...input.mediaUrls] : undefined,
  }

  // Format message for the target platform's capabilities
  const capabilities = PLATFORM_CAPABILITIES[input.provider]
  let messages = [input.message]
  if (capabilities && input.message) {
    messages = formatForSurface(input.message, capabilities)
  }

  try {
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
          ...(input.agentID ? { agentId: input.agentID } : {}),
          idempotencyKey: crypto.randomUUID(),
        },
        {
          timeoutMs: DEFAULT_GATEWAY_SEND_TIMEOUT_MS,
          traceID: input.traceID,
          requestID: input.requestID,
          sessionID: input.sessionID,
          agentID: input.agentID,
        },
      )
      // Only attach media to the first chunk
      input = { ...input, mediaUrl: undefined, mediaUrls: undefined }
    }
    return lastResult
  } catch (error) {
    if (input.provider !== "whatsapp") {
      throw error
    }
    // Fallback to direct wacli send when embedded gateway runtime is unavailable.
    const message = error instanceof Error ? error.message : String(error)
    FluxRecorder.record({
      traceID: input.traceID ?? crypto.randomUUID(),
      requestID: input.requestID,
      sessionID: input.sessionID,
      direction: "internal",
      domain: "gateway",
      kind: "gateway.fallback.invoked",
      status: "ok",
      metadata: {
        provider: input.provider,
        fallback: "wacli",
        reason: message,
        ...(input.agentID ? { agentID: input.agentID } : {}),
      },
    })
    log.warn("gateway send failed; falling back to wacli", {
      error: message,
      to: originalInput.to,
    })

    const mediaQueue = originalInput.mediaUrls?.length
      ? [...originalInput.mediaUrls]
      : originalInput.mediaUrl
        ? [originalInput.mediaUrl]
        : []

    const chunkQueue = [...messages]
    const fallbackResults: Array<Record<string, unknown>> = []

    // Send the first media item with the first text chunk as caption.
    if (mediaQueue.length > 0) {
      const mediaUrl = mediaQueue.shift()!
      const firstChunk = chunkQueue.shift() ?? ""
      const mediaRes = await sendWhatsAppMessage({
        to: originalInput.to,
        message: firstChunk,
        mediaUrl,
      })
      if (!mediaRes.success) {
        throw new Error(mediaRes.error)
      }
      fallbackResults.push({ mode: "media", mediaUrl, ...mediaRes })
    }

    // Additional media items are sent without caption.
    for (const mediaUrl of mediaQueue) {
      const mediaRes = await sendWhatsAppMessage({
        to: originalInput.to,
        message: "",
        mediaUrl,
      })
      if (!mediaRes.success) {
        throw new Error(mediaRes.error)
      }
      fallbackResults.push({ mode: "media", mediaUrl, ...mediaRes })
    }

    // Remaining text chunks are sent as plain text messages.
    for (const chunk of chunkQueue) {
      const textRes = await sendWhatsAppMessage({
        to: originalInput.to,
        message: chunk,
      })
      if (!textRes.success) {
        throw new Error(textRes.error)
      }
      fallbackResults.push({ mode: "text", ...textRes })
    }

    return {
      provider: "wacli",
      accountId: originalInput.accountId,
      results: fallbackResults,
    }
  }
}

export const GatewayRoute = new Hono()
  .use(async (c, next) => {
    const rawAgentID = c.req.header("x-zee-agent-id")
    const parsedAgentID = RequestMeta.parseAgentID(rawAgentID)
    if (rawAgentID !== undefined && rawAgentID.trim().length > 0 && !parsedAgentID) {
      return c.json({ success: false, error: "Invalid x-zee-agent-id header" } satisfies GatewayResponse, 400)
    }
    RequestMeta.setAgentID(c.req.raw, parsedAgentID)

    const runtimeConfig = await getServerRuntimeConfig()
    const origin = c.req.header("Origin")
    const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
    const requestID = RequestMeta.getRequestID(c.req.raw)
    if (origin && !isTrustedControlOrigin(origin, runtimeConfig)) {
      FluxRecorder.record({
        traceID,
        requestID,
        direction: "internal",
        domain: "gateway",
        kind: "gateway.auth.denied",
        status: "denied",
        route: c.req.path,
        method: c.req.method,
        metadata: {
          authRequired: true,
          denialReason: "untrusted_origin",
          origin,
        },
      })
      return c.json({ success: false, error: "Origin is not trusted" } satisfies GatewayResponse, 403)
    }

    const configuredSecret = await resolveGatewayRouteSecret()
    if (!configuredSecret) {
      FluxRecorder.record({
        traceID,
        requestID,
        direction: "internal",
        domain: "gateway",
        kind: "gateway.auth.validated",
        status: "ok",
        route: c.req.path,
        method: c.req.method,
        metadata: {
          authRequired: false,
        },
      })
      await next()
      return
    }

    FluxRecorder.record({
      traceID,
      requestID,
      direction: "internal",
      domain: "gateway",
      kind: "secret.resolved",
      status: "ok",
      route: c.req.path,
      method: c.req.method,
      metadata: {
        source: configuredSecret.source,
      },
    })

    if (!shouldRequireGatewayRouteAuth(c.req.raw)) {
      FluxRecorder.record({
        traceID,
        requestID,
        direction: "internal",
        domain: "gateway",
        kind: "gateway.auth.validated",
        status: "ok",
        route: c.req.path,
        method: c.req.method,
        metadata: {
          authRequired: true,
          bypass: "read_no_origin",
        },
      })
      await next()
      return
    }

    const providedSecret = resolveProvidedGatewayRouteSecret(c.req.raw)
    if (!isMatchingSecret(providedSecret, configuredSecret.secret)) {
      FluxRecorder.record({
        traceID,
        requestID,
        direction: "internal",
        domain: "gateway",
        kind: "gateway.auth.denied",
        status: "denied",
        route: c.req.path,
        method: c.req.method,
        metadata: {
          authRequired: true,
        },
      })
      return c.json({ success: false, error: "Gateway auth required" } satisfies GatewayResponse, 401)
    }

    FluxRecorder.record({
      traceID,
      requestID,
      direction: "internal",
      domain: "gateway",
      kind: "gateway.auth.validated",
      status: "ok",
      route: c.req.path,
      method: c.req.method,
      metadata: {
        authRequired: true,
      },
    })

    await next()
  })
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
        const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
        const requestID = RequestMeta.getRequestID(c.req.raw)
        const agentID = RequestMeta.getAgentID(c.req.raw)
        const data = await sendViaGateway({
          provider: "whatsapp",
          to,
          message: parsed.data.message,
          accountId: parsed.data.accountId,
          mediaUrl: parsed.data.mediaUrl,
          mediaUrls: parsed.data.mediaUrls,
          gifPlayback: parsed.data.gifPlayback,
          traceID,
          requestID,
          agentID,
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
      summary: "Send Telegram message (channel-native action)",
      description: "Send a Telegram message via the Telegram action pack with policy checks.",
      operationId: "gateway.telegram.send",
      responses: {
        200: {
          description: "Send result",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        400: {
          description: "Invalid request",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        403: {
          description: "Policy denied",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Server error",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const policy = await enforceTelegramActionPolicy("messageActions")
      if (!policy.allowed) {
        return c.json({ success: false, error: policy.reason } satisfies GatewayResponse, 403)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" } satisfies GatewayResponse, 400)
      }

      const parsed = TelegramSendInput.safeParse(body)
      if (!parsed.success) {
        return c.json({ success: false, error: "Invalid request body" } satisfies GatewayResponse, 400)
      }

      try {
        const target = resolveTelegramTarget(parsed.data.chatId ?? parsed.data.to)
        const handler = await createTelegramPlatformHandler()
        const mediaUrls = parsed.data.mediaUrls?.length
          ? parsed.data.mediaUrls
          : parsed.data.mediaUrl
            ? [parsed.data.mediaUrl]
            : []
        const media = mediaUrls.map((url, index) => ({
          path: url,
          filename: `telegram-media-${index + 1}`,
        }))
        await handler.sendMessage(target, parsed.data.message, {
          replyToId: parsed.data.replyToId,
          ...(media.length > 0 ? { media } : {}),
        })
        return c.json({
          success: true,
          data: {
            channel: "telegram",
            action: "send",
            target,
          },
        } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("telegram send failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )

  .post(
    "/telegram/metadata/chat",
    describeRoute({
      summary: "Fetch Telegram chat metadata (channel-native action)",
      description: "Fetch Telegram chat metadata via the Telegram action pack with policy checks.",
      operationId: "gateway.telegram.metadata.chat",
      responses: {
        200: {
          description: "Metadata result",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        400: {
          description: "Invalid request",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        403: {
          description: "Policy denied",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Server error",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const policy = await enforceTelegramActionPolicy("metadataActions")
      if (!policy.allowed) {
        return c.json({ success: false, error: policy.reason } satisfies GatewayResponse, 403)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" } satisfies GatewayResponse, 400)
      }

      const parsed = TelegramMetadataInput.safeParse(body)
      if (!parsed.success) {
        return c.json({ success: false, error: "Invalid request body" } satisfies GatewayResponse, 400)
      }

      try {
        const target = resolveTelegramTarget(parsed.data.chatId ?? parsed.data.to)
        const handler = await createTelegramPlatformHandler()
        const data = await handler.getChatMetadata(target)
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("telegram metadata failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )

  .post(
    "/telegram/moderation/delete",
    describeRoute({
      summary: "Delete Telegram message (moderation-safe action)",
      description: "Delete a Telegram message using policy-gated moderation actions.",
      operationId: "gateway.telegram.moderation.delete",
      responses: {
        200: {
          description: "Delete result",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        400: {
          description: "Invalid request",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        403: {
          description: "Policy denied",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        500: {
          description: "Server error",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
      },
    }),
    async (c) => {
      const policy = await enforceTelegramActionPolicy("moderationActions")
      if (!policy.allowed) {
        return c.json({ success: false, error: policy.reason } satisfies GatewayResponse, 403)
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" } satisfies GatewayResponse, 400)
      }

      const parsed = TelegramModerationDeleteInput.safeParse(body)
      if (!parsed.success) {
        return c.json({ success: false, error: "Invalid request body" } satisfies GatewayResponse, 400)
      }

      try {
        const target = resolveTelegramTarget(parsed.data.chatId ?? parsed.data.to)
        const handler = await createTelegramPlatformHandler()
        await handler.deleteMessage(target, parsed.data.messageId)
        return c.json({
          success: true,
          data: {
            channel: "telegram",
            action: "moderation.delete",
            target,
            messageId: String(parsed.data.messageId),
          },
        } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("telegram moderation delete failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )

  // ---------------------------------------------------------------------------
   // Inbound — webhook forward
  // ---------------------------------------------------------------------------

  .post(
    "/whatsapp/inbound",
    describeRoute({
      summary: "Receive inbound WhatsApp message",
      description:
        "Receive an inbound WhatsApp message forwarded from webhook and inject into the messaging surface.",
      operationId: "gateway.whatsapp.inbound",
      responses: {
        200: {
          description: "Message accepted",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
        400: {
          description: "Invalid payload",
          content: { "application/json": { schema: resolver(GatewayResponseSchema) } },
        },
      },
    }),
    async (c) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ success: false, error: "Invalid JSON body" } satisfies GatewayResponse, 400)
      }

      const parsed = WhatsAppInboundInput.safeParse(body)
      if (!parsed.success) {
        log.warn("invalid inbound payload", { errors: parsed.error.issues })
        return c.json({ success: false, error: "Invalid inbound message" } satisfies GatewayResponse, 400)
      }

      const platformMsg = toPlatformMessage(parsed.data as ForwardedMessage)
      emitInboundMessage(platformMsg)

      log.info("inbound whatsapp message", {
        id: platformMsg.id,
        sender: platformMsg.senderId,
        bodyLen: platformMsg.body.length,
      })

      return c.json({ success: true } satisfies GatewayResponse)
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
        const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
        const requestID = RequestMeta.getRequestID(c.req.raw)
        const agentID = RequestMeta.getAgentID(c.req.raw)
        const data = await callGateway("skills.status", {}, { traceID, requestID, agentID })
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
        const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
        const requestID = RequestMeta.getRequestID(c.req.raw)
        const agentID = RequestMeta.getAgentID(c.req.raw)
        const data = await callGateway("channels.status", {}, { traceID, requestID, agentID })
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
        const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
        const requestID = RequestMeta.getRequestID(c.req.raw)
        const agentID = RequestMeta.getAgentID(c.req.raw)
        const data = await callGateway("health", {}, { timeoutMs: 5_000, traceID, requestID, agentID })
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
        const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
        const requestID = RequestMeta.getRequestID(c.req.raw)
        const agentID = RequestMeta.getAgentID(c.req.raw)
        const data = await callGateway("usage", {}, { traceID, requestID, agentID })
        return c.json({ success: true, data } satisfies GatewayResponse)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("gateway usage failed", { error: message })
        return c.json({ success: false, error: message } satisfies GatewayResponse, 500)
      }
    },
  )
