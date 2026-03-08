/**
 * @file Runtime Checks
 * @description Core runtime environment health checks
 */

import { execSync } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { CheckResult, CheckOptions } from "../types"
import { resolveConfigDir, resolveLogsDir, resolveStateDir } from "../../global/dirs"
import { Stanley } from "../../paths"

/** Minimum required Bun version */
const MIN_BUN_VERSION = "1.0.0"

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

/**
 * Check Bun runtime version
 */
async function checkBunVersion(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const output = execSync("bun --version", { encoding: "utf-8" }).trim()
    const version = output.replace(/^v/, "")
    const meetsMinimum = compareVersions(version, MIN_BUN_VERSION) >= 0

    return {
      id: "runtime.bun-version",
      name: "Bun Version",
      category: "runtime",
      status: meetsMinimum ? "pass" : "fail",
      message: meetsMinimum
        ? `Bun ${version} (required: ≥${MIN_BUN_VERSION})`
        : `Bun ${version} is below minimum ${MIN_BUN_VERSION}`,
      severity: meetsMinimum ? "info" : "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { version, minVersion: MIN_BUN_VERSION },
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
    const homeDir = os.homedir()
    const output = execSync(`df -BG "${homeDir}" | tail -1`, {
      encoding: "utf-8",
    })
    const parts = output.trim().split(/\s+/)
    const availableStr = parts[3]
    const available = parseInt(availableStr.replace("G", ""), 10)

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

  // Core checks (always run)
  results.push(await checkBunVersion())
  results.push(await checkDirectory("config", getConfigDir()))
  results.push(await checkDirectory("state", getStateDir()))
  results.push(await checkDirectory("logs", getLogsDir()))
  results.push(await checkDiskSpace())
  results.push(await checkMemory())

  // Stanley runtime
  results.push(checkStanleyBackend())

  // Extended checks (only in full mode)
  if (options.full) {
    results.push(await checkBinaryMatch())
  }

  return results
}

/**
 * Check that the Stanley runtime is properly configured
 */
function checkStanleyBackend(): CheckResult {
  const start = Date.now()
  const apiUrl = Stanley.apiUrl()
  const coreBin = Stanley.coreBin()

  const err = Stanley.preflight()
  if (err) {
    return {
      id: "runtime.stanley-backend",
      name: "Stanley Backend",
      category: "runtime",
      status: "fail",
      message: "Stanley runtime not ready",
      details: err,
      severity: "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  return {
    id: "runtime.stanley-backend",
    name: "Stanley Backend",
    category: "runtime",
    status: "pass",
    message: coreBin
      ? `Rust runtime ready via ${coreBin}`
      : `External Stanley runtime configured at ${apiUrl}`,
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { apiUrl, coreBin: coreBin ?? null },
  }
}
