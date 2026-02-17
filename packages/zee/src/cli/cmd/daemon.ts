import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Log } from "../../util/log"
import { Global } from "../../global"
import { Session } from "../../session"
import { Todo } from "../../session/todo"
import { Instance } from "../../project/instance"
import { execSync } from "child_process"
import { startAlwaysOnProcess } from "./always-on"
import { runRuntimeProcessMaintenance } from "./runtime-process-guard"
import fs from "fs/promises"
import path from "path"
import net from "net"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Output } from "../output"
import {
  getEmbeddedGatewayState,
  readEmbeddedGatewayConfigSnapshot,
  resolveEmbeddedGatewayPort,
  startEmbeddedGateway,
  stopEmbeddedGateway,
} from "../../gateway/embedded-gateway"
import { setGatewayHealthState } from "../../gateway/supervisor-state"
import { startTailscaleExposure, type TailscaleMode } from "../../pkg/tailscale"
import { printGatewayStatus } from "./gateway/status"

const log = Log.create({ service: "daemon" })
const DAEMON_ALREADY_RUNNING_EXIT_CODE = 100
const ALLOW_RESTART_ENV = "ZEE_ALLOW_RESTART"

export namespace Daemon {
  const STATE_DIR = path.join(Global.Path.state, "daemon")
  const PID_FILE = path.join(STATE_DIR, "daemon.pid")
  const LOCK_FILE = path.join(STATE_DIR, "daemon.lock")
  let lockHandle: fs.FileHandle | null = null

  export interface DaemonState {
    pid: number
    port: number
    hostname: string
    startTime: number
    directory: string
  }

  async function ensureStateDir() {
    await fs.mkdir(STATE_DIR, { recursive: true })
  }

  export async function writePidFile(state: DaemonState) {
    await ensureStateDir()
    await fs.writeFile(PID_FILE, JSON.stringify(state, null, 2))
    log.info("wrote pid file", { path: PID_FILE, state })
  }

  export async function removePidFile() {
    try {
      await fs.unlink(PID_FILE)
      log.info("removed pid file", { path: PID_FILE })
    } catch (e) {
      // Ignore if file doesn't exist
    }
  }

