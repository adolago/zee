import { existsSync } from "fs"
import fs from "fs/promises"
import { OpenBB } from "../paths"
import { Log } from "../util/log"

const log = Log.create({ service: "openbb-runtime" })

const DEFAULT_HEALTH_TIMEOUT_MS = 3_000
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 500
const HEALTH_PATHS = ["api/v1/system/health", "health", "docs", ""]

export type OpenBBRuntimeMode = "remote-url" | "managed-local" | "path-command"

export interface OpenBBRuntimeConfigLike {
  apiUrl?: string
  command?: string
  autoStart?: boolean
  installDir?: string
  startupTimeoutMs?: number
  healthTimeoutMs?: number
}

export interface OpenBBRuntimeResolution {
  apiUrl: string
  autoStart: boolean
  remoteOverride: boolean
  installDir: string
  venvDir: string
  managedPythonPath: string
  managedApiCommandPath: string
  managedBuildCommandPath: string
  startupTimeoutMs: number
  healthTimeoutMs: number
  mode: OpenBBRuntimeMode
  command?: string[]
}

export interface OpenBBAvailability {
  available: boolean
  apiUrl: string
  mode: OpenBBRuntimeMode
  healthUrl?: string
  statusCode?: number
  authRequired?: boolean
  error?: string
  action?: string
}

type ProbeFetch = typeof fetch

interface RuntimeState {
  proc?: Bun.Subprocess<any, any, any>
  startupPromise?: Promise<OpenBBAvailability>
  resolution?: OpenBBRuntimeResolution
}

const runtimeState: RuntimeState = {}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return undefined
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function resolveApiUrl(config?: OpenBBRuntimeConfigLike): string {
  return trimOrUndefined(process.env.ZEE_OPENBB_API_URL) || trimOrUndefined(config?.apiUrl) || OpenBB.apiUrl()
}

function resolveInstallDir(config?: OpenBBRuntimeConfigLike): string {
  return trimOrUndefined(process.env.ZEE_OPENBB_HOME) || trimOrUndefined(config?.installDir) || OpenBB.installDir()
}

function resolveCommandOverride(config?: OpenBBRuntimeConfigLike): string | undefined {
  return trimOrUndefined(process.env.ZEE_OPENBB_API_CMD) || trimOrUndefined(config?.command)
}

function resolveAutoStart(config?: OpenBBRuntimeConfigLike): boolean {
  const envValue = parseBoolean(process.env.ZEE_OPENBB_AUTOSTART)
  if (envValue !== undefined) return envValue
  if (config?.autoStart !== undefined) return config.autoStart
  return true
}

function resolveHealthTimeoutMs(config?: OpenBBRuntimeConfigLike): number {
  return parsePositiveInt(process.env.ZEE_OPENBB_HEALTH_TIMEOUT_MS) || config?.healthTimeoutMs || DEFAULT_HEALTH_TIMEOUT_MS
}

function resolveStartupTimeoutMs(config?: OpenBBRuntimeConfigLike): number {
  return (
    parsePositiveInt(process.env.ZEE_OPENBB_STARTUP_TIMEOUT_MS) || config?.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS
  )
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/"
  return pathname.endsWith("/") ? pathname : pathname + "/"
}

function joinApiUrl(baseUrl: string, relativePath: string): string {
  const url = new URL(baseUrl)
  const basePath = normalizePathname(url.pathname)
  url.pathname = relativePath ? `${basePath}${relativePath}`.replace(/\/{2,}/g, "/") : basePath
  return url.toString()
}

function commandExists(command: string[] | undefined): boolean {
  if (!command || command.length === 0) return false
  const [binary] = command
  if (!binary) return false
  if (binary.includes("/") || binary.includes("\\")) return existsSync(binary)
  return Bun.which(binary) !== null
}

