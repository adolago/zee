/**
 * Daemon Install Wizard
 *
 * Installs zee daemon as a user systemd service (Linux only).
 * Zee daemon is the primary service and always embeds the Zee gateway.
 *
 * IMPORTANT: This does NOT install zee gateway separately. Zee gateway runs as a child process of zee daemon.
 */

import { execSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { Log } from "../../util/log"
import { UI } from "../ui"

const log = Log.create({ service: "daemon-install" })

// =============================================================================
// Constants
// =============================================================================

const SERVICE_DESCRIPTION = "Zee Daemon - AI Assistant Platform"

// Linux systemd user service
const SYSTEMD_UNIT_NAME = "zee.service"
const SYSTEMD_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user")
const SYSTEMD_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_UNIT_NAME)
const SYSTEMD_ASSERT_UNIT_NAME = "zee-assert.service"
const SYSTEMD_ASSERT_TIMER_NAME = "zee-assert.timer"
const SYSTEMD_ASSERT_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_ASSERT_UNIT_NAME)
const SYSTEMD_ASSERT_TIMER_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_ASSERT_TIMER_NAME)

// Legacy orchestration unit (cleaned up during install)
const SYSTEMD_ORCH_UNIT_NAME = "zee-orch.service"
const SYSTEMD_ORCH_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_ORCH_UNIT_NAME)

// Log paths
const LOG_DIR = path.join(Global.Path.state, "logs")
const STDOUT_LOG = path.join(LOG_DIR, "daemon.log")
const STDERR_LOG = path.join(LOG_DIR, "daemon.err.log")

// =============================================================================
// Types
// =============================================================================

export interface DaemonInstallOptions {
  port?: number
  hostname?: string
  gateway?: boolean
  gatewayForce?: boolean
  workingDirectory?: string
  force?: boolean
  nonInteractive?: boolean
}

export interface DaemonInstallResult {
  success: boolean
  platform: "linux" | "unsupported"
  servicePath?: string
  error?: string
  hints?: string[]
}

// =============================================================================
// Platform Detection
// =============================================================================

function getPlatform(): "linux" | "unsupported" {
  return os.platform() === "linux" ? "linux" : "unsupported"
}

function hasSystemd(): boolean {
  try {
    const result = spawnSync("systemctl", ["--user", "--version"], {
      stdio: "pipe",
      timeout: 5000,
    })
    return result.status === 0
  } catch {
    return false
  }
}

// =============================================================================
// Binary Resolution
// =============================================================================

function resolveZeeBinary(): string | null {
  const isExecutableZeeBinary = (candidate: string): boolean => {
    const base = path.basename(candidate).toLowerCase()
    if (base !== "zee" && base !== "zee.exe") return false
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  }

  // Check common locations
  const candidates = [
    // Bun global install
    path.join(os.homedir(), ".bun", "bin", "zee"),
    // User local bin
    path.join(os.homedir(), "bin", "zee"),
    path.join(os.homedir(), ".local", "bin", "zee"),
    // npm global
    "/usr/local/bin/zee",
    // Current process (if running from zee)
    path.basename(process.argv[0] ?? "").toLowerCase() === "zee" ? process.argv[0] : null,
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && isExecutableZeeBinary(candidate)) {
        return candidate
      }
    } catch {
      continue
    }
  }

  // Try to find via which
  try {
    const result = spawnSync("which", ["zee"], {
      encoding: "utf-8",
      timeout: 5000,
    })
    if (result.status === 0 && result.stdout.trim() && isExecutableZeeBinary(result.stdout.trim())) {
      return result.stdout.trim()
    }
  } catch {
    // Ignore
  }

  return null
}

// =============================================================================
// Environment Building
// =============================================================================

function buildServiceEnv(options: DaemonInstallOptions): Record<string, string> {
  const env: Record<string, string> = {
    HOME: os.homedir(),
    PATH: buildServicePath(),
    NODE_ENV: "production",
    ZEE_HEADLESS: "1",
    ZEE_ENFORCE_ALWAYS_ON: "1",
  }

  if (options.port) {
    env.ZEE_PORT = String(options.port)
  }

  if (options.hostname) {
    env.ZEE_HOSTNAME = options.hostname
  }

  return env
}