  export async function readPidFile(): Promise<DaemonState | null> {
    try {
      const content = await fs.readFile(PID_FILE, "utf-8")
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  function parseCmdlineArgs(cmdline: string): string[] {
    const raw = cmdline.includes("\0") ? cmdline.split("\0") : cmdline.trim().split(/\s+/)
    return raw.filter(Boolean)
  }

  const DAEMON_BASENAMES = new Set(["zee"])

  function isZeeDaemonArgs(args: string[]): boolean {
    if (args.length === 0) return false
    const hasDaemonArg = args.some((arg) => arg === "daemon")
    if (!hasDaemonArg) return false
    return args.some((arg) => DAEMON_BASENAMES.has(path.basename(arg).toLowerCase()))
  }

  async function readProcessCmdline(pid: number): Promise<string | null> {
    try {
      return await fs.readFile(`/proc/${pid}/cmdline`, "utf-8")
    } catch {
      return null
    }
  }

  async function isPidAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function isZeeDaemonProcess(pid: number): Promise<boolean> {
    const procCmdline = await readProcessCmdline(pid)
    if (procCmdline) return isZeeDaemonArgs(parseCmdlineArgs(procCmdline))
    try {
      const psOutput = execSync(`ps -p ${pid} -o command=`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString()
      return isZeeDaemonArgs(parseCmdlineArgs(psOutput))
    } catch {
      return false
    }
  }

  export async function isRunning(): Promise<boolean> {
    const state = await readPidFile()
    if (!state) {
      // No PID file, but check for stale lock file
      await checkAndCleanStaleLock()
      return false
    }

    if (!(await isPidAlive(state.pid))) {
      // Process not running, clean up stale files
      await removePidFile()
      await checkAndCleanStaleLock()
      return false
    }

    if (!(await isZeeDaemonProcess(state.pid))) {
      log.warn("pid file points to non-daemon process, cleaning up", { pid: state.pid })
      await removePidFile()
      await checkAndCleanStaleLock()
      return false
    }

    return true
  }

  async function checkAndCleanStaleLock() {
    try {
      const stat = await fs.lstat(LOCK_FILE)
      if (!stat.isFile() || stat.isSymbolicLink()) return
      const baseDir = path.resolve(STATE_DIR)
      const resolved = path.resolve(LOCK_FILE)
      const rel = path.relative(baseDir, resolved)
      if (rel.startsWith("..") || path.isAbsolute(rel)) return
      // If we reach here, lock exists but PID doesn't (or is dead)
      await fs.unlink(LOCK_FILE)
      log.info("removed stale lock file", { path: LOCK_FILE })
    } catch {
      // No lock file, all good
    }
  }

  async function readLockFile(): Promise<{ pid?: number; startTime?: number } | null> {
    try {
      const content = await fs.readFile(LOCK_FILE, "utf-8")
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  export async function acquireLock() {
    await ensureStateDir()
    try {
      lockHandle = await fs.open(LOCK_FILE, "wx")
      await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startTime: Date.now() }, null, 2))
      return
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : ""
      if (code !== "EEXIST") throw error
    }

    const existing = await readLockFile()
    if (existing?.pid) {
      if (await isPidAlive(existing.pid)) {
        if (await isZeeDaemonProcess(existing.pid)) {
          throw new Error(`Daemon is already running (PID: ${existing.pid})`)
        }
      }
    }

    await checkAndCleanStaleLock()
    lockHandle = await fs.open(LOCK_FILE, "wx")
    await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startTime: Date.now() }, null, 2))
  }

  export async function releaseLock() {
    try {
      if (lockHandle) {
        await lockHandle.close()
      }
    } catch {
      // Ignore lock close errors
    } finally {
      lockHandle = null
    }

    try {
      await fs.unlink(LOCK_FILE)
      log.info("removed lock file", { path: LOCK_FILE })
    } catch {
      // Ignore if file doesn't exist
    }
  }

  export async function restoreSessionsWithTodos(directory: string) {
    log.info("checking for sessions with incomplete todos", { directory })

    const sessions: Session.Info[] = []
    for await (const session of Session.list()) {
      sessions.push(session)
    }

    let restoredCount = 0
    for (const session of sessions) {
      const todos = await Todo.get(session.id)
      const incompleteTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")

      if (incompleteTodos.length > 0) {
        log.info("found session with incomplete todos", {
          sessionID: session.id,
          title: session.title,
          incomplete: incompleteTodos.length,
          total: todos.length,
        })
        restoredCount++
      }
    }

    if (restoredCount > 0) {
      log.info("sessions with incomplete todos ready for continuation", { count: restoredCount })
    } else {
      log.info("no sessions with incomplete todos found")
    }

    return restoredCount
  }

  let isShuttingDown = false

  function resolveShutdownTimeoutMs(): number {
    const raw = process.env.ZEE_DAEMON_SHUTDOWN_TIMEOUT_MS?.trim()
    if (!raw) return 12_000
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return 12_000
    return parsed
  }

  export async function setupSignalHandlers(cleanup: (signal?: NodeJS.Signals) => Promise<void>) {
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"]

    for (const signal of signals) {
      process.on(signal, () => {
        if (isShuttingDown) return
        isShuttingDown = true
        log.info("received signal, shutting down", { signal })

        const timer = setTimeout(() => {
          log.error("shutdown timed out, forcing process exit", {
            signal,
            timeoutMs: resolveShutdownTimeoutMs(),
          })
          process.exit(1)
        }, resolveShutdownTimeoutMs())

        cleanup(signal)
          .then(() => {
            process.exit(0)
          })
          .catch((error) => {
            log.error("error during signal cleanup", {
              signal,
              error: error instanceof Error ? error.message : String(error),
            })
            process.exit(1)
          })
          .finally(() => {
            clearTimeout(timer)
          })
      })
    }
  }
}

