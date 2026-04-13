/**
 * @file Integrity Checks
 * @description Runtime integrity and state validation checks
 */

import * as fs from "fs/promises"
import * as path from "path"
import net from "net"
import type { CheckResult, CheckOptions } from "../types"
import { resolveConfigDir, resolveStateDir } from "../../global/dirs"
import { readEmbeddedGatewayConfigSnapshot, resolveEmbeddedGatewayPort } from "../../gateway/embedded-gateway"

const STALE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes
const ZEE_CONFIG_FILES = ["zee.jsonc", "zee.json"]
const GATEWAY_ENV_HINTS = ["ZEE_GATEWAY_TOKEN", "ZEE_GATEWAY_PASSWORD"]

function getStateDir(): string {
  return resolveStateDir()
}

function getGatewayPort(): number {
  const portRaw = Number.parseInt(process.env.ZEE_GATEWAY_PORT ?? "", 10)
  return Number.isFinite(portRaw) ? portRaw : resolveEmbeddedGatewayPort()
}

function getGatewayEnvHints(): string[] {
  return GATEWAY_ENV_HINTS.filter((key) => Boolean(process.env[key]?.trim()))
}

async function findZeeConfig(): Promise<string | undefined> {
  for (const file of ZEE_CONFIG_FILES) {
    const candidate = path.join(resolveConfigDir(), file)
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Ignore missing config path
    }
  }
  return undefined
}