function buildServicePath(): string {
  const home = os.homedir()
  const pathParts: string[] = []

  // User binary directories (version managers, package managers)
  const userBinDirs = [
    path.join(home, ".bun", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".cargo", "bin"),
    // pnpm
    process.env.PNPM_HOME,
    path.join(home, ".local", "share", "pnpm"),
    // nvm
    process.env.NVM_BIN,
    // fnm
    process.env.FNM_MULTISHELL_PATH,
    // volta
    path.join(home, ".volta", "bin"),
    // asdf
    path.join(home, ".asdf", "shims"),
  ].filter(Boolean) as string[]

  for (const dir of userBinDirs) {
    if (fs.existsSync(dir)) {
      pathParts.push(dir)
    }
  }

  // System paths
  pathParts.push("/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin")

  return pathParts.join(":")
}

function resolveServiceWorkingDirectory(options: DaemonInstallOptions): string {
  if (options.workingDirectory && options.workingDirectory.trim()) {
    return options.workingDirectory.trim()
  }
  // Prefer the detected repository/source root so daemon state and local tools resolve consistently.
  const source = Global.Path.source
  return source && source.trim() ? source : os.homedir()
}

// =============================================================================
// Linux systemd
// =============================================================================

function generateSystemdAssertUnit(): string {
  return `[Unit]
Description=Zee daemon assertion
After=default.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env sh -c "systemctl --user is-active --quiet zee.service || systemctl --user start zee.service"

[Install]
WantedBy=default.target
`
}

function generateSystemdAssertTimer(): string {
  return `[Unit]
Description=Periodic Zee daemon assertion
After=default.target

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Unit=zee-assert.service

[Install]
WantedBy=timers.target
`
}

function generateSystemdDaemonUnit(binaryPath: string, options: DaemonInstallOptions): string {
  const args = ["daemon"]
  const workDir = resolveServiceWorkingDirectory(options)

  if (options.port) args.push("--port", String(options.port))
  if (options.hostname) args.push("--hostname", options.hostname)
  if (options.gatewayForce) args.push("--gateway-force")
  args.push("--runtime-guard-interval-ms", "30000")

  args.push("--directory", workDir)

  const execStart = [binaryPath, ...args].join(" ")
  const env = buildServiceEnv(options)
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join("\n")

  return `[Unit]
Description=${SERVICE_DESCRIPTION}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${workDir}
Restart=always
RestartSec=5
RestartPreventExitStatus=100
SuccessExitStatus=100
KillMode=control-group
TimeoutStopSec=15
KillSignal=SIGINT
SendSIGKILL=yes

# Environment
${envLines}

# Logging
StandardOutput=append:${STDOUT_LOG}
StandardError=append:${STDERR_LOG}

[Install]
WantedBy=default.target
`
}

async function ensureSystemdLinger(interactive: boolean): Promise<boolean> {
  const user = os.userInfo().username
  const lingerPath = `/var/lib/systemd/linger/${user}`

  // Check if already enabled
  if (fs.existsSync(lingerPath)) {
    return true
  }

  if (interactive) {
    const confirm = await prompts.confirm({
      message: `Enable systemd linger for user '${user}'? (Required for service to run after logout)`,
      initialValue: true,
    })

    if (prompts.isCancel(confirm) || !confirm) {
      return false
    }
  }

  // Try to enable linger
  try {
    const result = spawnSync("loginctl", ["enable-linger", user], {
      stdio: "pipe",
      timeout: 30000,
    })
    if (result.status === 0) {
      return true
    }

    // May need sudo
    if (interactive) {
      UI.warn("Linger requires sudo. You may be prompted for your password.")
    }
    const sudoResult = spawnSync("sudo", ["loginctl", "enable-linger", user], {
      stdio: "inherit",
      timeout: 60000,
    })
    return sudoResult.status === 0
  } catch {
    return false
  }
}