/**
 * Gateway supervisor - manages embedded Zee gateway runtime
 */
export namespace GatewaySupervisor {
  const GATEWAY_ENV_HINTS = ["ZEE_GATEWAY_TOKEN", "ZEE_GATEWAY_PASSWORD"]

  let startInFlight = false
  let isShuttingDown = false
  let gatewayEnabled = false
  let forceStart = false
  let lastError: string | undefined
  let lastExit: { code?: number | null; signal?: NodeJS.Signals | null } | undefined
  let lastPreflight: GatewayPreflight | null = null
  let gatewayDaemonUrl: string | undefined
  let retryTimer: NodeJS.Timeout | undefined
  let healthCheckTimer: NodeJS.Timer | undefined
  let retryCount = 0
  const RETRY_BASE_MS = 1000
  const RETRY_MAX_MS = 30000
  const HEALTH_CHECK_INTERVAL_MS = 60_000

  export interface GatewayPreflight {
    ok: boolean
    issues: string[]
    warnings: string[]
    fatal: boolean
    fatalReason?: string
    configPath?: string
    configExists: boolean
    configValid: boolean
    envHints: string[]
  }

  export interface GatewayState {
    running: boolean
    pid?: number
    error?: string
    fatal?: boolean
    enabled: boolean
    lastExit?: { code?: number | null; signal?: NodeJS.Signals | null }
    configPath?: string
    warnings?: string[]
    daemonUrl?: string
  }

  function getEnvHints(): string[] {
    const hints: string[] = []
    for (const key of GATEWAY_ENV_HINTS) {
      if (process.env[key]?.trim()) hints.push(key)
    }
    return hints
  }

  function detectFatalPreflightIssue(issues: string[]): string | undefined {
    for (const issue of issues) {
      if (/plugins\.entries\.[^:]+:\s*plugin not found:/i.test(issue)) {
        return `${issue}\nAction: rebuild Zee so bundled extensions are present, then verify with ./script/verify-binary.sh`
      }
    }
    return undefined
  }

  async function runPreflight(options: { force: boolean; checkPort: boolean }): Promise<GatewayPreflight> {
    const issues: string[] = []
    const warnings: string[] = []
    const blockingWarnings: string[] = []
    let configPath: string | undefined
    let configExists = false
    let configValid = false

    try {
      const snapshot = await readEmbeddedGatewayConfigSnapshot()
      configPath = snapshot.path
      configExists = snapshot.exists
      configValid = snapshot.valid
      if (!snapshot.valid) {
        for (const issue of snapshot.issues) {
          const location = issue.path?.trim() ? issue.path : "<root>"
          issues.push(`Config ${location}: ${issue.message}`)
        }
      } else if (snapshot.warnings.length > 0) {
        for (const warning of snapshot.warnings) {
          const location = warning.path?.trim() ? warning.path : "<root>"
          warnings.push(`Config ${location}: ${warning.message}`)
        }
      }
      if (snapshot.legacyIssues.length > 0) {
        warnings.push('Legacy config entries detected (run "zee doctor")')
      }
    } catch (error) {
      issues.push(`Failed to read Zee config: ${String(error)}`)
    }

    const envHints = getEnvHints()
    const configured = Boolean(configExists || envHints.length)
    if (!configured) {
      const warning = "Zee gateway not configured (no config in ~/.config/zee/zee.json* or provider env vars)"
      warnings.push(warning)
      // Non-blocking: the embedded gateway can still run on loopback without explicit config.
      // Auth is still required for non-loopback binds / remote exposure.
    }

    if (options.checkPort) {
      const gatewayPort = getGatewayPort()
      const embeddedState = getEmbeddedGatewayState()
      if (!embeddedState.running && isSystemdUserUnitEnabled(SYSTEMD_ZEE_GATEWAY_UNIT)) {
        issues.push(
          `Systemd unit ${SYSTEMD_ZEE_GATEWAY_UNIT} is enabled. Disable it to avoid a port conflict on ${gatewayPort}.`,
        )
      } else {
        let portOpen = await isPortOpen("127.0.0.1", gatewayPort)
        if (portOpen && !embeddedState.running) {
          const processes = listGatewayProcesses()
          if (processes.length > 0) {
            const systemdPids: number[] = []
            for (const proc of processes) {
              if (await isPidInSystemdUnit(proc.pid, SYSTEMD_ZEE_GATEWAY_UNIT)) systemdPids.push(proc.pid)
            }

            if (systemdPids.length > 0) {
              issues.push(
                `Gateway port ${gatewayPort} is in use by ${SYSTEMD_ZEE_GATEWAY_UNIT} (pid(s): ${systemdPids.join(", ")}). Embedded gateway will not start.`,
              )
            } else if (options.force) {
              // Kill orphaned gateway processes only when explicitly forced.
              log.warn("killing orphaned zee gateway processes during preflight (forced)", {
                pids: processes.map((p) => p.pid),
              })
              await stopGatewayProcesses("preflight: orphaned gateway on port " + gatewayPort)
              // Re-check port after cleanup
              portOpen = await isPortOpen("127.0.0.1", gatewayPort)
              if (portOpen) {
                issues.push(`Gateway port ${gatewayPort} still in use after killing orphaned processes`)
              }
            } else {
              issues.push(`Gateway port ${gatewayPort} is already in use`)
            }
          } else {
            issues.push(`Gateway port ${gatewayPort} is already in use`)
          }
        }
      }
    }

    const fatalReason = detectFatalPreflightIssue(issues)
    const ok = issues.length === 0 && (blockingWarnings.length === 0 || options.force)
    return {
      ok,
      issues,
      warnings,
      fatal: Boolean(fatalReason),
      fatalReason,
      configPath,
      configExists,
      configValid,
      envHints,
    }
  }