function resolveMode(commandOverride: string | undefined, managedApiCommandPath: string): OpenBBRuntimeMode {
  if (OpenBB.apiUrlOverridden()) return "remote-url"
  if (commandOverride) return "path-command"
  if (existsSync(managedApiCommandPath)) return "managed-local"
  return "path-command"
}

function buildAction(resolution: OpenBBRuntimeResolution): string {
  if (resolution.remoteOverride) {
    return "Check the configured ZEE_OPENBB_API_URL target and its auth or network policy."
  }
  if (existsSync(resolution.managedApiCommandPath)) {
    return "Run `zee setup` again to refresh the managed OpenBB runtime, or inspect the local openbb-api logs."
  }
  return "Run `zee setup` to install the managed OpenBB runtime, or install `openbb-platform-api` and ensure `openbb-api` is in PATH."
}

export function resolveOpenBBRuntime(config?: OpenBBRuntimeConfigLike): OpenBBRuntimeResolution {
  const apiUrl = resolveApiUrl(config)
  const installDir = resolveInstallDir(config)
  const venvDir = `${installDir}/.venv`
  const managedPythonPath = process.platform === "win32" ? `${venvDir}/Scripts/python.exe` : `${venvDir}/bin/python`
  const managedApiCommandPath =
    process.platform === "win32" ? `${venvDir}/Scripts/openbb-api.exe` : `${venvDir}/bin/openbb-api`
  const managedBuildCommandPath =
    process.platform === "win32" ? `${venvDir}/Scripts/openbb-build.exe` : `${venvDir}/bin/openbb-build`
  const commandOverride = resolveCommandOverride(config)
  const mode = resolveMode(commandOverride, managedApiCommandPath)

  return {
    apiUrl,
    autoStart: resolveAutoStart(config),
    remoteOverride: OpenBB.apiUrlOverridden(),
    installDir,
    venvDir,
    managedPythonPath,
    managedApiCommandPath,
    managedBuildCommandPath,
    startupTimeoutMs: resolveStartupTimeoutMs(config),
    healthTimeoutMs: resolveHealthTimeoutMs(config),
    mode,
    command:
      mode === "remote-url"
        ? undefined
        : mode === "managed-local"
          ? [managedApiCommandPath]
          : [commandOverride || OpenBB.apiCommand()],
  }
}

