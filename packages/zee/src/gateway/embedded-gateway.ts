import fs from "node:fs/promises"
import path from "node:path"
import { resolveConfigDir, resolveStateDir } from "../global/dirs"
import { Log } from "../util/log"
import { readZeeGatewayTokenFromFile } from "./token"

const log = Log.create({ service: "gateway:embedded" })

type GatewayServerLike = ReturnType<typeof Bun.serve>
type GatewayLockLike = { lockPath: string; configPath: string; release(): Promise<void> }

type GatewayRequestFrame = {
  type: "req"
  id: string
  method: string
  params?: unknown
}

type GatewayAuthInput = {
  token?: string
  password?: string
}

type GatewayConnectParams = {
  auth?: GatewayAuthInput
  client?: {
    id?: string
    displayName?: string
    version?: string
    platform?: string
    mode?: string
  }
  scopes?: string[]
  minProtocol?: number
  maxProtocol?: number
}

type GatewaySocketData = {
  connected: boolean
  clientId?: string
  scopes?: string[]
}

type GatewayResolvedAuth = {
  token?: string
  password?: string
  secret?: string
  source?: "token" | "password"
}

export type EmbeddedGatewayState = {
  running: boolean
  port?: number
  pid?: number
  lockPath?: string
  lockConfigPath?: string
}

export type EmbeddedGatewayConfigSnapshot = {
  path?: string
  exists: boolean
  valid: boolean
  issues: Array<{ path?: string; message: string }>
  warnings: Array<{ path?: string; message: string }>
  legacyIssues: Array<{ message: string }>
}

type EmbeddedGatewayStartOptions = {
  port?: number
  daemonUrl?: string
}

const CONFIG_FILENAMES = ["zee.jsonc", "zee.json"] as const
const DEFAULT_GATEWAY_PORT = 18789
const PROTOCOL_VERSION = 3
const GATEWAY_LOCK_PATH = path.join(resolveStateDir(), "gateway", "embedded.lock")

let gatewayServer: GatewayServerLike | null = null
let gatewayLock: GatewayLockLike | null = null
let gatewayPort: number | undefined
let gatewayStartedAt = 0
let activeConnections = 0
let injectedZeeUrl = false
let previousZeeUrl: string | undefined
let startPromise: Promise<boolean> | null = null
let gatewayAuth: GatewayResolvedAuth | null = null

function maybeInjectZeeUrl(daemonUrl?: string) {
  if (!daemonUrl) return
  if (process.env.ZEE_URL?.trim()) return
  previousZeeUrl = process.env.ZEE_URL
  process.env.ZEE_URL = daemonUrl
  injectedZeeUrl = true
}

function restoreZeeUrl() {
  if (!injectedZeeUrl) return
  if (previousZeeUrl) {
    process.env.ZEE_URL = previousZeeUrl
  } else {
    delete process.env.ZEE_URL
  }
  injectedZeeUrl = false
  previousZeeUrl = undefined
}

function toText(data: string | ArrayBuffer | Uint8Array): string {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf-8")
  return Buffer.from(data).toString("utf-8")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseRequestFrame(raw: unknown): GatewayRequestFrame | null {
  if (!isRecord(raw)) return null
  if (raw.type !== "req") return null
  if (typeof raw.id !== "string" || typeof raw.method !== "string") return null
  return {
    type: "req",
    id: raw.id,
    method: raw.method,
    params: raw.params,
  }
}

function sendResponse(
  ws: Bun.ServerWebSocket<GatewaySocketData>,
  id: string,
  result:
    | { ok: true; payload?: unknown }
    | { ok: false; code: string; message: string; details?: unknown },
) {
  if (result.ok) {
    ws.send(
      JSON.stringify({
        type: "res",
        id,
        ok: true,
        payload: result.payload,
      }),
    )
    return
  }

  ws.send(
    JSON.stringify({
      type: "res",
      id,
      ok: false,
      error: {
        code: result.code,
        message: result.message,
        details: result.details,
      },
    }),
  )
}

async function findGatewayConfigPath(): Promise<string | undefined> {
  const configDir = resolveConfigDir()
  for (const file of CONFIG_FILENAMES) {
    const candidate = path.join(configDir, file)
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Ignore missing file.
    }
  }
  return undefined
}