  function clearRetryTimer() {
    if (!retryTimer) return
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  function startHealthCheck() {
    if (healthCheckTimer) return
    healthCheckTimer = setInterval(async () => {
      if (isShuttingDown || !gatewayEnabled) return
      if (getEmbeddedGatewayState().running) return
      log.info("gateway health check: not running, attempting restart")
      await start({ force: forceStart, daemonUrl: gatewayDaemonUrl })
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  function stopHealthCheck() {
    if (!healthCheckTimer) return
    clearInterval(healthCheckTimer)
    healthCheckTimer = undefined
  }

  function scheduleRetry(reason?: string) {
    if (isShuttingDown || !gatewayEnabled) return
    if (retryTimer) return

    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryCount)
    retryCount += 1
    log.warn("scheduling zee gateway retry", { delay, reason })

    retryTimer = setTimeout(async () => {
      retryTimer = undefined
      if (isShuttingDown || !gatewayEnabled || getEmbeddedGatewayState().running) return
      await start({ force: forceStart, daemonUrl: gatewayDaemonUrl })
    }, delay)
  }

  export async function preflight(options: { force?: boolean; checkPort?: boolean } = {}): Promise<GatewayPreflight> {
    const result = await runPreflight({
      force: options.force ?? false,
      checkPort: options.checkPort ?? false,
    })
    lastPreflight = result
    return result
  }

  function syncHealthState() {
    const embeddedState = getEmbeddedGatewayState()
    setGatewayHealthState({
      running: embeddedState.running,
      enabled: gatewayEnabled,
      error: lastError,
    })
  }

  export function getState(): GatewayState {
    const embeddedState = getEmbeddedGatewayState()
    syncHealthState()
    return {
      running: embeddedState.running,
      pid: embeddedState.pid,
      error: lastError,
      fatal: Boolean(lastPreflight?.fatal),
      enabled: gatewayEnabled,
      lastExit,
      configPath: lastPreflight?.configPath,
      warnings: lastPreflight?.warnings?.length ? lastPreflight.warnings : undefined,
      daemonUrl: gatewayDaemonUrl,
    }
  }
  export async function start(options: { force?: boolean; daemonUrl?: string } = {}): Promise<boolean> {
    if (isShuttingDown) return false
    if (getEmbeddedGatewayState().running) {
      return true
    }
    if (startInFlight) return false

    clearRetryTimer()

    gatewayEnabled = true
    forceStart = options.force ?? false
    if (options.daemonUrl) {
      gatewayDaemonUrl = options.daemonUrl
    }

    startInFlight = true
    const preflight = await runPreflight({ force: forceStart, checkPort: true }).finally(() => {
      startInFlight = false
    })
    lastPreflight = preflight
    lastError = undefined
    if (!preflight.ok) {
      lastError = preflight.fatalReason ?? preflight.issues[0] ?? preflight.warnings[0]
      if (lastError) log.warn("zee gateway preflight failed", { reason: lastError })
      syncHealthState()
      if (!preflight.fatal) {
        startHealthCheck()
      }
      return false
    }

    if (preflight.warnings.length > 0) {
      log.warn("zee gateway preflight warnings", { warnings: preflight.warnings })
    }
    log.info("starting embedded zee gateway")

    try {
      const gatewayPort = getGatewayPort()
      await startEmbeddedGateway({ port: gatewayPort, daemonUrl: gatewayDaemonUrl })
      lastExit = undefined
      retryCount = 0
      log.info("embedded zee gateway started", { port: gatewayPort })
      syncHealthState()
      startHealthCheck()
      return true
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      log.error("failed to start zee gateway", {
        error: lastError,
      })
      syncHealthState()
      scheduleRetry(lastError)
      return false
    }
  }

  export async function stop(): Promise<void> {
    isShuttingDown = true
    gatewayEnabled = false
    forceStart = false
    clearRetryTimer()
    stopHealthCheck()
    await stopEmbeddedGateway({ reason: "gateway stopping" })
    syncHealthState()
  }

  export function isEnabled(): boolean {
    return gatewayEnabled
  }
}

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1000)

    socket.once("connect", () => {
      clearTimeout(timeout)
      socket.end()
      resolve(true)
    })
    socket.once("error", () => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
}

function getGatewayPort(): number {
  return resolveEmbeddedGatewayPort()
}

const SYSTEMD_ZEE_GATEWAY_UNIT = "zee-gateway.service"

function isSystemdUserUnitEnabled(unit: string): boolean {
  try {
    const output = execSync(`systemctl --user is-enabled ${unit} 2>/dev/null || true`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    })
      .toString()
      .trim()
    return output === "enabled" || output === "enabled-runtime"
  } catch {
    return false
  }
}

async function isPidInSystemdUnit(pid: number, unit: string): Promise<boolean> {
  try {
    const cgroup = await fs.readFile(`/proc/${pid}/cgroup`, "utf-8")
    return cgroup.includes(unit)
  } catch {
    return false
  }
}

function listGatewayProcesses(): Array<{ pid: number; cmd: string }> {
  try {
    const output = execSync('pgrep -af "zee.*gateway" 2>/dev/null || true', {
      encoding: "utf-8",
    })
    const lines = output.trim().split("\n").filter(Boolean)
    return lines
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/)
        if (!match) return null
        const cmd = match[2]
        if (cmd.includes("pgrep")) return null
        return { pid: Number.parseInt(match[1], 10), cmd }
      })
      .filter((entry): entry is { pid: number; cmd: string } => Boolean(entry))
  } catch {
    return []
  }
}

