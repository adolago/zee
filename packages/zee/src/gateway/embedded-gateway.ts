import { Log } from "../util/log"

const log = Log.create({ service: "gateway:embedded" })

// The embedded gateway depends on the full gateway runtime
// (packages/zee/Swabble). When that package is not available,
// all gateway operations gracefully degrade.

type GatewayServerLike = { close(opts: { reason: string; restartExpectedMs: null }): Promise<void> }
type GatewayLockLike = { lockPath: string; configPath: string; release(): Promise<void> }

let _resolved: {
  loadConfig: () => any
  readConfigFileSnapshot: () => Promise<any>
  resolveGatewayPort: (cfg: any) => number
  resolveGatewayAuth: (params: { authConfig?: any }) => { token?: string }
  startGatewayServer: (port: number) => Promise<GatewayServerLike>
  acquireGatewayLock: () => Promise<GatewayLockLike | null>
} | null = null
let _resolveAttempted = false

async function importUnchecked(modulePath: string): Promise<any> {
  return await import(modulePath)
}

async function resolvePersonaGateway() {
  if (_resolveAttempted) return _resolved
  _resolveAttempted = true
  try {
    const [configMod, authMod, serverMod, lockMod] = await Promise.all([
      importUnchecked("../../../Swabble/src/config/config"),
      importUnchecked("../../../Swabble/src/gateway/auth"),
      importUnchecked("../../../Swabble/src/gateway/server"),
      importUnchecked("../../../Swabble/src/infra/gateway-lock"),
    ])
    _resolved = {
      loadConfig: configMod.loadConfig,
      readConfigFileSnapshot: configMod.readConfigFileSnapshot,
      resolveGatewayPort: configMod.resolveGatewayPort,
      resolveGatewayAuth: authMod.resolveGatewayAuth,
      startGatewayServer: serverMod.startGatewayServer,
      acquireGatewayLock: lockMod.acquireGatewayLock,
    }
  } catch {
    log.warn("persona gateway runtime not available; embedded gateway disabled")
    _resolved = null
  }
  return _resolved
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

let gatewayServer: GatewayServerLike | null = null
let gatewayLock: GatewayLockLike | null = null
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

// Match Swabble's DEFAULT_GATEWAY_PORT (18789). This value is only used when the
// full gateway runtime is unavailable.
const DEFAULT_GATEWAY_PORT = 18789

export function resolveEmbeddedGatewayPort(): number {
  if (!_resolved) return DEFAULT_GATEWAY_PORT
  try {
    const cfg = _resolved.loadConfig()
    return _resolved.resolveGatewayPort(cfg)
  } catch {
    return DEFAULT_GATEWAY_PORT
  }
}

export async function readEmbeddedGatewayConfigSnapshot(): Promise<EmbeddedGatewayConfigSnapshot> {
  const gw = await resolvePersonaGateway()
  if (!gw) {
    return { exists: false, valid: true, issues: [], warnings: [], legacyIssues: [] }
  }
  return await gw.readConfigFileSnapshot()
}

export async function startEmbeddedGateway(options: EmbeddedGatewayStartOptions = {}): Promise<void> {
  if (gatewayServer) return
  if (startPromise) return startPromise

  const gw = await resolvePersonaGateway()
  if (!gw) {
    log.warn("cannot start embedded gateway: persona runtime not available")
    return
  }

  const port = options.port ?? resolveEmbeddedGatewayPort()

  startPromise = (async () => {
    maybeInjectZeeUrl(options.daemonUrl)
    gatewayPort = port

    try {
      gatewayLock = await gw.acquireGatewayLock()
      gatewayServer = await gw.startGatewayServer(port)

      // Always sync the server's resolved token into process.env so the
      // in-process WS client authenticates with the exact same credential.
      // This must overwrite any stale env value (e.g. from daemon.env).
      const cfg = gw.loadConfig()
      const auth = gw.resolveGatewayAuth({ authConfig: cfg.gateway?.auth })
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