async function installSystemdService(binaryPath: string, options: DaemonInstallOptions): Promise<DaemonInstallResult> {
  const hints: string[] = []

  // Check systemd availability
  if (!hasSystemd()) {
    return {
      success: false,
      platform: "linux",
      error: "systemd user services not available. Is systemd running?",
    }
  }

  // Create directories
  try {
    fs.mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true })
    fs.mkdirSync(LOG_DIR, { recursive: true })
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      error: `Failed to create directories: ${err}`,
    }
  }

  // Ensure linger is enabled
  const lingerEnabled = await ensureSystemdLinger(!options.nonInteractive)
  if (!lingerEnabled) {
    hints.push("Warning: systemd linger not enabled. Service may stop when you log out.")
    hints.push("Enable with: sudo loginctl enable-linger $USER")
  }

  // Stop existing services if running
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
  } catch {
    // Ignore if not running
  }

  // Clean up legacy orchestration unit if present
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_ORCH_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_ORCH_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    if (fs.existsSync(SYSTEMD_ORCH_UNIT_PATH)) {
      fs.unlinkSync(SYSTEMD_ORCH_UNIT_PATH)
      log.info("removed legacy orchestration unit", { path: SYSTEMD_ORCH_UNIT_PATH })
    }
  } catch {
    // Ignore
  }

  // Generate and write unit file
  const unit = generateSystemdDaemonUnit(binaryPath, options)
  try {
    fs.writeFileSync(SYSTEMD_UNIT_PATH, unit, { mode: 0o644 })
    log.info("wrote systemd unit", { path: SYSTEMD_UNIT_PATH })
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      error: `Failed to write unit file: ${err}`,
    }
  }

  const assertUnit = generateSystemdAssertUnit()
  const assertTimer = generateSystemdAssertTimer()
  try {
    fs.writeFileSync(SYSTEMD_ASSERT_UNIT_PATH, assertUnit, { mode: 0o644 })
    fs.writeFileSync(SYSTEMD_ASSERT_TIMER_PATH, assertTimer, { mode: 0o644 })
    log.info("wrote zee assert units", { unit: SYSTEMD_ASSERT_UNIT_PATH, timer: SYSTEMD_ASSERT_TIMER_PATH })
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      servicePath: SYSTEMD_UNIT_PATH,
      error: `Failed to write assert timer units: ${err}`,
    }
  }

  // Reload systemd
  try {
    const result = spawnSync("systemctl", ["--user", "daemon-reload"], {
      stdio: "pipe",
      timeout: 10000,
    })
    if (result.status !== 0) {
      return {
        success: false,
        platform: "linux",
        servicePath: SYSTEMD_UNIT_PATH,
        error: `systemctl daemon-reload failed: ${result.stderr?.toString()}`,
      }
    }
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      servicePath: SYSTEMD_UNIT_PATH,
      error: `Failed to reload systemd: ${err}`,
    }
  }

  // Enable and start service
  try {
    spawnSync("systemctl", ["--user", "enable", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "enable", SYSTEMD_ASSERT_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "enable", "--now", SYSTEMD_ASSERT_TIMER_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    const startResult = spawnSync("systemctl", ["--user", "start", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    if (startResult.status !== 0) {
      hints.push(`Service may need manual start: systemctl --user start ${SYSTEMD_UNIT_NAME}`)
    }
  } catch {
    hints.push(`Service may need manual start: systemctl --user start ${SYSTEMD_UNIT_NAME}`)
  }

  hints.push(`Logs: journalctl --user -u ${SYSTEMD_UNIT_NAME} -f`)
  hints.push(`Or: ${STDOUT_LOG}`)
  hints.push(`Stop: systemctl --user stop ${SYSTEMD_UNIT_NAME}`)
  hints.push(`Restart: systemctl --user restart ${SYSTEMD_UNIT_NAME}`)
  hints.push(`Status: systemctl --user status ${SYSTEMD_UNIT_NAME}`)
  hints.push(`Assert timer: systemctl --user status ${SYSTEMD_ASSERT_TIMER_NAME}`)

  return {
    success: true,
    platform: "linux",
    servicePath: SYSTEMD_UNIT_PATH,
    hints,
  }
}

async function uninstallSystemdService(): Promise<DaemonInstallResult> {
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_ASSERT_TIMER_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_ASSERT_TIMER_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_ASSERT_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_ASSERT_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
  } catch {
    // Ignore if not running
  }

  // Also clean up legacy orchestration unit
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_ORCH_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_ORCH_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    })
  } catch {
    // Ignore
  }

  try {
    if (fs.existsSync(SYSTEMD_UNIT_PATH)) {
      fs.unlinkSync(SYSTEMD_UNIT_PATH)
    }
    if (fs.existsSync(SYSTEMD_ORCH_UNIT_PATH)) {
      fs.unlinkSync(SYSTEMD_ORCH_UNIT_PATH)
    }
    if (fs.existsSync(SYSTEMD_ASSERT_UNIT_PATH)) {
      fs.unlinkSync(SYSTEMD_ASSERT_UNIT_PATH)
    }
    if (fs.existsSync(SYSTEMD_ASSERT_TIMER_PATH)) {
      fs.unlinkSync(SYSTEMD_ASSERT_TIMER_PATH)
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], {
      stdio: "pipe",
      timeout: 10000,
    })
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      error: `Failed to remove unit file: ${err}`,
    }
  }

  return {
    success: true,
    platform: "linux",
    hints: ["systemd service removed successfully"],
  }
}

