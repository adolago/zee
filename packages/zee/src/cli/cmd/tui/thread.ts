import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import path from "path"
import fs from "node:fs"
import { spawnSync } from "child_process"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions, type ResolvedNetworkOptions } from "@/cli/network"
import { Daemon } from "@/cli/cmd/daemon"
import { startAlwaysOnProcess, type AlwaysOnProcess } from "@/cli/cmd/always-on"
import { createAuthorizedFetch } from "@/server/auth"

const DEFAULT_DAEMON_PORT = 3210
const DAEMON_HEALTH_PATH = "/global/health"
const TTY_DETACH_CHECK_INTERVAL_MS = 3000

function normalizeDaemonHost(hostname?: string): string {
  if (!hostname || hostname === "0.0.0.0") return "127.0.0.1"
  return hostname
}

function resolveDaemonUrl(network: ResolvedNetworkOptions, state?: Daemon.DaemonState | null): string {
  if (process.env.ZEE_URL) return process.env.ZEE_URL
  const hostname = normalizeDaemonHost(state?.hostname ?? network.hostname)
  const port = state?.port ?? (network.port && network.port !== 0 ? network.port : DEFAULT_DAEMON_PORT)
  return `http://${hostname}:${port}`
}

function readProcFdTarget(fd: number): string | undefined {
  if (process.platform !== "linux") return
  try {
    return fs.readlinkSync(`/proc/${process.pid}/fd/${fd}`)
  } catch {
    return
  }
}

function isTTYDetached(fd: number): boolean {
  const target = readProcFdTarget(fd)
  if (!target) return false
  if (!target.startsWith("/dev/pts/")) return false
  if (target.includes(" (deleted)")) return true
  return !fs.existsSync(target)
}

function watchInteractiveTerminal(onDetached: (reason: string) => void): () => void {
  const watchedFds = [
    process.stdin.isTTY ? 0 : -1,
    process.stdout.isTTY ? 1 : -1,
    process.stderr.isTTY ? 2 : -1,
  ].filter((fd) => fd >= 0)

  if (watchedFds.length === 0) return () => {}

  let closed = false
  const cleanup: Array<() => void> = []

  const done = (reason: string) => {
    if (closed) return
    closed = true
    for (const fn of cleanup.splice(0)) fn()
    onDetached(reason)
  }

  const onSighup = () => done("sighup")
  process.on("SIGHUP", onSighup)
  cleanup.push(() => process.off("SIGHUP", onSighup))

  if (process.stdin.isTTY) {
    const onStdinEnd = () => done("stdin-end")
    const onStdinClose = () => done("stdin-close")
    process.stdin.on("end", onStdinEnd)
    process.stdin.on("close", onStdinClose)
    cleanup.push(() => process.stdin.off("end", onStdinEnd))
    cleanup.push(() => process.stdin.off("close", onStdinClose))
  }

  if (process.platform === "linux") {
    const timer = setInterval(() => {
      for (const fd of watchedFds) {
        if (isTTYDetached(fd)) {
          done(`fd-${fd}-tty-detached`)
          return
        }
      }
    }, TTY_DETACH_CHECK_INTERVAL_MS)
    timer.unref()
    cleanup.push(() => clearInterval(timer))
  }

  return () => {
    if (closed) return
    closed = true
    for (const fn of cleanup.splice(0)) fn()
  }
}