function listDaemonProcesses(): Array<{ pid: number; cmd: string }> {
  try {
    const output = execSync('pgrep -af "zee.*daemon([[:space:]]|$)" 2>/dev/null || true', {
      encoding: "utf-8",
    })
    const lines = output.trim().split("\n").filter(Boolean)
    return lines
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/)
        if (!match) return null
        const cmd = match[2]
        if (cmd.includes("pgrep") || cmd.includes("daemon-stop")) return null
        return { pid: Number.parseInt(match[1], 10), cmd }
      })
      .filter((entry): entry is { pid: number; cmd: string } => Boolean(entry))
  } catch {
    return []
  }
}

async function stopGatewayProcesses(reason: string): Promise<void> {
  const processes = listGatewayProcesses()
  if (processes.length === 0) return

  const protectedProcs: Array<{ pid: number; cmd: string }> = []
  const killableProcs: Array<{ pid: number; cmd: string }> = []

  for (const proc of processes) {
    if (await isPidInSystemdUnit(proc.pid, SYSTEMD_ZEE_GATEWAY_UNIT)) {
      protectedProcs.push(proc)
    } else {
      killableProcs.push(proc)
    }
  }

  if (protectedProcs.length > 0) {
    log.warn("skipping systemd-managed zee gateway processes", {
      unit: SYSTEMD_ZEE_GATEWAY_UNIT,
      pids: protectedProcs.map((proc) => proc.pid),
    })
  }

  if (killableProcs.length === 0) return

  log.warn("stopping leftover zee gateway processes", {
    reason,
    count: killableProcs.length,
    pids: killableProcs.map((proc) => proc.pid),
  })

  for (const proc of killableProcs) {
    try {
      process.kill(proc.pid, "SIGTERM")
    } catch {
      // ignore missing process
    }
  }

  const deadline = Date.now() + 4000
  let remaining = killableProcs.map((proc) => proc.pid)
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    remaining = remaining.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
  }

  if (remaining.length > 0) {
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // ignore
      }
    }
    log.warn("force-killed lingering zee gateway processes", { pids: remaining })
  }
}

