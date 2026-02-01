import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Log } from "../../util/log"
import { Global } from "../../global"
import { Session } from "../../session"
import { Todo } from "../../session/todo"
import { Instance } from "../../project/instance"
import { execSync } from "child_process"
import { startAlwaysOnProcess } from "./always-on"
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
import {
  startTailscaleExposure,
  type TailscaleMode,
} from "../../pkg/tailscale"

const log = Log.create({ service: "daemon" })

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

  function isAgentCoreDaemonArgs(args: string[]): boolean {
    if (args.length === 0) return false
    const hasDaemonArg = args.some((arg) => arg === "daemon")
    if (!hasDaemonArg) return false
    return args.some((arg) => arg.includes("agent-core"))
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

  async function isAgentCoreDaemonProcess(pid: number): Promise<boolean> {
    const procCmdline = await readProcessCmdline(pid)
    if (procCmdline) return isAgentCoreDaemonArgs(parseCmdlineArgs(procCmdline))
    try {
      const psOutput = execSync(`ps -p ${pid} -o command=`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString()
      return isAgentCoreDaemonArgs(parseCmdlineArgs(psOutput))
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

    if (!(await isAgentCoreDaemonProcess(state.pid))) {
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
        if (await isAgentCoreDaemonProcess(existing.pid)) {
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

  export async function setupSignalHandlers(cleanup: (signal?: NodeJS.Signals) => Promise<void>) {
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"]

    for (const signal of signals) {
      process.on(signal, () => {
        if (isShuttingDown) return
        isShuttingDown = true
        log.info("received signal, shutting down", { signal })
        cleanup(signal)
          .then(() => {
            process.exit(0)
          })
          .catch((error) => {
            log.error("error during signal cleanup", { signal, error: error instanceof Error ? error.message : String(error) })
            process.exit(1)
          })
      })
    }
  }
}

/**
 * Gateway supervisor - manages embedded Zee gateway runtime
 */
export namespace GatewaySupervisor {
  const GATEWAY_ENV_HINTS = [
    "ZEE_GATEWAY_TOKEN",
    "ZEE_GATEWAY_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_USER_PHONE",
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
  ]

  let startInFlight = false
  let isShuttingDown = false
  let gatewayEnabled = false
  let forceStart = false
  let lastError: string | undefined
  let lastExit: { code?: number | null; signal?: NodeJS.Signals | null } | undefined
  let lastPreflight: GatewayPreflight | null = null
  let gatewayDaemonUrl: string | undefined
  let retryTimer: NodeJS.Timeout | undefined
  let retryCount = 0
  const RETRY_BASE_MS = 1000
  const RETRY_MAX_MS = 30000

  export interface GatewayPreflight {
    ok: boolean
    issues: string[]
    warnings: string[]
    configPath?: string
    configExists: boolean
    configValid: boolean
    envHints: string[]
  }

  export interface GatewayState {
    running: boolean
    pid?: number
    error?: string
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
        warnings.push("Legacy config entries detected (run \"zee doctor\")")
      }
    } catch (error) {
      issues.push(`Failed to read Zee config: ${String(error)}`)
    }

    const envHints = getEnvHints()
    const configured = Boolean(configExists || envHints.length)
    if (!configured) {
      const warning = "Zee gateway not configured (no config in ~/.zee/zee.json* or provider env vars)"
      warnings.push(warning)
      blockingWarnings.push(warning)
    }

    if (options.checkPort) {
      const gatewayPort = getGatewayPort()
      const portOpen = await isPortOpen("127.0.0.1", gatewayPort)
      const embeddedState = getEmbeddedGatewayState()
      if (portOpen && !embeddedState.running) {
        const processes = listGatewayProcesses()
        if (processes.length > 0) {
          issues.push(`Existing Zee gateway process detected on port ${gatewayPort}`)
        } else {
          issues.push(`Gateway port ${gatewayPort} is already in use`)
        }
      }
    }

    const ok = issues.length === 0 && (blockingWarnings.length === 0 || options.force)
    return {
      ok,
      issues,
      warnings,
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

  export function getState(): GatewayState {
    const embeddedState = getEmbeddedGatewayState()
    return {
      running: embeddedState.running,
      pid: embeddedState.pid,
      error: lastError,
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
      lastError = preflight.issues[0] ?? preflight.warnings[0]
      if (lastError) log.warn("zee gateway preflight failed", { reason: lastError })
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
      return true
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      log.error("failed to start zee gateway", {
        error: lastError,
      })
      scheduleRetry(lastError)
      return false
    }
  }

  export async function stop(): Promise<void> {
    isShuttingDown = true
    gatewayEnabled = false
    forceStart = false
    clearRetryTimer()
    await stopEmbeddedGateway({ reason: "gateway stopping" })
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
    const output = execSync('pgrep -af "(agent-core|opencode).*daemon([[:space:]]|$)" 2>/dev/null || true', {
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

  log.warn("stopping leftover zee gateway processes", {
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
      .option("restore-sessions", {
        describe: "Restore sessions with incomplete todos on startup",
        type: "boolean",
        default: true,
      })
      .option("wezterm", {
        describe: "Enable WezTerm visual orchestration when display available",
        type: "boolean",
        default: true,
      })
      .option("wezterm-layout", {
        describe: "WezTerm pane layout",
        type: "string",
        choices: ["horizontal", "vertical", "grid"],
        default: "horizontal",
      })
      .option("gateway", {
        describe: "Start zee messaging gateway (WhatsApp/Telegram/Signal)",
        type: "boolean",
        default: true,
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
      }),
  describe: "Start agent-core as a headless daemon for remote access",
  handler: async (args) => {
    // Check if already running
    if (await Daemon.isRunning()) {
      const state = await Daemon.readPidFile()
      UI.warn(`Daemon is already running (PID: ${state?.pid}, Port: ${state?.port})`)

      const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
      const headless = process.env.AGENT_CORE_HEADLESS === "1" || !isInteractive

      if (headless) {
        UI.info("Headless mode detected, stopping existing daemon before restart.")
      } else {
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
        await new Promise(r => setTimeout(r, 1000))
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

    const proc = await startAlwaysOnProcess({
      hostname: opts.hostname,
      port: opts.port,
      directory,
      gateway: Boolean(args.gateway),
      gatewayForce: Boolean(args["gateway-force"]),
      wezterm: Boolean(args.wezterm),
      weztermLayout: args["wezterm-layout"] as "horizontal" | "vertical" | "grid",
      restoreSessions: Boolean(args["restore-sessions"]),
    })

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
    const preflight = await GatewaySupervisor.preflight({ force: true })
    const port = getGatewayPort()
    const portOpen = await isPortOpen("127.0.0.1", port)
    const processes = listGatewayProcesses()
    const gatewayState = GatewaySupervisor.getState()
    const embeddedState = getEmbeddedGatewayState()
    const configLabel = preflight.configExists
      ? preflight.configPath ?? "Configured"
      : preflight.configPath
        ? `Not found (${preflight.configPath})`
        : "Not found"

    Output.log("Zee Gateway Status")
    Output.log(`  Mode:      embedded`)
    Output.log(`  Config:    ${configLabel}`)
    Output.log(`  Port:      ${port} (${portOpen ? "listening" : "closed"})`)
    Output.log(`  Daemon:    ${gatewayState.daemonUrl ?? "unknown"}`)
    Output.log(`  Enabled:   ${gatewayState.enabled ? "yes" : "no"}`)
    Output.log(
      `  Process:   ${embeddedState.running ? `embedded (pid ${embeddedState.pid ?? process.pid})` : "none"}`,
    )
    Output.log(`  Env:       ${preflight.envHints.length ? preflight.envHints.join(", ") : "none"}`)

    if (processes.length > 0) {
      Output.log("  External:")
      for (const proc of processes) {
        Output.log(`    ${proc.pid} ${proc.cmd}`)
      }
    } else {
      Output.log("  External:  none")
    }

    const issues = [...preflight.issues, ...preflight.warnings]
    if (issues.length > 0) {
      Output.log("  Issues:")
      for (const issue of issues) {
        Output.log(`    - ${issue}`)
      }
    }
  },
})