async function isPidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function acquireGatewayLock(): Promise<GatewayLockLike> {
  await fs.mkdir(path.dirname(GATEWAY_LOCK_PATH), { recursive: true })

  let handle: fs.FileHandle
  try {
    handle = await fs.open(GATEWAY_LOCK_PATH, "wx")
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : ""
    if (code !== "EEXIST") throw error

    try {
      const raw = await fs.readFile(GATEWAY_LOCK_PATH, "utf-8")
      const parsed = JSON.parse(raw) as { pid?: number }
      if (parsed.pid && (await isPidAlive(parsed.pid))) {
        throw new Error(`Gateway is already running (PID: ${parsed.pid})`)
      }
    } catch (readError) {
      if (readError instanceof Error && readError.message.startsWith("Gateway is already running")) {
        throw readError
      }
    }

    await fs.rm(GATEWAY_LOCK_PATH, { force: true }).catch(() => undefined)
    handle = await fs.open(GATEWAY_LOCK_PATH, "wx")
  }

  await handle.writeFile(
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  )

  const configPath = (await findGatewayConfigPath()) ?? path.join(resolveConfigDir(), "zee.jsonc")

  return {
    lockPath: GATEWAY_LOCK_PATH,
    configPath,
    release: async () => {
      await handle.close().catch(() => undefined)
      await fs.rm(GATEWAY_LOCK_PATH, { force: true }).catch(() => undefined)
    },
  }
}

async function resolveGatewayAuth(): Promise<GatewayResolvedAuth> {
  const envToken = process.env.ZEE_GATEWAY_TOKEN?.trim()
  if (envToken) {
    return {
      token: envToken,
      secret: envToken,
      source: "token",
    }
  }

  const fileToken = await readZeeGatewayTokenFromFile({ log }).catch(() => undefined)
  if (fileToken) {
    return {
      token: fileToken,
      secret: fileToken,
      source: "token",
    }
  }

  const password = process.env.ZEE_GATEWAY_PASSWORD?.trim()
  if (password) {
    return {
      password,
      secret: password,
      source: "password",
    }
  }

  return {}
}

function isAuthorized(auth: GatewayAuthInput | undefined, resolved: GatewayResolvedAuth | null): boolean {
  if (!resolved?.secret) return true
  const token = auth?.token?.trim()
  const password = auth?.password?.trim()
  return token === resolved.secret || password === resolved.secret
}

function getHealthPayload() {
  return {
    ok: true,
    protocol: PROTOCOL_VERSION,
    port: gatewayPort,
    pid: process.pid,
    uptimeMs: gatewayStartedAt > 0 ? Date.now() - gatewayStartedAt : 0,
    connectedClients: activeConnections,
  }
}

function getSkillsPayload() {
  return {
    skills: [],
    sources: ["source-checkout", "user-config"],
  }
}

function getChannelsPayload() {
  return {
    channels: [
      { name: "whatsapp", status: "fallback" },
      { name: "telegram", status: "channel-native" },
    ],
    channelAccounts: {
      whatsapp: [],
      telegram: [],
    },
  }
}

async function handleMethod(
  method: string,
  params: unknown,
): Promise<{ ok: true; payload?: unknown } | { ok: false; code: string; message: string; details?: unknown }> {
  switch (method) {
    case "health":
      return { ok: true, payload: getHealthPayload() }
    case "skills.status":
      return { ok: true, payload: getSkillsPayload() }
    case "channels.status":
      return { ok: true, payload: getChannelsPayload() }
    case "send":
      return {
        ok: false,
        code: "unavailable",
        message: "Embedded gateway send is unavailable; use the REST channel handlers.",
        details: params,
      }
    default:
      return {
        ok: false,
        code: "unknown_method",
        message: `Unknown gateway method: ${method}`,
      }
  }
}

