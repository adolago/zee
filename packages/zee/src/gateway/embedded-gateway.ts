import { Log } from "../util/log"

import { loadConfig, readConfigFileSnapshot, resolveGatewayPort } from "../../../personas/zee/src/config/config"
import { resolveGatewayAuth } from "../../../personas/zee/src/gateway/auth"
import { startGatewayServer, type GatewayServer } from "../../../personas/zee/src/gateway/server"
import { acquireGatewayLock, type GatewayLockHandle } from "../../../personas/zee/src/infra/gateway-lock"

const log = Log.create({ service: "gateway:embedded" })

export type EmbeddedGatewayState = {
  running: boolean
  port?: number
  pid?: number
  lockPath?: string
  lockConfigPath?: string
}

export type EmbeddedGatewayConfigSnapshot = Awaited<ReturnType<typeof readConfigFileSnapshot>>

type EmbeddedGatewayStartOptions = {
  port?: number
  daemonUrl?: string
}

let gatewayServer: GatewayServer | null = null
let gatewayLock: GatewayLockHandle | null = null
let gatewayPort: number | undefined
let injectedZeeUrl = false
let previousZeeUrl: string | undefined
let startPromise: Promise<void> | null = null

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

export function resolveEmbeddedGatewayPort(): number {
  const cfg = loadConfig()
  return resolveGatewayPort(cfg)
}

export async function readEmbeddedGatewayConfigSnapshot(): Promise<EmbeddedGatewayConfigSnapshot> {
  return await readConfigFileSnapshot()
}

export async function startEmbeddedGateway(options: EmbeddedGatewayStartOptions = {}): Promise<void> {
  if (gatewayServer) return
  if (startPromise) return startPromise

  const port = options.port ?? resolveEmbeddedGatewayPort()

  startPromise = (async () => {
    maybeInjectZeeUrl(options.daemonUrl)
    gatewayPort = port

    try {
      gatewayLock = await acquireGatewayLock()
      gatewayServer = await startGatewayServer(port)

      // Always sync the server's resolved token into process.env so the
      // in-process WS client authenticates with the exact same credential.
      // This must overwrite any stale env value (e.g. from daemon.env).
      const cfg = loadConfig()
      const auth = resolveGatewayAuth({ authConfig: cfg.gateway?.auth })
      if (auth.token) {
        process.env.ZEE_GATEWAY_TOKEN = auth.token
      }

      log.info("embedded gateway started", { port })
    } catch (error) {
      await gatewayLock?.release().catch(() => undefined)
      gatewayLock = null
      gatewayServer = null
      restoreZeeUrl()
      throw error
    }
  })()

  try {
    await startPromise
  } finally {
    startPromise = null
  }
}

export async function stopEmbeddedGateway(options: { reason?: string } = {}): Promise<void> {
  const reason = options.reason ?? "gateway stopping"
  const port = gatewayPort

  if (gatewayServer) {
    try {
      await gatewayServer.close({ reason, restartExpectedMs: null })
    } catch (error) {
      log.warn("embedded gateway shutdown error", { error: String(error), port })
    } finally {
      gatewayServer = null
    }
  }

  await gatewayLock?.release().catch(() => undefined)
  gatewayLock = null
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