async function probeResolvedOpenBBAvailability(
  resolution: OpenBBRuntimeResolution,
  options?: {
    fetchImpl?: ProbeFetch
  },
): Promise<OpenBBAvailability> {
  try {
    new URL(resolution.apiUrl)
  } catch {
    return {
      available: false,
      apiUrl: resolution.apiUrl,
      mode: resolution.mode,
      error: `Configured OpenBB API URL is invalid: ${resolution.apiUrl}`,
      action: buildAction(resolution),
    }
  }

  const fetchImpl = options?.fetchImpl ?? fetch
  let lastError: string | undefined

  for (const candidate of HEALTH_PATHS) {
    const target = joinApiUrl(resolution.apiUrl, candidate)
    try {
      const response = await fetchImpl(target, {
        method: "GET",
        signal: AbortSignal.timeout(resolution.healthTimeoutMs),
      })

      if (response.ok || response.status === 401 || response.status === 403) {
        return {
          available: true,
          apiUrl: resolution.apiUrl,
          mode: resolution.mode,
          healthUrl: target,
          statusCode: response.status,
          authRequired: response.status === 401 || response.status === 403,
        }
      }

      if (response.status !== 404) {
        lastError = `HTTP ${response.status} from ${target}`
      }
    } catch (error) {
      if (!lastError) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
  }

  return {
    available: false,
    apiUrl: resolution.apiUrl,
    mode: resolution.mode,
    error: lastError || `OpenBB Platform API is not reachable at ${resolution.apiUrl}`,
    action: buildAction(resolution),
  }
}

export async function probeOpenBBAvailability(
  config?: OpenBBRuntimeConfigLike,
  options?: {
    fetchImpl?: ProbeFetch
  },
): Promise<OpenBBAvailability> {
  return probeResolvedOpenBBAvailability(resolveOpenBBRuntime(config), options)
}

function spawnCommandFor(resolution: OpenBBRuntimeResolution): string[] {
  if (!resolution.command || resolution.command.length === 0) {
    throw new Error("OpenBB runtime has no local command to start")
  }

  const url = new URL(resolution.apiUrl)
  const command = [...resolution.command]
  if (!command.includes("--host")) command.push("--host", url.hostname)
  if (!command.includes("--port")) {
    command.push("--port", url.port || (url.protocol === "https:" ? "443" : "80"))
  }
  return command
}

async function waitForHealthy(resolution: OpenBBRuntimeResolution, startTime: number): Promise<OpenBBAvailability> {
  for (;;) {
    const probe = await probeResolvedOpenBBAvailability(resolution)
    if (probe.available) return probe

    if (runtimeState.proc?.exitCode !== null) {
      return {
        ...probe,
        error: probe.error || `openbb-api exited early with code ${runtimeState.proc?.exitCode ?? "unknown"}`,
      }
    }

    if (Date.now() - startTime >= resolution.startupTimeoutMs) {
      return {
        ...probe,
        error: probe.error || `Timed out waiting for OpenBB Platform API at ${resolution.apiUrl}`,
      }
    }

    await Bun.sleep(POLL_INTERVAL_MS)
  }
}

export async function ensureOpenBBRuntimeAvailable(config?: OpenBBRuntimeConfigLike): Promise<OpenBBAvailability> {
  const resolution = resolveOpenBBRuntime(config)
  const healthy = await probeResolvedOpenBBAvailability(resolution)
  if (healthy.available) return healthy

  if (resolution.mode === "remote-url") return healthy

  if (!resolution.autoStart) {
    return {
      ...healthy,
      error: healthy.error || "OpenBB Platform API is not reachable and autostart is disabled",
      action: buildAction(resolution),
    }
  }

  if (!commandExists(resolution.command)) {
    return {
      ...healthy,
      error: `OpenBB startup command not found: ${(resolution.command || []).join(" ") || "<none>"}`,
      action: buildAction(resolution),
    }
  }

  if (runtimeState.proc && runtimeState.proc.exitCode === null && runtimeState.resolution?.apiUrl === resolution.apiUrl) {
    runtimeState.startupPromise ??= waitForHealthy(resolution, Date.now())
    return runtimeState.startupPromise
  }

  const command = spawnCommandFor(resolution)
  log.info("starting OpenBB runtime", {
    command,
    apiUrl: resolution.apiUrl,
    mode: resolution.mode,
  })

  runtimeState.proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      PYTHONUNBUFFERED: process.env.PYTHONUNBUFFERED || "1",
    },
  })
  runtimeState.resolution = resolution
  runtimeState.proc.exited.finally(() => {
    runtimeState.proc = undefined
    runtimeState.startupPromise = undefined
    runtimeState.resolution = undefined
  })
  runtimeState.startupPromise = waitForHealthy(resolution, Date.now())
  return runtimeState.startupPromise
}

export async function shutdownOpenBBRuntime(): Promise<void> {
  const proc = runtimeState.proc
  runtimeState.proc = undefined
  runtimeState.startupPromise = undefined
  runtimeState.resolution = undefined

  if (!proc || proc.exitCode !== null) return

  proc.kill("SIGTERM")
  const exited = await Promise.race([proc.exited.then(() => true).catch(() => true), Bun.sleep(5_000).then(() => false)])
  if (!exited && proc.exitCode === null) {
    proc.kill("SIGKILL")
    await proc.exited.catch(() => {})
  }
}

export async function ensureManagedOpenBBDirectories(config?: OpenBBRuntimeConfigLike): Promise<OpenBBRuntimeResolution> {
  const resolution = resolveOpenBBRuntime(config)
  await fs.mkdir(resolution.installDir, { recursive: true })
  return resolution
}