// =============================================================================
// Main Install/Uninstall Functions
// =============================================================================

export async function installDaemon(options: DaemonInstallOptions = {}): Promise<DaemonInstallResult> {
  const platform = getPlatform()

  if (platform === "unsupported") {
    return {
      success: false,
      platform: "unsupported",
      error: `Platform '${os.platform()}' is not supported. Only Linux is supported.`,
    }
  }

  // Find zee binary
  const binaryPath = resolveZeeBinary()
  if (!binaryPath) {
    return {
      success: false,
      platform,
      error: "Could not find zee binary. Ensure it's installed and in PATH.",
      hints: ["Install with: bun install -g zee", "Or: npm install -g zee"],
    }
  }

  log.info("resolved binary", { path: binaryPath })

  // Check if already installed (unless force)
  if (!options.force) {
    if (fs.existsSync(SYSTEMD_UNIT_PATH)) {
      return {
        success: true,
        platform,
        servicePath: SYSTEMD_UNIT_PATH,
        hints: ["Service already installed. Use --force to reinstall."],
      }
    }
  }

  return installSystemdService(binaryPath, options)
}

export async function uninstallDaemon(): Promise<DaemonInstallResult> {
  const platform = getPlatform()

  if (platform === "unsupported") {
    return {
      success: false,
      platform: "unsupported",
      error: `Platform '${os.platform()}' is not supported.`,
    }
  }

  return uninstallSystemdService()
}

type UnitStatus = {
  name: string
  path: string
  installed: boolean
  running: boolean
  enabled: boolean
}

function getUnitStatus(name: string, servicePath: string): UnitStatus {
  const installed = fs.existsSync(servicePath)
  let running = false
  let enabled = false

  if (installed) {
    try {
      const activeResult = spawnSync("systemctl", ["--user", "is-active", name], { stdio: "pipe", timeout: 5000 })
      running = activeResult.stdout?.toString().trim() === "active"
    } catch {
      running = false
    }

    try {
      const enabledResult = spawnSync("systemctl", ["--user", "is-enabled", name], { stdio: "pipe", timeout: 5000 })
      enabled = enabledResult.stdout?.toString().trim() === "enabled"
    } catch {
      enabled = false
    }
  }

  return {
    name,
    path: servicePath,
    installed,
    running,
    enabled,
  }
}

export function getDaemonServiceStatus(): {
  installed: boolean
  running: boolean
  platform: string
  servicePath?: string
  units: {
    daemon: UnitStatus
  }
} {
  const platform = getPlatform()

  if (platform === "unsupported") {
    const daemon = {
      name: SYSTEMD_UNIT_NAME,
      path: SYSTEMD_UNIT_PATH,
      installed: false,
      running: false,
      enabled: false,
    }
    return {
      installed: false,
      running: false,
      platform: os.platform(),
      units: { daemon },
    }
  }

  const daemon = getUnitStatus(SYSTEMD_UNIT_NAME, SYSTEMD_UNIT_PATH)

  return {
    installed: daemon.installed,
    running: daemon.running,
    platform,
    servicePath: SYSTEMD_UNIT_PATH,
    units: { daemon },
  }
}

