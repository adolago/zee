/**
 * @file Runtime Checks
 * @description Core runtime environment health checks
 */

import { execFileSync } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { CheckResult, CheckOptions } from "../types"
import { Config } from "../../config/config"
import { resolveConfigDir, resolveLogsDir, resolveStateDir } from "../../global/dirs"
import { probeOpenBBAvailability, resolveOpenBBRuntime, type OpenBBAvailability } from "../../openbb/runtime"
import { probeOpenBBWorkspaceAvailability } from "../../openbb/workspace"

/** Minimum required Bun version */
const FALLBACK_MIN_BUN_VERSION = "1.0.0"

/** Minimum required disk space in GB */
const MIN_DISK_SPACE_GB = 1

/** Minimum required memory in MB */
const MIN_MEMORY_MB = 512

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  return resolveConfigDir()
}

/**
 * Get the state directory path
 */
function getStateDir(): string {
  return resolveStateDir()
}

/**
 * Get the logs directory path
 */
function getLogsDir(): string {
  return resolveLogsDir()
}

async function resolveRuntimeConfig(): Promise<Config.Info | undefined> {
  return (await Config.get().catch(async () => Config.global().catch(() => undefined))) as Config.Info | undefined
}

/**
 * Compare two semantic version strings
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((p) => parseInt(p, 10) || 0)
  const partsB = b.split(".").map((p) => parseInt(p, 10) || 0)

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA !== numB) return numA - numB
  }
  return 0
}

async function resolveMinimumBunVersion(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "..", "..", "package.json"),
  ]
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf-8")
      const parsed = JSON.parse(raw) as { engines?: { bun?: string } }
      const range = parsed.engines?.bun?.trim()
      const match = range?.match(/\d+(?:\.\d+){0,2}/)
      if (match?.[0]) return match[0]
    } catch {
      // Try the next candidate.
    }
  }
  return FALLBACK_MIN_BUN_VERSION
}

/**
 * Check Bun runtime version
 */