async function stopDaemonProcesses(reason: string): Promise<void> {
  const processes = listDaemonProcesses()
  if (processes.length === 0) return

  log.warn("stopping leftover daemon processes", {
    reason,
    count: processes.length,
    pids: processes.map((proc) => proc.pid),
  })

  for (const proc of processes) {
    try {
      process.kill(proc.pid, "SIGTERM")
    } catch {
      // ignore missing process
    }
  }

  const deadline = Date.now() + 4000
  let remaining = processes.map((proc) => proc.pid)
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    remaining = remaining.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
  }

  if (remaining.length > 0) {
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // ignore
      }
    }
    log.warn("force-killed lingering daemon processes", { pids: remaining })
  }
}

export const DaemonCommand = cmd({
  command: "daemon",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("directory", {
        describe: "Working directory for the daemon",
        type: "string",
        default: process.cwd(),
      })
      .option("foreground", {
        describe: "Run in foreground (don't daemonize)",
        type: "boolean",
        default: true, // For now, always run in foreground
      })
      .option("wezterm-layout", {
        describe: "WezTerm pane layout",
        type: "string",
        choices: ["horizontal", "vertical", "grid"],
        default: "horizontal",
      })
      .option("gateway-force", {
        describe: "Start zee gateway even if preflight checks fail",
        type: "boolean",
        default: false,
      })
      .option("tailscale", {
        describe: "Expose daemon via Tailscale (off, serve, funnel)",
        type: "string",
        choices: ["off", "serve", "funnel"],
        default: "off",
      })
      .option("runtime-guard-interval-ms", {
        describe: "Runtime process guard interval in milliseconds",
        type: "number",
        default: 30_000,
      })
      .option("runtime-max-total", {
        describe: "Maximum Zee-related processes before runtime guard flags violations",
        type: "number",
      })
      .option("runtime-max-mcp-total", {
        describe: "Maximum MCP server processes",
        type: "number",
      })
      .option("runtime-max-mcp-per-server", {
        describe: "Maximum MCP server processes per server name",
        type: "number",
      })
      .option("runtime-max-clients", {
        describe: "Maximum Zee client processes",
        type: "number",
      }),
  describe: "Start zee as a headless daemon for remote access",
  handler: async (args) => {
    // Check if already running
    if (await Daemon.isRunning()) {
      const state = await Daemon.readPidFile()
      UI.warn(`Daemon is already running (PID: ${state?.pid}, Port: ${state?.port})`)

      const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
      const headless = process.env.ZEE_HEADLESS === "1" || !isInteractive
      const allowRestart = process.env[ALLOW_RESTART_ENV] === "1"

      if (headless && !allowRestart) {
        UI.info("Headless mode detected; refusing to restart an existing daemon.")
        UI.info(`Stop the running service first, or set ${ALLOW_RESTART_ENV}=1 to force a restart.`)
        process.exit(DAEMON_ALREADY_RUNNING_EXIT_CODE)
      }

      if (!headless) {
        const shouldKill = await prompts.confirm({
          message: "Do you want to stop the existing daemon and start a new one?",
          initialValue: false,
        })

        if (prompts.isCancel(shouldKill) || !shouldKill) {
          UI.info("Exiting.")
          process.exit(0)
        }
      }

      UI.info(`Stopping daemon (PID: ${state?.pid})...`)
      try {
        if (state?.pid) process.kill(state.pid, "SIGTERM")
        await Daemon.removePidFile()
        await new Promise((r) => setTimeout(r, 1000))
      } catch (e) {
        UI.error(`Failed to stop daemon: ${e}`)
        process.exit(1)
      }
    }

    try {
      await Daemon.acquireLock()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to acquire daemon lock: ${message}`)
      process.exit(1)
    }

    const opts = await resolveNetworkOptions(args)
    const directory = args.directory as string
    const alwaysOnProfile = true
    const enforceRuntimeGuard = true
    const runtimeGuardIntervalMs =
      typeof args["runtime-guard-interval-ms"] === "number" ? args["runtime-guard-interval-ms"] : 30_000
    const runtimeLimits = {
      maxTotal: typeof args["runtime-max-total"] === "number" ? args["runtime-max-total"] : undefined,
      maxMcpTotal: typeof args["runtime-max-mcp-total"] === "number" ? args["runtime-max-mcp-total"] : undefined,
      maxMcpPerServer:
        typeof args["runtime-max-mcp-per-server"] === "number" ? args["runtime-max-mcp-per-server"] : undefined,
      maxClients: typeof args["runtime-max-clients"] === "number" ? args["runtime-max-clients"] : undefined,
    }

    if (enforceRuntimeGuard) {
      const preflightReport = await runRuntimeProcessMaintenance({
        limits: runtimeLimits,
        reason: "daemon-preflight",
      }).catch((error) => {
        log.error("runtime guard preflight failed", {
          error: error instanceof Error ? error.message : String(error),
        })
        return undefined
      })
      if (preflightReport?.kills.length) {
        const byKind = preflightReport.kills.reduce<Record<string, number>>((acc, kill) => {
          acc[kill.kind] = (acc[kill.kind] ?? 0) + 1
          return acc
        }, {})
        const details = Object.entries(byKind)
          .map(([kind, count]) => `${kind}=${count}`)
          .join(" ")
        UI.info(
          `Runtime guard cleaned ${preflightReport.kills.length} stale process(es)${details ? ` (${details})` : ""}`,
        )
      }
    }

    let proc
    try {
      proc = await startAlwaysOnProcess({
        hostname: opts.hostname,
        port: opts.port,
        directory,
        alwaysOnProfile,
        skipSetupCheck: false,
        gateway: true,
        gatewayForce: Boolean(args["gateway-force"]),
        wezterm: true,
        weztermLayout: args["wezterm-layout"] as "horizontal" | "vertical" | "grid",
        restoreSessions: true,
        runtimeGuard: enforceRuntimeGuard,
        runtimeGuardIntervalMs,
        runtimeLimits,
      })
    } catch (error) {
      await Daemon.removePidFile().catch(() => {})
      await Daemon.releaseLock().catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to start daemon: ${message}`)
      process.exit(1)
    }

    // Start Tailscale exposure if requested
    const tailscaleMode = (args.tailscale as TailscaleMode) ?? "off"
    let tailscaleCleanup: (() => Promise<void>) | undefined
    if (tailscaleMode !== "off") {
      const exposure = await startTailscaleExposure({
        mode: tailscaleMode,
        port: opts.port,
        onInfo: (msg) => UI.info(msg),
        onWarn: (msg) => UI.warn(msg),
      })
      if (exposure) {
        tailscaleCleanup = exposure.cleanup
        if (exposure.hostname) {
          UI.info(`Daemon accessible via Tailscale: https://${exposure.hostname}`)
        }
      }
    }

    await Daemon.setupSignalHandlers(async (signal?: NodeJS.Signals) => {
      if (tailscaleCleanup) {
        await tailscaleCleanup().catch(() => {})
      }
      await proc.cleanup(signal)
    })

    process.on("uncaughtException", async (error) => {
      log.error("uncaught exception", { error: error.message, stack: error.stack })
      await proc.cleanup(undefined, error)
      process.exit(1)
    })

    process.on("unhandledRejection", async (reason) => {
      log.error("unhandled rejection", { reason: String(reason) })
    })

    // Keep the process running
    await new Promise(() => {})
  },
})