// =============================================================================
// CLI Commands
// =============================================================================

export const DaemonInstallCommand = cmd({
  command: "daemon-install",
  describe: "Install zee daemon as a user systemd service (Linux)",
  builder: (yargs) =>
    yargs
      .option("port", {
        describe: "Daemon port",
        type: "number",
        default: 3210,
      })
      .option("hostname", {
        describe: "Daemon hostname",
        type: "string",
        default: "127.0.0.1",
      })
      .option("gateway-force", {
        describe: "Force gateway start even if preflight fails",
        type: "boolean",
        default: false,
      })
      .option("directory", {
        describe: "Working directory for daemon",
        type: "string",
      })
      .option("force", {
        describe: "Force reinstall if already installed",
        type: "boolean",
        default: false,
      })
      .option("non-interactive", {
        describe: "Run without prompts",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "Output as JSON",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const options: DaemonInstallOptions = {
      port: args.port as number,
      hostname: args.hostname as string,
      gateway: true,
      gatewayForce: args["gateway-force"] as boolean,
      workingDirectory: args.directory as string | undefined,
      force: args.force as boolean,
      nonInteractive: args["non-interactive"] as boolean,
    }

    // Interactive wizard (unless non-interactive)
    if (!options.nonInteractive && !args.json) {
      prompts.intro("Zee Daemon Install Wizard")

      const platform = getPlatform()
      if (platform === "unsupported") {
        prompts.cancel(`Platform '${os.platform()}' is not supported.`)
        process.exit(1)
      }

      prompts.log.info("Platform: Linux (systemd)")

      // Check existing installation
      const status = getDaemonServiceStatus()
      if (status.units.daemon.installed && !options.force) {
        const reinstall = await prompts.confirm({
          message: `Service already installed. Reinstall?`,
          initialValue: false,
        })
        if (prompts.isCancel(reinstall) || !reinstall) {
          prompts.outro("Installation cancelled.")
          process.exit(0)
        }
        options.force = true
      }

      prompts.log.step("Installing service...")
    }

    const result = await installDaemon(options)

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.success) {
      UI.success("Zee daemon installed successfully!")
      console.log(`\nService: ${result.servicePath}`)
      if (result.hints?.length) {
        console.log("\nUseful commands:")
        for (const hint of result.hints) {
          console.log(`  ${hint}`)
        }
      }
    } else {
      UI.error(`Installation failed: ${result.error}`)
      if (result.hints?.length) {
        console.log("\nHints:")
        for (const hint of result.hints) {
          console.log(`  ${hint}`)
        }
      }
      process.exit(1)
    }
  },
})

export const DaemonUninstallCommand = cmd({
  command: "daemon-uninstall",
  describe: "Uninstall zee daemon services",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const result = await uninstallDaemon()

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.success) {
      UI.success("Zee daemon services removed.")
      if (result.hints?.length) {
        for (const hint of result.hints) {
          console.log(`  ${hint}`)
        }
      }
    } else {
      UI.error(`Uninstall failed: ${result.error}`)
      process.exit(1)
    }
  },
})

export const DaemonServiceStatusCommand = cmd({
  command: "daemon-service-status",
  describe: "Check zee daemon services status",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const status = getDaemonServiceStatus()

    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      console.log("Zee Daemon Service Status")
      console.log(`  Platform:  ${status.platform}`)
      console.log(`  Installed: ${status.installed ? "yes" : "no"}`)
      console.log(`  Running:   ${status.running ? "yes" : "no"}`)
      console.log("")
      console.log(`  ${status.units.daemon.name}`)
      console.log(`    Installed: ${status.units.daemon.installed ? "yes" : "no"}`)
      console.log(`    Running:   ${status.units.daemon.running ? "yes" : "no"}`)
      console.log(`    Enabled:   ${status.units.daemon.enabled ? "yes" : "no"}`)
      console.log(`    Path:      ${status.units.daemon.path}`)
    }
  },
})