async function checkDaemonHealth(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const authorizedFetch = createAuthorizedFetch(fetch)
    const response = await authorizedFetch(`${url}${DAEMON_HEALTH_PATH}`, { signal: controller.signal })
    if (!response.ok) return false
    const data = await response.json().catch(() => undefined)
    if (data && typeof data === "object" && "healthy" in data) {
      return Boolean((data as { healthy?: boolean }).healthy)
    }
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForHealthy(resolveUrl: () => Promise<string>, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const url = await resolveUrl()
    if (await checkDaemonHealth(url)) return url
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

type SystemdScope = "user" | "system"

type SystemdServiceState = {
  available: boolean
  installed: boolean
  active: boolean
  status?: string
}

function getSystemdServiceState(scope: SystemdScope): SystemdServiceState {
  if (process.platform !== "linux") {
    return { available: false, installed: false, active: false }
  }
  try {
    const args = scope === "user" ? ["--user", "is-active", "zee"] : ["is-active", "zee"]
    const result = spawnSync("systemctl", args, {
      encoding: "utf-8",
    })
    if (result.error) {
      return { available: false, installed: false, active: false }
    }
    const stdout = (result.stdout ?? "").trim()
    const stderr = (result.stderr ?? "").trim()
    if (result.status === 0) {
      return { available: true, installed: true, active: true, status: stdout || stderr }
    }
    if (result.status === 3) {
      return { available: true, installed: true, active: false, status: stdout || stderr }
    }
    if (result.status === 4) {
      return { available: true, installed: false, active: false, status: stdout || stderr }
    }
    return { available: true, installed: true, active: false, status: stdout || stderr }
  } catch {
    return { available: false, installed: false, active: false }
  }
}

function attemptSystemctlStart(scope: SystemdScope): { ok: boolean; details?: string } {
  const baseArgs = scope === "user" ? ["--user"] : []
  const result = spawnSync("systemctl", [...baseArgs, "--no-ask-password", "start", "zee"], { encoding: "utf-8" })
  if (result.status === 0) return { ok: true }

  const stdout = (result.stdout ?? "").trim()
  const stderr = (result.stderr ?? "").trim()
  const details = stderr || stdout

  if (scope === "user") {
    return { ok: false, details }
  }

  const sudoResult = spawnSync("sudo", ["-n", "systemctl", "start", "zee"], { encoding: "utf-8" })
  if (sudoResult.status === 0) return { ok: true }

  const sudoStdout = (sudoResult.stdout ?? "").trim()
  const sudoStderr = (sudoResult.stderr ?? "").trim()
  const sudoDetails = sudoStderr || sudoStdout

  return { ok: false, details: sudoDetails || details }
}

/**
 * Ensure zee is running. Returns the URL to connect to.
 *
 * Strategy:
 * 1. If ZEE_URL is set, use it directly (external/remote process)
 * 2. If a process is already running (PID file + healthy), attach to it
 * 3. If systemd user service is installed, use it
 * 4. If systemd system service is installed, use it
 * 5. Otherwise, start a new always-on process in this process
 */
async function ensureProcessRunning(
  network: ResolvedNetworkOptions,
  directory: string,
): Promise<{ url: string; proc?: AlwaysOnProcess }> {
  // 1. Explicit URL
  const explicitUrl = process.env.ZEE_URL?.trim()
  if (explicitUrl) {
    const url = resolveDaemonUrl(network)
    if (await checkDaemonHealth(url)) return { url }
    UI.error("ZEE_URL is set but the process is unreachable or unauthorized.")
    UI.info("Unset ZEE_URL to use the local process.")
    process.exit(1)
  }

  const resolveUrl = async () => resolveDaemonUrl(network, await Daemon.readPidFile())

  // 2. Existing process
  const running = await Daemon.isRunning()
  if (running) {
    let url = await resolveUrl()
    if (await checkDaemonHealth(url)) return { url }
    url = await resolveUrl()
    if (await checkDaemonHealth(url)) return { url }
    UI.error("Process appears to be running but is not healthy. Check `zee daemon-status`.")
    process.exit(1)
  }

  // 3. Systemd (prefer user service)
  const systemdUser = getSystemdServiceState("user")
  const systemdSystem = getSystemdServiceState("system")
  if (systemdUser.available && systemdUser.installed && systemdSystem.available && systemdSystem.installed) {
    UI.warn("Both user and system zee systemd services are installed. Use only one to avoid restarts.")
  }

  if (systemdUser.available && systemdUser.installed) {
    if (!systemdUser.active) {
      UI.info("Starting systemd user service 'zee'...")
      const started = attemptSystemctlStart("user")
      if (!started.ok) {
        UI.error("Failed to start systemd user service 'zee'.")
        if (started.details) UI.info(started.details)
        UI.info("Try: systemctl --user start zee")
        process.exit(1)
      }
    }

    const url = await waitForHealthy(resolveUrl, 8000)
    if (url) return { url }

    UI.error("Systemd user service 'zee' is active but unhealthy.")
    UI.info("Check: systemctl --user status zee")
    process.exit(1)
  }

  if (systemdSystem.available && systemdSystem.installed) {
    if (!systemdSystem.active) {
      UI.info("Starting systemd service 'zee'...")
      const started = attemptSystemctlStart("system")
      if (!started.ok) {
        UI.error("Failed to start systemd service 'zee'.")
        if (started.details) UI.info(started.details)
        UI.info("Try: sudo systemctl start zee")
        process.exit(1)
      }
    }

    const url = await waitForHealthy(resolveUrl, 8000)
    if (url) return { url }

    UI.error("Systemd service 'zee' is active but unhealthy.")
    UI.info("Check: systemctl status zee")
    process.exit(1)
  }

  // 5. Start in-process
  try {
    await Daemon.acquireLock()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    UI.error(`Failed to acquire lock: ${message}`)
    process.exit(1)
  }

  const hostname = normalizeDaemonHost(network.hostname)
  const port = network.port && network.port !== 0 ? network.port : DEFAULT_DAEMON_PORT

  let proc: AlwaysOnProcess
  try {
    proc = await startAlwaysOnProcess({
      hostname,
      port,
      directory,
      alwaysOnProfile: true,
    })
  } catch (error) {
    await Daemon.removePidFile().catch(() => {})
    await Daemon.releaseLock().catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    UI.error(`Failed to start Zee process: ${message}`)
    process.exit(1)
  }

  // Setup signal handlers for the process (SIGTERM kills everything)
  await Daemon.setupSignalHandlers(proc.cleanup)

  process.on("uncaughtException", async (error) => {
    Log.Default.error("uncaught exception", { error: error.message, stack: error.stack })
    await proc.cleanup(undefined, error)
    process.exit(1)
  })

  process.on("unhandledRejection", (reason) => {
    Log.Default.error("unhandled rejection", { reason: String(reason) })
  })

  return { url: proc.url, proc }
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start zee tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start zee in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("headless", {
        type: "boolean",
        default: false,
        describe: "start without TUI (headless mode, same as `zee daemon`)",
      }),
  handler: async (args) => {
    const baseCwd = process.env.ZEE_ORIGINAL_PWD ?? process.env.PWD ?? process.cwd()
    const cwd = args.project ? path.resolve(baseCwd, args.project) : baseCwd
    try {
      process.chdir(cwd)
    } catch (e) {
      UI.error("Failed to change directory to " + cwd)
      return
    }

    const prompt = await iife(async () => {
      const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })

    const networkOpts = await resolveNetworkOptions(args)

    // Ensure the always-on process is running
    const { url, proc } = await ensureProcessRunning(networkOpts, cwd)

    if (args.headless) {
      // Headless mode: keep the process running without TUI
      if (!proc) {
        UI.info(`Process already running at ${url}`)
        return
      }
      UI.info(`Zee running headless at ${url}`)
      await new Promise(() => {}) // keep alive
      return
    }

    // Start TUI - when TUI exits, process keeps running
    let exitingForTerminalDetach = false
    const stopTerminalWatch = watchInteractiveTerminal((reason) => {
      if (exitingForTerminalDetach) return
      exitingForTerminalDetach = true
      Log.Default.warn("interactive terminal detached, exiting tui process", { reason })
      const shutdown = async () => {
        if (proc) {
          await proc.cleanup("SIGHUP")
        }
        process.exit(0)
      }
      void shutdown().catch((error) => {
        Log.Default.error("failed to shutdown after terminal detachment", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
        process.exit(1)
      })
    })

    const tuiPromise = tui({
      url,
      directory: cwd,
      fetch: createAuthorizedFetch(fetch),
      args: {
        continue: args.continue,
        sessionID: args.session,
        agent: args.agent,
        model: args.model,
        prompt,
      },
      onExit: proc
        ? undefined // TUI exit does NOT stop the process
        : undefined, // Attached to external process, nothing to clean up
    })

    try {
      await tuiPromise
    } finally {
      stopTerminalWatch()
    }

    // If we started the process in this invocation and the TUI exits,
    // the process keeps running in the background (PID file + lock).
    // User can reconnect with `zee attach` or stop with `zee daemon-stop`.
    if (proc) {
      UI.info("TUI detached. Process continues running in background.")
      UI.info(`Reconnect with: zee attach`)
      UI.info(`Stop with: zee daemon-stop`)
    }
  },
})