type GatewayConfigContext = {
  snapshot: Awaited<ReturnType<typeof readEmbeddedGatewayConfigSnapshot>> | null
  configPath?: string
  envHints: string[]
  configured: boolean
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

async function getGatewayConfigContext(): Promise<GatewayConfigContext> {
  const envHints = getGatewayEnvHints()
  const snapshot = await readEmbeddedGatewayConfigSnapshot().catch(() => null)
  const fallbackConfigPath = await findZeeConfig()
  const configPath = snapshot?.path ?? fallbackConfigPath
  const configured = Boolean((snapshot?.exists ?? false) || fallbackConfigPath || envHints.length > 0)

  return {
    snapshot,
    configPath,
    envHints,
    configured,
  }
}

function formatGatewaySnapshotMessages(
  snapshot: NonNullable<GatewayConfigContext["snapshot"]>,
): { issues: string[]; warnings: string[] } {
  const issues = snapshot.issues.map((issue) => {
    const location = issue.path?.trim() ? issue.path : "<root>"
    return `Config ${location}: ${issue.message}`
  })
  const warnings = [
    ...snapshot.warnings.map((warning) => {
      const location = warning.path?.trim() ? warning.path : "<root>"
      return `Config ${location}: ${warning.message}`
    }),
    ...snapshot.legacyIssues.map((warning) => `Legacy config: ${warning.message}`),
  ]

  return { issues, warnings }
}

async function checkGatewayConfig(): Promise<CheckResult> {
  const start = Date.now()
  const { snapshot, configPath, envHints, configured } = await getGatewayConfigContext()

  if (!configured) {
    return {
      id: "integrity.gateway-config",
      name: "Gateway Configuration",
      category: "integrity",
      status: "skip",
      message: "Gateway not configured",
      details: "Add ~/.config/zee/zee.jsonc or provider env vars to enable messaging",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const issues = snapshot ? formatGatewaySnapshotMessages(snapshot).issues : []
  const warnings = snapshot ? formatGatewaySnapshotMessages(snapshot).warnings : []

  if (issues.length > 0) {
    return {
      id: "integrity.gateway-config",
      name: "Gateway Configuration",
      category: "integrity",
      status: "warn",
      message: "Gateway configuration is invalid",
      details: issues.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { configPath, envHints, valid: false },
    }
  }

  if (warnings.length > 0) {
    return {
      id: "integrity.gateway-config",
      name: "Gateway Configuration",
      category: "integrity",
      status: "warn",
      message: "Gateway configuration needs attention",
      details: warnings.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { configPath, envHints, valid: snapshot?.valid ?? true },
    }
  }

  return {
    id: "integrity.gateway-config",
    name: "Gateway Configuration",
    category: "integrity",
    status: "pass",
    message: configPath ? `Config found at ${configPath}` : "Configured via environment",
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { configPath, envHints, valid: snapshot?.valid ?? true },
  }
}

async function checkGatewayPort(): Promise<CheckResult> {
  const start = Date.now()
  const { configPath, envHints, configured } = await getGatewayConfigContext()

  if (!configured) {
    return {
      id: "integrity.gateway-port",
      name: "Gateway Reachability",
      category: "integrity",
      status: "skip",
      message: "Gateway not configured",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const port = getGatewayPort()
  const portOpen = await isPortOpen("127.0.0.1", port)
  if (portOpen) {
    return {
      id: "integrity.gateway-port",
      name: "Gateway Reachability",
      category: "integrity",
      status: "pass",
      message: `Gateway listening on ${port}`,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { port },
    }
  }

  return {
    id: "integrity.gateway-port",
    name: "Gateway Reachability",
    category: "integrity",
    status: "warn",
    message: `Gateway not listening on ${port}`,
    details: "Restart zee to recover the embedded gateway",
    severity: "warning",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { port, configPath, envHints },
  }
}

async function checkStaleLocks(): Promise<CheckResult> {
  const start = Date.now()
  const stateDir = getStateDir()

  try {
    const files = await fs.readdir(stateDir, { recursive: true })
    const lockFiles = files.filter((f) => String(f).endsWith(".lock"))
    const now = Date.now()
    const staleLocks: Array<{ path: string; ino: number; mtimeMs: number; size: number }> = []

    for (const lockFile of lockFiles) {
      const fullPath = path.join(stateDir, String(lockFile))
      try {
        const stat = await fs.lstat(fullPath)
        if (!stat.isFile() || stat.isSymbolicLink()) continue
        const age = now - stat.mtimeMs
        if (age > STALE_THRESHOLD_MS) {
          staleLocks.push({
            path: fullPath,
            ino: stat.ino,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          })
        }
      } catch {
        // File may have been deleted
      }
    }

    if (staleLocks.length === 0) {
      return {
        id: "integrity.stale-locks",
        name: "Lock Files",
        category: "integrity",
        status: "pass",
        message: "No stale lock files",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    return {
      id: "integrity.stale-locks",
      name: "Lock Files",
      category: "integrity",
      status: "warn",
      message: `${staleLocks.length} stale lock file(s)`,
      details: staleLocks.map((f) => path.basename(f.path)).join(", "),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: true,
      fix: async () => {
        let removed = 0
        const baseDir = path.resolve(stateDir)
        for (const lockFile of staleLocks) {
          try {
            const resolved = path.resolve(lockFile.path)
            const rel = path.relative(baseDir, resolved)
            if (rel.startsWith("..") || path.isAbsolute(rel)) continue
            const stat = await fs.lstat(lockFile.path)
            if (!stat.isFile() || stat.isSymbolicLink()) continue
            if (stat.ino !== lockFile.ino || stat.size !== lockFile.size || stat.mtimeMs !== lockFile.mtimeMs) {
              continue
            }
            await fs.unlink(lockFile.path)
            removed += 1
          } catch {
            // Ignore best-effort cleanup failures
          }
        }
        return { success: true, message: `Removed ${removed} stale lock(s)` }
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        id: "integrity.stale-locks",
        name: "Lock Files",
        category: "integrity",
        status: "pass",
        message: "No state directory yet",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }
    return {
      id: "integrity.stale-locks",
      name: "Lock Files",
      category: "integrity",
      status: "skip",
      message: "Could not check lock files",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

async function checkOrphanedProcesses(): Promise<CheckResult> {
  const start = Date.now()
  const pidFile = path.join(getStateDir(), "daemon", "daemon.pid")

  try {
    const pidContent = await fs.readFile(pidFile, "utf-8")
    let storedPid = Number.NaN

    try {
      const parsed = JSON.parse(pidContent) as { pid?: number }
      if (typeof parsed?.pid === "number") {
        storedPid = parsed.pid
      }
    } catch {
      storedPid = parseInt(pidContent.trim(), 10)
    }

    if (!Number.isFinite(storedPid)) {
      return {
        id: "integrity.orphan-procs",
        name: "Daemon Process",
        category: "integrity",
        status: "warn",
        message: "PID file exists but is unreadable",
        severity: "warning",
        durationMs: Date.now() - start,
        autoFixable: true,
        fix: async () => {
          await fs.unlink(pidFile)
          return { success: true, message: "Removed unreadable PID file" }
        },
      }
    }

    try {
      process.kill(storedPid, 0) // Signal 0 = check if process exists

      // Process exists, verify it's zee (Linux only)
      try {
        const cmdline = await fs.readFile(`/proc/${storedPid}/cmdline`, "utf-8")
        if (cmdline.includes("zee") || cmdline.includes("bun")) {
          return {
            id: "integrity.orphan-procs",
            name: "Daemon Process",
            category: "integrity",
            status: "pass",
            message: `Daemon running (PID ${storedPid})`,
            severity: "info",
            durationMs: Date.now() - start,
            autoFixable: false,
            metadata: { pid: storedPid },
          }
        }

        return {
          id: "integrity.orphan-procs",
          name: "Daemon Process",
          category: "integrity",
          status: "warn",
          message: "PID file points to wrong process",
          severity: "warning",
          durationMs: Date.now() - start,
          autoFixable: true,
          fix: async () => {
            await fs.unlink(pidFile)
            return { success: true, message: "Removed stale PID file" }
          },
        }
      } catch {
        // Can't read /proc (unsupported platform or permission issue), assume it's valid
        return {
          id: "integrity.orphan-procs",
          name: "Daemon Process",
          category: "integrity",
          status: "pass",
          message: `Process ${storedPid} exists`,
          severity: "info",
          durationMs: Date.now() - start,
          autoFixable: false,
        }
      }
    } catch {
      return {
        id: "integrity.orphan-procs",
        name: "Daemon Process",
        category: "integrity",
        status: "warn",
        message: "PID file exists but process not running",
        severity: "warning",
        durationMs: Date.now() - start,
        autoFixable: true,
        fix: async () => {
          await fs.unlink(pidFile)
          return { success: true, message: "Removed orphaned PID file" }
        },
      }
    }
  } catch {
    return {
      id: "integrity.orphan-procs",
      name: "Daemon Process",
      category: "integrity",
      status: "pass",
      message: "No daemon PID file (daemon not running)",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

async function checkCorruptedSessions(): Promise<CheckResult> {
  const start = Date.now()
  const sessionsDir = path.join(getStateDir(), "sessions")

  try {
    const files = await fs.readdir(sessionsDir)
    const sessionFiles = files.filter((f) => f.endsWith(".json"))
    const corrupted: string[] = []

    for (const file of sessionFiles) {
      try {
        const content = await fs.readFile(path.join(sessionsDir, file), "utf-8")
        JSON.parse(content)
      } catch {
        corrupted.push(file)
      }
    }

    if (corrupted.length === 0) {
      return {
        id: "integrity.corrupt-session",
        name: "Session Files",
        category: "integrity",
        status: "pass",
        message: `${sessionFiles.length} session file(s) valid`,
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    return {
      id: "integrity.corrupt-session",
      name: "Session Files",
      category: "integrity",
      status: "warn",
      message: `${corrupted.length} corrupted session file(s)`,
      details: corrupted.join(", "),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: true,
      fix: async () => {
        const backupDir = path.join(sessionsDir, ".corrupted")
        await fs.mkdir(backupDir, { recursive: true })
        for (const file of corrupted) {
          const src = path.join(sessionsDir, file)
          const dest = path.join(backupDir, `${file}.${Date.now()}`)
          await fs.rename(src, dest)
        }
        return { success: true, message: `Moved ${corrupted.length} file(s) to .corrupted/` }
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        id: "integrity.corrupt-session",
        name: "Session Files",
        category: "integrity",
        status: "pass",
        message: "No sessions directory",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }
    return {
      id: "integrity.corrupt-session",
      name: "Session Files",
      category: "integrity",
      status: "skip",
      message: "Could not check sessions",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

export async function runIntegrityChecks(options: CheckOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  results.push(await checkStaleLocks())
  results.push(await checkOrphanedProcesses())
  results.push(await checkGatewayConfig())
  results.push(await checkGatewayPort())

  if (options.full) {
    results.push(await checkCorruptedSessions())
  }

  return results
}