async function checkBunVersion(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const minBunVersion = await resolveMinimumBunVersion()
    const output = execFileSync("bun", ["--version"], { encoding: "utf-8" }).trim()
    const version = output.replace(/^v/, "")
    const meetsMinimum = compareVersions(version, minBunVersion) >= 0

    return {
      id: "runtime.bun-version",
      name: "Bun Version",
      category: "runtime",
      status: meetsMinimum ? "pass" : "fail",
      message: meetsMinimum
        ? `Bun ${version} (required: ≥${minBunVersion})`
        : `Bun ${version} is below minimum ${minBunVersion}`,
      severity: meetsMinimum ? "info" : "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { version, minVersion: minBunVersion },
    }
  } catch (error) {
    return {
      id: "runtime.bun-version",
      name: "Bun Version",
      category: "runtime",
      status: "fail",
      message: "Bun not found in PATH",
      details: "Install Bun from https://bun.sh",
      severity: "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check a directory exists and is writable
 */
async function checkDirectory(type: "config" | "state" | "logs", dirPath: string): Promise<CheckResult> {
  const start = Date.now()
  const names = { config: "Config", state: "State", logs: "Log" }

  try {
    // Check if exists
    try {
      await fs.access(dirPath)
    } catch {
      // Doesn't exist, can auto-fix
      return {
        id: `runtime.${type}-dir`,
        name: `${names[type]} Directory`,
        category: "runtime",
        status: "warn",
        message: `${names[type]} directory missing: ${dirPath}`,
        severity: "warning",
        durationMs: Date.now() - start,
        autoFixable: true,
        fix: async () => {
          await fs.mkdir(dirPath, { recursive: true })
          return { success: true, message: `Created ${dirPath}` }
        },
      }
    }

    // Check if writable
    const testFile = path.join(dirPath, ".write-test")
    try {
      await fs.writeFile(testFile, "test")
      await fs.unlink(testFile)
    } catch {
      return {
        id: `runtime.${type}-dir`,
        name: `${names[type]} Directory`,
        category: "runtime",
        status: "fail",
        message: `${names[type]} directory not writable: ${dirPath}`,
        details: `Check permissions: ls -la ${path.dirname(dirPath)}`,
        severity: "error",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    return {
      id: `runtime.${type}-dir`,
      name: `${names[type]} Directory`,
      category: "runtime",
      status: "pass",
      message: `${dirPath} [writable]`,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  } catch (error) {
    return {
      id: `runtime.${type}-dir`,
      name: `${names[type]} Directory`,
      category: "runtime",
      status: "fail",
      message: `Failed to check ${type} directory`,
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check available disk space
 */
async function checkDiskSpace(): Promise<CheckResult> {
  const start = Date.now()

  try {
    let available: number
    if (process.platform === "win32") {
      const root = path.parse(getStateDir()).root.replace(/\\$/, "")
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `$d = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq '${root}' } | Select-Object -First 1; if ($null -ne $d) { [math]::Floor($d.FreeSpace / 1GB) }`,
        ],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      ).trim()
      available = Number.parseInt(output, 10)
    } else {
      const output = execFileSync("df", ["-k", os.homedir()], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      const line = output.trim().split(/\r?\n/)[1] ?? ""
      const parts = line.trim().split(/\s+/)
      available = Math.floor(Number.parseInt(parts[3] ?? "0", 10) / 1024 / 1024)
    }

    if (!Number.isFinite(available)) throw new Error("disk space unavailable")

    const isOk = available >= MIN_DISK_SPACE_GB

    return {
      id: "runtime.disk-space",
      name: "Disk Space",
      category: "runtime",
      status: isOk ? "pass" : "warn",
      message: `${available} GB available${isOk ? "" : ` (need >${MIN_DISK_SPACE_GB} GB)`}`,
      severity: isOk ? "info" : "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { availableGB: available, minGB: MIN_DISK_SPACE_GB },
    }
  } catch {
    return {
      id: "runtime.disk-space",
      name: "Disk Space",
      category: "runtime",
      status: "skip",
      message: "Could not determine disk space",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check available memory
 */
async function checkMemory(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const freeBytes = os.freemem()
    const freeMB = Math.round(freeBytes / 1024 / 1024)
    const totalBytes = os.totalmem()
    const totalMB = Math.round(totalBytes / 1024 / 1024)

    const isOk = freeMB >= MIN_MEMORY_MB

    return {
      id: "runtime.memory",
      name: "Available Memory",
      category: "runtime",
      status: isOk ? "pass" : "warn",
      message: `${freeMB} MB free / ${totalMB} MB total${isOk ? "" : ` (need >${MIN_MEMORY_MB} MB)`}`,
      severity: isOk ? "info" : "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { freeMB, totalMB, minMB: MIN_MEMORY_MB },
    }
  } catch {
    return {
      id: "runtime.memory",
      name: "Available Memory",
      category: "runtime",
      status: "skip",
      message: "Could not determine memory",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check if binary is up-to-date with source (extended check only)
 */
async function checkBinaryMatch(): Promise<CheckResult> {
  const start = Date.now()

  try {
    // Get the path to the zee binary
    const binPath = process.argv[1]
    if (!binPath) {
      return {
        id: "runtime.binary-match",
        name: "Binary Currency",
        category: "runtime",
        status: "skip",
        message: "Could not determine binary path",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    const binStat = await fs.stat(binPath)
    const binMtime = binStat.mtimeMs

    // Try to find package.json in the source
    const sourceDir = path.dirname(path.dirname(binPath))
    const packageJsonPath = path.join(sourceDir, "package.json")

    try {
      const pkgStat = await fs.stat(packageJsonPath)
      const sourceMtime = pkgStat.mtimeMs

      if (binMtime < sourceMtime) {
        return {
          id: "runtime.binary-match",
          name: "Binary Currency",
          category: "runtime",
          status: "warn",
          message: "Binary may be outdated (source modified after build)",
          details: "Run 'bun run build' to update",
          severity: "warning",
          durationMs: Date.now() - start,
          autoFixable: false,
        }
      }

      return {
        id: "runtime.binary-match",
        name: "Binary Currency",
        category: "runtime",
        status: "pass",
        message: "Binary is up-to-date",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    } catch {
      return {
        id: "runtime.binary-match",
        name: "Binary Currency",
        category: "runtime",
        status: "skip",
        message: "Could not check source modification time",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }
  } catch (error) {
    return {
      id: "runtime.binary-match",
      name: "Binary Currency",
      category: "runtime",
      status: "skip",
      message: "Could not check binary",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Run all runtime checks
 */
export async function runRuntimeChecks(options: CheckOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const config = await resolveRuntimeConfig()
  const openbbConfig = config?.openbb
  const openbbProbe = await probeOpenBBAvailability(openbbConfig)

  // Core checks (always run)
  results.push(await checkBunVersion())
  results.push(await checkDirectory("config", getConfigDir()))
  results.push(await checkDirectory("state", getStateDir()))
  results.push(await checkDirectory("logs", getLogsDir()))
  results.push(await checkDiskSpace())
  results.push(await checkMemory())

  // OpenBB runtime
  results.push(await checkOpenBBBackend(openbbProbe, openbbConfig))
  results.push(await checkOpenBBWorkspace(openbbProbe, config))

  // Extended checks (only in full mode)
  if (options.full) {
    results.push(await checkBinaryMatch())
  }

  return results
}

/**
 * Check that the Investing runtime is properly configured
 */
async function checkOpenBBBackend(
  probe: OpenBBAvailability,
  openbbConfig?: Config.Info["openbb"],
): Promise<CheckResult> {
  const start = Date.now()
  const resolution = resolveOpenBBRuntime(openbbConfig)
  const apiUrl = resolution.apiUrl

  try {
    new URL(apiUrl)
  } catch {
    return {
      id: "runtime.openbb-backend",
      name: "OpenBB Backend",
      category: "runtime",
      status: "warn",
      message: "OpenBB backend is not configured",
      details: `Configured OpenBB API URL is invalid: ${apiUrl}`,
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  if (!probe.available) {
    if (!resolution.remoteOverride) {
      return {
        id: "runtime.openbb-backend",
        name: "OpenBB Backend",
        category: "runtime",
        status: "pass",
        message: "OpenBB Platform API not running (optional until investing workflows are used)",
        details: probe.error || probe.action,
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
        metadata: { apiUrl, mode: probe.mode, configured: false },
      }
    }

    return {
      id: "runtime.openbb-backend",
      name: "OpenBB Backend",
      category: "runtime",
      status: "warn",
      message: `OpenBB Platform API unavailable at ${apiUrl}`,
      details: probe.error || probe.action,
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { apiUrl, mode: probe.mode },
    }
  }

  return {
    id: "runtime.openbb-backend",
    name: "OpenBB Backend",
    category: "runtime",
    status: "pass",
    message: `OpenBB Platform API reachable at ${apiUrl}`,
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { apiUrl, mode: probe.mode, healthUrl: probe.healthUrl, statusCode: probe.statusCode },
  }
}

async function checkOpenBBWorkspace(
  backendProbe: OpenBBAvailability,
  config?: Config.Info,
): Promise<CheckResult> {
  const start = Date.now()
  const openbbResolution = resolveOpenBBRuntime(config?.openbb)
  const workspace = await probeOpenBBWorkspaceAvailability(config)

  if (workspace.available) {
    return {
      id: "runtime.openbb-workspace",
      name: "OpenBB Workspace",
      category: "runtime",
      status: "pass",
      message: `OpenBB Workspace descriptor reachable at ${workspace.descriptorUrl}`,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: {
        baseUrl: workspace.baseUrl,
        descriptorUrl: workspace.descriptorUrl,
        queryUrl: workspace.queryUrl,
        hostname: workspace.hostname,
        port: workspace.port,
        source: workspace.source,
        statusCode: workspace.statusCode,
      },
    }
  }

  if (!workspace.daemonReachable && !backendProbe.available && !openbbResolution.remoteOverride) {
    return {
      id: "runtime.openbb-workspace",
      name: "OpenBB Workspace",
      category: "runtime",
      status: "pass",
      message: "OpenBB Workspace inactive until Zee daemon and OpenBB workflows are in use",
      details: workspace.action,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: {
        baseUrl: workspace.baseUrl,
        descriptorUrl: workspace.descriptorUrl,
        queryUrl: workspace.queryUrl,
        hostname: workspace.hostname,
        port: workspace.port,
        source: workspace.source,
        daemonReachable: false,
      },
    }
  }

  return {
    id: "runtime.openbb-workspace",
    name: "OpenBB Workspace",
    category: "runtime",
    status: "warn",
    message: `OpenBB Workspace descriptor unavailable at ${workspace.descriptorUrl}`,
    details: workspace.error || workspace.action,
    severity: "warning",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: {
      baseUrl: workspace.baseUrl,
      descriptorUrl: workspace.descriptorUrl,
      queryUrl: workspace.queryUrl,
      hostname: workspace.hostname,
      port: workspace.port,
      source: workspace.source,
      daemonReachable: workspace.daemonReachable,
      descriptorReachable: workspace.descriptorReachable,
      statusCode: workspace.statusCode,
    },
  }
}