function startGatewayServer(port: number): GatewayServerLike {
  return Bun.serve<GatewaySocketData>({
    port,
    fetch(req, server) {
      if (server.upgrade(req, { data: { connected: false } })) return
      return new Response("Not Found", { status: 404 })
    },
    websocket: {
      open() {
        activeConnections += 1
      },
      async message(ws, message) {
        let parsed: unknown
        try {
          parsed = JSON.parse(toText(message))
        } catch {
          return
        }

        const frame = parseRequestFrame(parsed)
        if (!frame) return

        if (frame.method === "connect") {
          const params = isRecord(frame.params) ? (frame.params as GatewayConnectParams) : {}
          if (!isAuthorized(params.auth, gatewayAuth)) {
            sendResponse(ws, frame.id, {
              ok: false,
              code: "unauthorized",
              message: "Gateway auth failed",
            })
            try {
              ws.close(4401, "Unauthorized")
            } catch {
              // Ignore close errors.
            }
            return
          }

          ws.data.connected = true
          ws.data.clientId =
            params.client && typeof params.client.id === "string" && params.client.id.trim().length > 0
              ? params.client.id
              : undefined
          ws.data.scopes = Array.isArray(params.scopes)
            ? params.scopes.filter((entry): entry is string => typeof entry === "string")
            : []

          sendResponse(ws, frame.id, {
            ok: true,
            payload: {
              type: "hello-ok",
              protocol: PROTOCOL_VERSION,
              clientId: ws.data.clientId,
            },
          })
          return
        }

        if (!ws.data.connected) {
          sendResponse(ws, frame.id, {
            ok: false,
            code: "not_connected",
            message: "Gateway client must connect first",
          })
          return
        }

        sendResponse(ws, frame.id, await handleMethod(frame.method, frame.params))
      },
      close() {
        activeConnections = Math.max(0, activeConnections - 1)
      },
    },
  })
}

export function resolveEmbeddedGatewayPort(): number {
  const portRaw = Number.parseInt(process.env.ZEE_GATEWAY_PORT ?? "", 10)
  return Number.isFinite(portRaw) && portRaw > 0 ? portRaw : DEFAULT_GATEWAY_PORT
}

export async function readEmbeddedGatewayConfigSnapshot(): Promise<EmbeddedGatewayConfigSnapshot> {
  const configPath = await findGatewayConfigPath()
  return {
    path: configPath,
    exists: Boolean(configPath),
    valid: true,
    issues: [],
    warnings: [],
    legacyIssues: [],
  }
}

export async function startEmbeddedGateway(options: EmbeddedGatewayStartOptions = {}): Promise<boolean> {
  if (gatewayServer) return true
  if (startPromise) return await startPromise

  const port = options.port ?? resolveEmbeddedGatewayPort()

  startPromise = (async () => {
    maybeInjectZeeUrl(options.daemonUrl)
    gatewayPort = port

    try {
      gatewayLock = await acquireGatewayLock()
      gatewayAuth = await resolveGatewayAuth()
      if (gatewayAuth.token) {
        process.env.ZEE_GATEWAY_TOKEN = gatewayAuth.token
      }
      gatewayStartedAt = Date.now()
      activeConnections = 0
      gatewayServer = startGatewayServer(port)
      log.info("embedded gateway started", { port })
      return true
    } catch (error) {
      await gatewayLock?.release().catch(() => undefined)
      gatewayLock = null
      gatewayServer = null
      gatewayAuth = null
      gatewayStartedAt = 0
      restoreZeeUrl()
      throw error
    }
  })()

  try {
    return await startPromise
  } finally {
    startPromise = null
  }
}

export async function stopEmbeddedGateway(options: { reason?: string } = {}): Promise<void> {
  const reason = options.reason ?? "gateway stopping"
  const port = gatewayPort

  if (gatewayServer) {
    try {
      gatewayServer.stop(true)
    } catch (error) {
      log.warn("embedded gateway shutdown error", { error: String(error), port, reason })
    } finally {
      gatewayServer = null
    }
  }

  await gatewayLock?.release().catch(() => undefined)
  gatewayLock = null
  gatewayAuth = null
  gatewayStartedAt = 0
  activeConnections = 0
  restoreZeeUrl()
}

export function getEmbeddedGatewayState(): EmbeddedGatewayState {
  return {
    running: gatewayServer !== null,
    port: gatewayPort,
    pid: gatewayServer ? process.pid : undefined,
    lockPath: gatewayLock?.lockPath,
    lockConfigPath: gatewayLock?.configPath,
  }
}
