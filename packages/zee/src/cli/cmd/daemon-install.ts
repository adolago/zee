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
import { syncBundledSkillsToMachine } from "../../skill/mirror"
import {
  resolveConfigDir,
  resolveDataDir,
  resolveInstallRoot,
  resolveLogsDir,
  resolvePolicyPath,
  resolveStateDir,
  resolveWorkspaceDir,
} from "../../global/dirs"

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

// Windows Service Control Manager service
const WINDOWS_SERVICE_NAME = "Zee"
const WINDOWS_SERVICE_DISPLAY_NAME = "Zee Daemon"
const WINDOWS_SERVICE_ACCOUNT = `NT SERVICE\\${WINDOWS_SERVICE_NAME}`
const WINDOWS_SERVICE_REGISTRY_KEY = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${WINDOWS_SERVICE_NAME}`

// Log paths
const LOG_DIR = resolveLogsDir()
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
  binaryPath?: string
  force?: boolean
  nonInteractive?: boolean
  start?: boolean
  scope?: "machine" | "user"
  serviceAccount?: "virtual" | "local-system" | "interactive-user"
}

export interface DaemonInstallResult {
  success: boolean
  platform: "linux" | "windows" | "unsupported"
  servicePath?: string
  error?: string
  hints?: string[]
}

// =============================================================================
// Platform Detection
// =============================================================================

function getPlatform(): "linux" | "windows" | "unsupported" {
  if (os.platform() === "linux") return "linux"
  if (os.platform() === "win32") return "windows"
  return "unsupported"
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
    if (base !== "zee" && base !== "zee.exe" && base !== "zee.cmd") return false
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  }

  // Check common locations
  const windowsDistCandidates =
    process.platform === "win32"
      ? [
          path.join(
            Global.Path.source,
            "packages",
            "zee",
            "dist",
            "@adolago",
            `zee-windows-${process.arch}`,
            "bin",
            "zee.exe",
          ),
          path.join(
            Global.Path.source,
            "packages",
            "zee",
            "dist",
            "@adolago",
            `zee-windows-${process.arch}-baseline`,
            "bin",
            "zee.exe",
          ),
          path.join(resolveInstallRoot(), "bin", "zee.exe"),
          path.join(os.homedir(), ".bun", "bin", "zee.exe"),
          path.join(os.homedir(), ".bun", "bin", "zee.cmd"),
        ]
      : []

  const candidates = [
    // Current process (if running from a compiled zee binary).
    path.basename(process.execPath).toLowerCase() === "zee.exe" ||
    path.basename(process.execPath).toLowerCase() === "zee"
      ? process.execPath
      : null,
    // Current argv (when launched via a direct shim).
    ["zee", "zee.exe", "zee.cmd"].includes(path.basename(process.argv[0] ?? "").toLowerCase()) ? process.argv[0] : null,
    ...windowsDistCandidates,
    // Bun global install
    path.join(os.homedir(), ".bun", "bin", "zee"),
    // User local bin
    path.join(os.homedir(), "bin", "zee"),
    path.join(os.homedir(), ".local", "bin", "zee"),
    // npm global
    "/usr/local/bin/zee",
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

  // Try to find via platform PATH lookup.
  try {
    const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["zee"], {
      encoding: "utf-8",
      timeout: 5000,
    })
    const found = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && isExecutableZeeBinary(line))
    if (result.status === 0 && found) {
      return found
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
TasksMax=512

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

  // Mirror bundled curated skills to machine-level skill directory.
  try {
    const mirror = await syncBundledSkillsToMachine({ reason: "daemon-install" })
    if (mirror.status === "synced") {
      hints.push(`Curated skills mirrored: ${mirror.skillCount} -> ${mirror.destination}`)
    } else if (mirror.status === "failed") {
      hints.push(`Warning: curated skill mirror failed (${mirror.reason ?? "unknown error"})`)
    }
  } catch (error) {
    hints.push(`Warning: curated skill mirror failed (${error instanceof Error ? error.message : String(error)})`)
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
// Windows Service Control Manager
// =============================================================================

function quoteWindowsCommandArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function runWindowsCommand(
  command: string,
  args: string[],
  options: { timeout?: number; ignoreFailure?: boolean } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: "pipe",
    timeout: options.timeout ?? 30_000,
    windowsHide: true,
  })

  const status = typeof result.status === "number" ? result.status : null
  if (!options.ignoreFailure && status !== 0) {
    const details = result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `${command} failed`
    throw new Error(details)
  }
  return {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function runSc(args: string[], options: { timeout?: number; ignoreFailure?: boolean } = {}) {
  return runWindowsCommand("sc.exe", args, options)
}

function windowsServiceBinPath(binaryPath: string, options: DaemonInstallOptions): string {
  const args = ["daemon"]
  const workDir = resolveServiceWorkingDirectory(options)
  args.push("--port", String(options.port ?? 3210))
  args.push("--hostname", options.hostname ?? "127.0.0.1")
  if (options.gatewayForce) args.push("--gateway-force")
  args.push("--runtime-guard-interval-ms", "30000")
  args.push("--directory", workDir)
  return [
    quoteWindowsCommandArg(binaryPath),
    ...args.map((arg) => (arg.includes(" ") ? quoteWindowsCommandArg(arg) : arg)),
  ].join(" ")
}

function scopedWindowsServiceEnv(
  options: DaemonInstallOptions,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const scope = options.scope ?? "machine"
  return { ...env, ZEE_WINDOWS_SCOPE: scope } as NodeJS.ProcessEnv
}

function windowsServiceDirs(options: DaemonInstallOptions, env: NodeJS.ProcessEnv = process.env) {
  const scopedEnv = scopedWindowsServiceEnv(options, env)
  const serviceEnv = resolveWindowsServiceEnvironment(options, env)

  return {
    stateDir: serviceEnv.ZEE_STATE_DIR ?? resolveStateDir(scopedEnv, "win32"),
    dataDir: resolveDataDir(scopedEnv, "win32"),
    configDir: serviceEnv.ZEE_CONFIG_DIR,
    logDir: serviceEnv.ZEE_LOG_DIR,
    workspaceDir: serviceEnv.ZEE_WORKSPACE_DIR,
    policyPath: serviceEnv.ZEE_POLICY_FILE,
  }
}

export function resolveWindowsServiceEnvironment(
  options: DaemonInstallOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const scope = options.scope ?? "machine"
  const scopedEnv = scopedWindowsServiceEnv(options, env)
  const serviceEnv: Record<string, string> = {
    NODE_ENV: "production",
    ZEE_HEADLESS: "1",
    ZEE_ENFORCE_ALWAYS_ON: "1",
    ZEE_WINDOWS_SCOPE: scope,
    ZEE_CONFIG_DIR: resolveConfigDir(scopedEnv, "win32"),
    ZEE_LOG_DIR: resolveLogsDir(scopedEnv, "win32"),
    ZEE_WORKSPACE_DIR: resolveWorkspaceDir(scopedEnv, "win32"),
    ZEE_POLICY_FILE: resolvePolicyPath(scopedEnv, "win32"),
  }

  if (env.ZEE_STATE_DIR?.trim()) serviceEnv.ZEE_STATE_DIR = resolveStateDir(scopedEnv, "win32")
  if (options.port) serviceEnv.ZEE_PORT = String(options.port)
  if (options.hostname) serviceEnv.ZEE_HOSTNAME = options.hostname
  return serviceEnv
}

function setWindowsServiceEnvironment(env: Record<string, string>) {
  const data = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\\0")
  runWindowsCommand("reg.exe", [
    "add",
    WINDOWS_SERVICE_REGISTRY_KEY,
    "/v",
    "Environment",
    "/t",
    "REG_MULTI_SZ",
    "/d",
    data,
    "/f",
  ])
}

function ensureWindowsDirectories(options: DaemonInstallOptions) {
  const serviceDirs = windowsServiceDirs(options)
  const requiredDirs = [
    serviceDirs.stateDir,
    serviceDirs.dataDir,
    serviceDirs.configDir,
    serviceDirs.logDir,
    serviceDirs.workspaceDir,
    path.dirname(serviceDirs.policyPath),
  ]
  for (const dir of Array.from(new Set(requiredDirs))) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function grantWindowsServiceAcls(options: DaemonInstallOptions): string[] {
  const hints: string[] = []
  const serviceAccount = options.serviceAccount ?? "virtual"
  if (serviceAccount !== "virtual") return hints

  const dirs = windowsServiceDirs(options)
  const writableDirs = [dirs.stateDir, dirs.dataDir, dirs.configDir, dirs.logDir, dirs.workspaceDir]
  for (const dir of Array.from(new Set(writableDirs))) {
    const result = runWindowsCommand(
      "icacls.exe",
      [dir, "/grant", `${WINDOWS_SERVICE_ACCOUNT}:(OI)(CI)M`, "/T", "/C"],
      { ignoreFailure: true, timeout: 60_000 },
    )
    if (result.status !== 0) {
      hints.push(`Warning: failed to grant ${WINDOWS_SERVICE_ACCOUNT} access to ${dir}`)
    }
  }

  return hints
}

function registerWindowsEventSource(): string | undefined {
  const result = runWindowsCommand(
    "eventcreate.exe",
    [
      "/ID",
      "1",
      "/L",
      "APPLICATION",
      "/T",
      "INFORMATION",
      "/SO",
      WINDOWS_SERVICE_NAME,
      "/D",
      "Zee Event Log source initialized",
    ],
    { ignoreFailure: true, timeout: 15_000 },
  )
  if (result.status !== 0) {
    return "Warning: failed to initialize Windows Event Log source for Zee"
  }
  return undefined
}

function writeWindowsDaemonEnvTemplate(options: DaemonInstallOptions) {
  const env = resolveWindowsServiceEnvironment(options)
  const envPath = path.join(env.ZEE_CONFIG_DIR, "daemon.env")
  if (fs.existsSync(envPath)) return
  fs.writeFileSync(
    envPath,
    [
      "# Zee Daemon Environment Configuration",
      "# Add service-level provider keys here, or use Windows Credential Manager/DPAPI-backed config.",
      "",
      "# ANTHROPIC_API_KEY=your-key-here",
      "# OPENAI_API_KEY=your-key-here",
      "",
    ].join("\r\n"),
    { mode: 0o600 },
  )
}

function windowsServiceExists(): boolean {
  const result = runSc(["query", WINDOWS_SERVICE_NAME], { ignoreFailure: true, timeout: 10_000 })
  return result.status === 0
}

function waitForWindowsServiceDeleted(timeoutMs = 20_000): boolean {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!windowsServiceExists()) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  return !windowsServiceExists()
}

function stopWindowsServiceIfRunning() {
  runSc(["stop", WINDOWS_SERVICE_NAME], { ignoreFailure: true, timeout: 30_000 })
}

function deleteWindowsService() {
  stopWindowsServiceIfRunning()
  runSc(["delete", WINDOWS_SERVICE_NAME], { ignoreFailure: true, timeout: 30_000 })
  waitForWindowsServiceDeleted()
}

async function installWindowsService(binaryPath: string, options: DaemonInstallOptions): Promise<DaemonInstallResult> {
  const hints: string[] = []
  const normalizedBinary = path.resolve(binaryPath)

  if (path.basename(normalizedBinary).toLowerCase() !== "zee.exe") {
    return {
      success: false,
      platform: "windows",
      error: "Windows service installation requires the native zee.exe binary, not a shell launcher.",
      hints: ["Build with: cd packages/zee && bun run build", "Or pass: zee daemon-install --binary <path-to-zee.exe>"],
    }
  }

  if (!fs.existsSync(normalizedBinary)) {
    return {
      success: false,
      platform: "windows",
      error: `Binary not found: ${normalizedBinary}`,
    }
  }

  if (windowsServiceExists()) {
    if (!options.force) {
      return {
        success: true,
        platform: "windows",
        servicePath: WINDOWS_SERVICE_REGISTRY_KEY,
        hints: ["Service already installed. Use --force to reinstall."],
      }
    }
    deleteWindowsService()
  }

  try {
    ensureWindowsDirectories(options)
    writeWindowsDaemonEnvTemplate(options)
  } catch (error) {
    return {
      success: false,
      platform: "windows",
      error: `Failed to prepare Windows service directories: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  try {
    const mirror = await syncBundledSkillsToMachine({ reason: "windows-daemon-install" })
    if (mirror.status === "synced") {
      hints.push(`Curated skills mirrored: ${mirror.skillCount} -> ${mirror.destination}`)
    } else if (mirror.status === "failed") {
      hints.push(`Warning: curated skill mirror failed (${mirror.reason ?? "unknown error"})`)
    }
  } catch (error) {
    hints.push(`Warning: curated skill mirror failed (${error instanceof Error ? error.message : String(error)})`)
  }

  hints.push(...grantWindowsServiceAcls(options))
  const eventSourceWarning = registerWindowsEventSource()
  if (eventSourceWarning) hints.push(eventSourceWarning)

  const createArgs = [
    "create",
    WINDOWS_SERVICE_NAME,
    "binPath=",
    windowsServiceBinPath(normalizedBinary, options),
    "DisplayName=",
    WINDOWS_SERVICE_DISPLAY_NAME,
    "start=",
    "delayed-auto",
  ]
  if ((options.serviceAccount ?? "virtual") === "virtual") {
    createArgs.push("obj=", WINDOWS_SERVICE_ACCOUNT, "password=", "")
  }
  if (options.serviceAccount === "local-system") {
    createArgs.push("obj=", "LocalSystem")
  }

  try {
    runSc(createArgs, { timeout: 60_000 })
    runSc(["description", WINDOWS_SERVICE_NAME, SERVICE_DESCRIPTION], { ignoreFailure: true })
    runSc(["sidtype", WINDOWS_SERVICE_NAME, "unrestricted"], { ignoreFailure: true })
    runSc(
      ["failure", WINDOWS_SERVICE_NAME, "reset=", "86400", "actions=", "restart/5000/restart/10000/restart/30000"],
      {
        ignoreFailure: true,
      },
    )
    runSc(["failureflag", WINDOWS_SERVICE_NAME, "1"], { ignoreFailure: true })
    setWindowsServiceEnvironment(resolveWindowsServiceEnvironment(options))

    if (options.start ?? true) {
      const start = runSc(["start", WINDOWS_SERVICE_NAME], { ignoreFailure: true, timeout: 60_000 })
      if (start.status !== 0) {
        hints.push(`Service installed but did not start: ${start.stderr.trim() || start.stdout.trim()}`)
      }
    }
  } catch (error) {
    return {
      success: false,
      platform: "windows",
      servicePath: WINDOWS_SERVICE_REGISTRY_KEY,
      error: `Failed to install Windows service: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  hints.push(`Service: ${WINDOWS_SERVICE_NAME}`)
  hints.push(`Logs: ${resolveWindowsServiceEnvironment(options).ZEE_LOG_DIR}`)
  hints.push(`Status: zee daemon-service-status`)
  hints.push(`Stop: sc.exe stop ${WINDOWS_SERVICE_NAME}`)
  hints.push(`Restart: sc.exe stop ${WINDOWS_SERVICE_NAME} && sc.exe start ${WINDOWS_SERVICE_NAME}`)

  return {
    success: true,
    platform: "windows",
    servicePath: WINDOWS_SERVICE_REGISTRY_KEY,
    hints,
  }
}

async function uninstallWindowsService(options: { removeData?: boolean } = {}): Promise<DaemonInstallResult> {
  if (windowsServiceExists()) {
    deleteWindowsService()
  }

  const hints = ["Windows service removed successfully"]
  if (options.removeData) {
    const dirs = windowsServiceDirs({ scope: "machine" })
    for (const dir of [dirs.stateDir, dirs.dataDir, dirs.configDir, dirs.logDir, dirs.workspaceDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch (error) {
        hints.push(`Warning: failed to remove ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } else {
    hints.push("Data kept. Use --remove-data to delete service state and config.")
  }

  return {
    success: true,
    platform: "windows",
    servicePath: WINDOWS_SERVICE_REGISTRY_KEY,
    hints,
  }
}