// Subcommand: daemon status
export const DaemonStatusCommand = cmd({
  command: "daemon-status",
  describe: "Check if the daemon is running",
  handler: async () => {
    const running = await Daemon.isRunning()
    const state = await Daemon.readPidFile()

    if (running && state) {
      Output.log(`Daemon is running`)
      Output.log(`  PID:       ${state.pid}`)
      Output.log(`  Port:      ${state.port}`)
      Output.log(`  Hostname:  ${state.hostname}`)
      Output.log(`  Directory: ${state.directory}`)
      Output.log(`  Started:   ${new Date(state.startTime).toISOString()}`)
      Output.log(`  URL:       http://${state.hostname}:${state.port}`)
    } else {
      Output.log(`Daemon is not running`)
      process.exit(1)
    }
  },
})

// Subcommand: daemon stop
export const DaemonStopCommand = cmd({
  command: "daemon-stop",
  describe: "Stop the running daemon",
  builder: (yargs) =>
    yargs.option("keep-gateway", {
      type: "boolean",
      default: false,
      describe: "Do not stop Zee gateway processes after daemon shutdown",
    }),
  handler: async (args) => {
    const keepGateway = Boolean(args["keep-gateway"])
    const state = await Daemon.readPidFile()

    if (!state) {
      Output.log("No daemon PID file found")
      await stopDaemonProcesses("daemon-stop (pid missing)")
      if (!keepGateway) await stopGatewayProcesses("daemon-stop (pid missing)")
      process.exit(1)
    }

    try {
      process.kill(state.pid, "SIGTERM")
      Output.log(`Sent SIGTERM to daemon (PID: ${state.pid})`)

      // Wait for it to stop
      let attempts = 0
      while (attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (!(await Daemon.isRunning())) {
          Output.log("Daemon stopped successfully")
          await stopDaemonProcesses("daemon-stop (cleanup)")
          if (!keepGateway) await stopGatewayProcesses("daemon-stop (graceful)")
          return
        }
        attempts++
      }

      // Force kill if still running
      Output.log("Daemon did not stop gracefully, sending SIGKILL")
      process.kill(state.pid, "SIGKILL")
      await Daemon.removePidFile()
      await Daemon.releaseLock()
      await stopDaemonProcesses("daemon-stop (forced)")
      if (!keepGateway) await stopGatewayProcesses("daemon-stop (forced)")
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") {
        Output.log("Daemon process not found, cleaning up PID file")
        await Daemon.removePidFile()
        await Daemon.releaseLock()
        await stopDaemonProcesses("daemon-stop (pid missing)")
        if (!keepGateway) await stopGatewayProcesses("daemon-stop (pid missing)")
      } else {
        throw e
      }
    }
  },
})

export const GatewayStatusCommand = cmd({
  command: "gateway-status",
  describe: "Check Zee gateway configuration and reachability",
  handler: async () => {
    Output.log("Note: `zee gateway-status` is deprecated. Use: `zee gateway status`.")
    await printGatewayStatus()
  },
})
