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
let injectedAgentCoreUrl = false
let previousAgentCoreUrl: string | undefined
let startPromise: Promise<void> | null = null

function maybeInjectAgentCoreUrl(daemonUrl?: string) {
  if (!daemonUrl) return
  if (process.env.AGENT_CORE_URL?.trim()) return
  previousAgentCoreUrl = process.env.AGENT_CORE_URL
  process.env.AGENT_CORE_URL = daemonUrl
  injectedAgentCoreUrl = true
}

function restoreAgentCoreUrl() {
  if (!injectedAgentCoreUrl) return
  if (previousAgentCoreUrl) {
    process.env.AGENT_CORE_URL = previousAgentCoreUrl
  } else {
    delete process.env.AGENT_CORE_URL
  }
  injectedAgentCoreUrl = false
  previousAgentCoreUrl = undefined
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
    maybeInjectAgentCoreUrl(options.daemonUrl)
    gatewayPort = port

    try {
      gatewayLock = await acquireGatewayLock()
      gatewayServer = await startGatewayServer(port)

      // Sync the resolved gateway auth token into the env so that
      // buildGatewayConnectParams() (WS client) uses the exact same
      // token the gateway server validates against. Both run in-process,
      // so process.env is shared.
      if (!process.env.ZEE_GATEWAY_TOKEN) {
        const cfg = loadConfig()
        const auth = resolveGatewayAuth({ authConfig: cfg.gateway?.auth })
        if (auth.token) {
          process.env.ZEE_GATEWAY_TOKEN = auth.token
        }
      }

      log.info("embedded gateway started", { port })
    } catch (error) {
      await gatewayLock?.release().catch(() => undefined)
      gatewayLock = null
      gatewayServer = null
      restoreAgentCoreUrl()
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
  restoreAgentCoreUrl()
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