function parseScValue(output: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = output.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"))
  return match?.[1]?.trim()
}

export function parseWindowsServiceStatus(
  query: { status: number | null; stdout: string },
  qc?: { stdout: string },
): UnitStatus {
  const installed = query.status === 0
  const state = parseScValue(query.stdout, "STATE")
  const pidRaw = parseScValue(query.stdout, "PID")
  const pid = pidRaw ? Number.parseInt(pidRaw, 10) : undefined
  const startType = qc ? parseScValue(qc.stdout, "START_TYPE") : undefined
  const account = qc ? parseScValue(qc.stdout, "SERVICE_START_NAME") : undefined
  const binaryPath = qc ? parseScValue(qc.stdout, "BINARY_PATH_NAME") : undefined
  const enabled = Boolean(startType && /AUTO_START/i.test(startType))

  return {
    name: WINDOWS_SERVICE_NAME,
    path: WINDOWS_SERVICE_REGISTRY_KEY,
    installed,
    running: Boolean(state && /RUNNING/i.test(state)),
    enabled,
    pid: Number.isFinite(pid) && pid && pid > 0 ? pid : undefined,
    startType,
    account,
    binaryPath,
  }
}

function getWindowsUnitStatus(): UnitStatus {
  const query = runSc(["queryex", WINDOWS_SERVICE_NAME], { ignoreFailure: true, timeout: 10_000 })
  const qc = query.status === 0 ? runSc(["qc", WINDOWS_SERVICE_NAME], { ignoreFailure: true, timeout: 10_000 }) : undefined
  return parseWindowsServiceStatus(query, qc)
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
  const binaryPath = options.binaryPath ? path.resolve(options.binaryPath) : resolveZeeBinary()
  if (!binaryPath) {
    return {
      success: false,
      platform,
      error: "Could not find zee binary. Ensure it's installed and in PATH.",
      hints:
        platform === "windows"
          ? ["Install the Zee MSI, or pass: zee daemon-install --binary <path-to-zee.exe>"]
          : ["Install with: bun install -g zee", "Or: npm install -g zee"],
    }
  }

  log.info("resolved binary", { path: binaryPath })

  if (platform === "windows") {
    return installWindowsService(binaryPath, options)
  }

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

export async function uninstallDaemon(options: { removeData?: boolean } = {}): Promise<DaemonInstallResult> {
  const platform = getPlatform()

  if (platform === "unsupported") {
    return {
      success: false,
      platform: "unsupported",
      error: `Platform '${os.platform()}' is not supported.`,
    }
  }

  if (platform === "windows") {
    return uninstallWindowsService(options)
  }

  return uninstallSystemdService()
}

export type UnitStatus = {
  name: string
  path: string
  installed: boolean
  running: boolean
  enabled: boolean
  pid?: number
  startType?: string
  account?: string
  binaryPath?: string
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

  if (platform === "windows") {
    const daemon = getWindowsUnitStatus()
    return {
      installed: daemon.installed,
      running: daemon.running,
      platform,
      servicePath: WINDOWS_SERVICE_REGISTRY_KEY,
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
  describe: "Install zee daemon as a managed service (systemd on Linux, Windows Service on Windows)",
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
      .option("binary", {
        describe: "Path to zee native binary to register with the service manager",
        type: "string",
      })
      .option("force", {
        describe: "Force reinstall if already installed",
        type: "boolean",
        default: false,
      })
      .option("start", {
        describe: "Start the service after installation",
        type: "boolean",
        default: true,
      })
      .option("scope", {
        describe: "Windows install scope",
        type: "string",
        choices: ["machine", "user"],
        default: "machine",
      })
      .option("service-account", {
        describe: "Windows service account",
        type: "string",
        choices: ["virtual", "local-system"],
        default: "virtual",
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
      binaryPath: args.binary as string | undefined,
      force: args.force as boolean,
      start: args.start as boolean,
      scope: args.scope as "machine" | "user",
      serviceAccount: args["service-account"] as "virtual" | "local-system",
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

      prompts.log.info(
        platform === "windows" ? "Platform: Windows (Service Control Manager)" : "Platform: Linux (systemd)",
      )

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
    yargs
      .option("remove-data", {
        describe: "Windows: remove service data/config/log directories after unregistering the service",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "Output as JSON",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const result = await uninstallDaemon({ removeData: Boolean(args["remove-data"]) })

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
      if (status.units.daemon.pid) console.log(`    PID:       ${status.units.daemon.pid}`)
      if (status.units.daemon.account) console.log(`    Account:   ${status.units.daemon.account}`)
      if (status.units.daemon.startType) console.log(`    Start:     ${status.units.daemon.startType}`)
      if (status.units.daemon.binaryPath) console.log(`    Binary:    ${status.units.daemon.binaryPath}`)
    }
  },
})
