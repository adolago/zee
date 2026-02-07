/**
 * @file Security Checks
 * @description Safety-focused configuration and filesystem checks
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { CheckOptions, CheckResult } from "../types"
import { Config } from "../../config/config"
import { reloadFlags, Flag } from "../../flag/flag"
import { resolveConfigDir, resolveStateDir } from "../../global/dirs"
import { AuthScope, getAuthConfig, isLoopbackHostname } from "../../server/auth"
import { Skill } from "../../skill"
import { scanDirectoryWithSummary } from "../../skill/scanner"
import { Instance } from "../../project/instance"

function isPosix(): boolean {
  return process.platform !== "win32"
}

function octal(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0")
}

function isGroupWritable(mode: number): boolean {
  return (mode & 0o020) !== 0
}

function isWorldWritable(mode: number): boolean {
  return (mode & 0o002) !== 0
}

function isGroupReadable(mode: number): boolean {
  return (mode & 0o040) !== 0
}

function isWorldReadable(mode: number): boolean {
  return (mode & 0o004) !== 0
}

function isSafeTokenMode(mode: number): boolean {
  // Allow 0600 or 0400. Disallow any group/other permissions.
  const perms = mode & 0o777
  return perms === 0o600 || perms === 0o400
}

type LstatResult = { ok: true; stat: import("node:fs").Stats } | { ok: false; code?: string }

async function safeLstat(p: string): Promise<LstatResult> {
  try {
    const stat = await fs.lstat(p)
    return { ok: true, stat }
  } catch (error) {
    return { ok: false, code: (error as NodeJS.ErrnoException).code }
  }
}

function isMdnsEnabled(mdns: unknown): boolean {
  if (mdns === undefined || mdns === null) return false
  if (typeof mdns === "boolean") return mdns
  if (typeof mdns === "object") {
    const enabled = (mdns as { enabled?: unknown }).enabled
    if (enabled === undefined) return true
    return Boolean(enabled)
  }
  return false
}

async function resolveConfiguredHostname(): Promise<{
  hostname: string
  mdnsEnabled: boolean
  source: "config" | "default"
}> {
  const config = await Config.global().catch(() => undefined)
  const server = (config as any)?.server
  const mdnsEnabled = isMdnsEnabled(server?.mdns)

  const configured = typeof server?.hostname === "string" ? server.hostname.trim() : ""
  if (configured) {
    return { hostname: configured, mdnsEnabled, source: "config" }
  }

  const hostname = mdnsEnabled ? "0.0.0.0" : "127.0.0.1"
  return { hostname, mdnsEnabled, source: "default" }
}

async function checkNonLoopbackBindRequiresAuth(): Promise<CheckResult> {
  const start = Date.now()
  const { hostname, mdnsEnabled, source } = await resolveConfiguredHostname()
  const auth = getAuthConfig()

  const insecureOverrideOk = Flag.AGENT_CORE_DISABLE_SERVER_AUTH && Flag.AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH

  if (isLoopbackHostname(hostname)) {
    return {
      id: "security.server.non_loopback_requires_auth",
      name: "Server bind safety",
      category: "security",
      status: "pass",
      message: `Loopback bind (${hostname})`,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { hostname, mdnsEnabled, source },
    }
  }

  if (insecureOverrideOk) {
    return {
      id: "security.server.non_loopback_requires_auth",
      name: "Server bind safety",
      category: "security",
      status: "fail",
      message: `Non-loopback bind (${hostname}) with auth disabled via insecure override`,
      details:
        "Unset AGENT_CORE_DISABLE_SERVER_AUTH and AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH, or enable auth:\n" +
        "- AGENT_CORE_ENABLE_SERVER_AUTH=1\n" +
        "- AGENT_CORE_SERVER_PASSWORD=...\n",
      severity: "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { hostname, mdnsEnabled, source },
    }
  }

  if (auth.disabled) {
    return {
      id: "security.server.non_loopback_requires_auth",
      name: "Server bind safety",
      category: "security",
      status: "fail",
      message: `Non-loopback bind (${hostname}) requires HTTP auth`,
      details:
        "Enable auth before binding to non-loopback:\n" +
        "- AGENT_CORE_ENABLE_SERVER_AUTH=1\n" +
        "- AGENT_CORE_SERVER_PASSWORD=...\n",
      severity: "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { hostname, mdnsEnabled, source },
    }
  }

  if (!auth.password) {
    return {
      id: "security.server.non_loopback_requires_auth",
      name: "Server bind safety",
      category: "security",
      status: "fail",
      message: `Non-loopback bind (${hostname}) missing AGENT_CORE_SERVER_PASSWORD`,
      details:
        "Set a server password (and optionally username) for HTTP Basic Auth:\n" +
        "- AGENT_CORE_SERVER_PASSWORD=...\n" +
        "- AGENT_CORE_SERVER_USERNAME=...\n",
      severity: "critical",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { hostname, mdnsEnabled, source },
    }
  }

  return {
    id: "security.server.non_loopback_requires_auth",
    name: "Server bind safety",
    category: "security",
    status: "pass",
    message: `Non-loopback bind (${hostname}) protected by HTTP auth`,
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { hostname, mdnsEnabled, source },
  }
}

async function checkServerScopes(): Promise<CheckResult> {
  const start = Date.now()
  const auth = getAuthConfig()

  if (auth.disabled) {
    return {
      id: "security.server.scopes_sane_defaults",
      name: "Server scopes",
      category: "security",
      status: "skip",
      message: "Server auth disabled (scopes not applicable)",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const rawScopes = process.env.AGENT_CORE_SERVER_SCOPES?.trim()
  const scopes = auth.scopes ?? []

  if (scopes.length === 0) {
    const allowed = Object.values(AuthScope).join(", ")
    return {
      id: "security.server.scopes_sane_defaults",
      name: "Server scopes",
      category: "security",
      status: "fail",
      message: "No valid scopes configured",
      details:
        rawScopes && rawScopes.length > 0
          ? `AGENT_CORE_SERVER_SCOPES did not contain any valid scopes.\nAllowed: ${allowed}`
          : `Set AGENT_CORE_SERVER_SCOPES (comma-separated).\nAllowed: ${allowed}`,
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { rawScopes: rawScopes ?? null },
    }
  }

  return {
    id: "security.server.scopes_sane_defaults",
    name: "Server scopes",
    category: "security",
    status: "pass",
    message: `Scopes: ${scopes.join(", ")}`,
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
  }
}

async function checkStateDirSymlink(): Promise<CheckResult> {
  const start = Date.now()
  const stateDir = path.resolve(resolveStateDir())
  const lst = await safeLstat(stateDir)

  if (!lst.ok) {
    return {
      id: "security.fs.state_dir.symlink",
      name: "State dir symlinks",
      category: "security",
      status: "skip",
      message: "State directory does not exist yet",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { stateDir },
    }
  }

  let real: string | undefined
  try {
    real = await fs.realpath(stateDir)
  } catch {
    real = undefined
  }

  const isSymlink = lst.stat.isSymbolicLink()
  const resolvesViaSymlink = Boolean(real && real !== stateDir)

  if (isSymlink || resolvesViaSymlink) {
    return {
      id: "security.fs.state_dir.symlink",
      name: "State dir symlinks",
      category: "security",
      status: "warn",
      message: "State directory involves symlinks (extra trust boundary)",
      details: (isSymlink ? `Path is a symlink: ${stateDir}\n` : "") + (real ? `Real path: ${real}` : ""),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { stateDir, real: real ?? null, isSymlink, resolvesViaSymlink },
    }
  }

  return {
    id: "security.fs.state_dir.symlink",
    name: "State dir symlinks",
    category: "security",
    status: "pass",
    message: "State directory is not a symlink",
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { stateDir },
  }
}

async function checkStateDirPerms(): Promise<CheckResult> {
  const start = Date.now()
  const stateDir = path.resolve(resolveStateDir())

  if (!isPosix()) {
    return {
      id: "security.fs.state_dir.perms",
      name: "State dir permissions",
      category: "security",
      status: "skip",
      message: "POSIX permissions not available on this platform",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const lst = await safeLstat(stateDir)
  if (!lst.ok) {
    return {
      id: "security.fs.state_dir.perms",
      name: "State dir permissions",
      category: "security",
      status: "skip",
      message: "State directory does not exist yet",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { stateDir },
    }
  }

  if (!lst.stat.isDirectory() || lst.stat.isSymbolicLink()) {
    return {
      id: "security.fs.state_dir.perms",
      name: "State dir permissions",
      category: "security",
      status: "warn",
      message: "State directory is not a normal directory",
      details: lst.stat.isSymbolicLink()
        ? "Path is a symlink; treat this as an extra trust boundary."
        : "Expected a directory.",
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { stateDir },
    }
  }

  const perms = lst.stat.mode & 0o777
  const writableByOthers = isGroupWritable(perms) || isWorldWritable(perms)
  const readableByOthers = isGroupReadable(perms) || isWorldReadable(perms)

  const status = writableByOthers ? "fail" : readableByOthers ? "warn" : "pass"
  const severity = writableByOthers ? "critical" : readableByOthers ? "warning" : "info"

  const details = writableByOthers
    ? `Mode ${octal(perms)} allows group/other write access.`
    : readableByOthers
      ? `Mode ${octal(perms)} allows group/other read access.`
      : `Mode ${octal(perms)}.`

  const autoFixable = status !== "pass"

  return {
    id: "security.fs.state_dir.perms",
    name: "State dir permissions",
    category: "security",
    status,
    message: status === "pass" ? "State directory permissions look safe" : "State directory permissions are too open",
    details,
    severity,
    durationMs: Date.now() - start,
    autoFixable,
    ...(autoFixable
      ? {
          fix: async () => {
            await fs.chmod(stateDir, 0o700)
            return { success: true, message: `Set ${stateDir} mode to 0700` }
          },
        }
      : {}),
    metadata: { stateDir, mode: octal(perms) },
  }
}

type CheckedFile = {
  path: string
  stat: import("node:fs").Stats
}

async function findConfigFiles(): Promise<CheckedFile[]> {
  const files: CheckedFile[] = []
  const configDir = resolveConfigDir()
  const candidates = [path.join(configDir, "agent-core.jsonc"), path.join(configDir, "agent-core.json")]

  const custom = Flag.AGENT_CORE_CONFIG?.trim()
  if (custom) candidates.unshift(path.resolve(custom))

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate)
    const lst = await safeLstat(absolute)
    if (!lst.ok) continue
    files.push({ path: absolute, stat: lst.stat })
  }
  return files
}

async function checkConfigFileSymlink(): Promise<CheckResult> {
  const start = Date.now()
  const files = await findConfigFiles()

  if (files.length === 0) {
    return {
      id: "security.fs.config_file.symlink",
      name: "Config file symlinks",
      category: "security",
      status: "skip",
      message: "No config file found",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const symlinks = files.filter((f) => f.stat.isSymbolicLink())
  if (symlinks.length > 0) {
    return {
      id: "security.fs.config_file.symlink",
      name: "Config file symlinks",
      category: "security",
      status: "warn",
      message: `${symlinks.length} config file(s) are symlinks`,
      details: symlinks.map((s) => s.path).join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  return {
    id: "security.fs.config_file.symlink",
    name: "Config file symlinks",
    category: "security",
    status: "pass",
    message: "Config files are not symlinks",
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { count: files.length },
  }
}

async function checkConfigFilePerms(): Promise<CheckResult> {
  const start = Date.now()

  if (!isPosix()) {
    return {
      id: "security.fs.config_file.perms",
      name: "Config file permissions",
      category: "security",
      status: "skip",
      message: "POSIX permissions not available on this platform",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const files = await findConfigFiles()
  if (files.length === 0) {
    return {
      id: "security.fs.config_file.perms",
      name: "Config file permissions",
      category: "security",
      status: "skip",
      message: "No config file found",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const issues: string[] = []
  let hasFail = false
  let hasWarn = false
  const fixTargets: string[] = []

  for (const file of files) {
    if (!file.stat.isFile() || file.stat.isSymbolicLink()) continue
    const perms = file.stat.mode & 0o777
    const writable = isGroupWritable(perms) || isWorldWritable(perms)
    const readable = isGroupReadable(perms) || isWorldReadable(perms)

    if (writable) {
      hasFail = true
      issues.push(`${file.path}: mode ${octal(perms)} is writable by others`)
      fixTargets.push(file.path)
      continue
    }

    if (readable) {
      hasWarn = true
      issues.push(`${file.path}: mode ${octal(perms)} is readable by others`)
      fixTargets.push(file.path)
    }
  }

  if (!hasFail && !hasWarn) {
    return {
      id: "security.fs.config_file.perms",
      name: "Config file permissions",
      category: "security",
      status: "pass",
      message: "Config file permissions look safe",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { count: files.length },
    }
  }

  const status = hasFail ? "fail" : "warn"
  const severity = hasFail ? "critical" : "warning"

  return {
    id: "security.fs.config_file.perms",
    name: "Config file permissions",
    category: "security",
    status,
    message: hasFail ? "Config file is writable by others" : "Config file is readable by others",
    details: issues.join("\n"),
    severity,
    durationMs: Date.now() - start,
    autoFixable: fixTargets.length > 0,
    ...(fixTargets.length > 0
      ? {
          fix: async () => {
            for (const target of fixTargets) {
              await fs.chmod(target, 0o600)
            }
            return { success: true, message: `Set ${fixTargets.length} config file(s) to 0600` }
          },
        }
      : {}),
    metadata: { files: files.map((f) => ({ path: f.path, mode: octal(f.stat.mode) })) },
  }
}

async function checkGatewayTokenFilePerms(): Promise<CheckResult> {
  const start = Date.now()
  const override = process.env.ZEE_GATEWAY_TOKEN_FILE?.trim()
  const tokenFile = path.resolve(override ? override : path.join(resolveStateDir(), "zee_gateway_token"))

  const lst = await safeLstat(tokenFile)
  if (!lst.ok) {
    return {
      id: "security.fs.gateway_token_file.perms",
      name: "Gateway token file",
      category: "security",
      status: "skip",
      message: "No gateway token file configured",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { tokenFile },
    }
  }

  if (lst.stat.isSymbolicLink()) {
    return {
      id: "security.fs.gateway_token_file.perms",
      name: "Gateway token file",
      category: "security",
      status: "warn",
      message: "Gateway token file is a symlink (ignored for safety)",
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { tokenFile },
    }
  }

  if (!lst.stat.isFile()) {
    return {
      id: "security.fs.gateway_token_file.perms",
      name: "Gateway token file",
      category: "security",
      status: "warn",
      message: "Gateway token path is not a file",
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { tokenFile },
    }
  }

  if (!isPosix()) {
    return {
      id: "security.fs.gateway_token_file.perms",
      name: "Gateway token file",
      category: "security",
      status: "pass",
      message: "Gateway token file exists",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { tokenFile },
    }
  }

  const perms = lst.stat.mode & 0o777
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined

  const issues: string[] = []
  if (uid !== undefined && lst.stat.uid !== uid) {
    issues.push("Not owned by the current user")
  }
  if (!isSafeTokenMode(lst.stat.mode)) {
    issues.push(`Unsafe permissions: ${octal(perms)} (expected 0600)`)
  }

  if (issues.length === 0) {
    return {
      id: "security.fs.gateway_token_file.perms",
      name: "Gateway token file",
      category: "security",
      status: "pass",
      message: "Gateway token file permissions look safe",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { tokenFile, mode: octal(perms) },
    }
  }

  const canFix = issues.some((i) => i.startsWith("Unsafe permissions"))
  return {
    id: "security.fs.gateway_token_file.perms",
    name: "Gateway token file",
    category: "security",
    status: "warn",
    message: "Gateway token file will be ignored due to safety checks",
    details: `${tokenFile}\n${issues.join("\n")}`,
    severity: "warning",
    durationMs: Date.now() - start,
    autoFixable: canFix,
    ...(canFix
      ? {
          fix: async () => {
            await fs.chmod(tokenFile, 0o600)
            return { success: true, message: `Set ${tokenFile} mode to 0600` }
          },
        }
      : {}),
    metadata: { tokenFile, mode: octal(perms) },
  }
}

async function resolveSkillDirectoriesSafe(): Promise<string[]> {
  try {
    return await Skill.directories()
  } catch {
    return await Instance.provide({
      directory: process.cwd(),
      fn: () => Skill.directories(),
    })
  }
}

async function checkSkillDirectoriesPerms(): Promise<CheckResult> {
  const start = Date.now()

  if (!isPosix()) {
    return {
      id: "security.skills.dir.perms",
      name: "Skill directories",
      category: "security",
      status: "skip",
      message: "POSIX permissions not available on this platform",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const dirs = await resolveSkillDirectoriesSafe().catch(() => [])
  const issues: string[] = []
  let checked = 0

  for (const raw of dirs) {
    const dirPath = path.resolve(raw)
    const lst = await safeLstat(dirPath)
    if (!lst.ok) continue

    if (lst.stat.isSymbolicLink()) {
      checked += 1
      issues.push(`${dirPath}: symlink`)
      continue
    }
    if (!lst.stat.isDirectory()) continue
    checked += 1

    const perms = lst.stat.mode & 0o777
    if (isGroupWritable(perms) || isWorldWritable(perms)) {
      issues.push(`${dirPath}: mode ${octal(perms)} is writable by others`)
    }
  }

  if (checked === 0) {
    return {
      id: "security.skills.dir.perms",
      name: "Skill directories",
      category: "security",
      status: "skip",
      message: "No skill directories found",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  if (issues.length > 0) {
    return {
      id: "security.skills.dir.perms",
      name: "Skill directories",
      category: "security",
      status: "warn",
      message: `${issues.length} skill directory risk(s)`,
      details: issues.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { checked },
    }
  }

  return {
    id: "security.skills.dir.perms",
    name: "Skill directories",
    category: "security",
    status: "pass",
    message: "Skill directories permissions look safe",
    severity: "info",
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { checked },
  }
}

async function checkSkillCodeSafety(): Promise<CheckResult> {
  const start = Date.now()
  const dirs = await resolveSkillDirectoriesSafe().catch(() => [])

  const allDetails: string[] = []
  let totalCritical = 0
  let totalWarn = 0
  let scannedDirs = 0

  for (const raw of dirs) {
    const dirPath = path.resolve(raw)
    let isDir = false
    try {
      const st = await fs.lstat(dirPath)
      isDir = st.isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    try {
      const summary = await scanDirectoryWithSummary(dirPath)
      if (summary.scannedFiles === 0) continue
      scannedDirs += 1
      totalCritical += summary.critical
      totalWarn += summary.warn

      for (const finding of summary.findings) {
        const rel = path.relative(dirPath, finding.file)
        allDetails.push(`[${finding.severity}] ${rel}:${finding.line} (${finding.ruleId}) ${finding.message}`)
        if (finding.evidence) {
          allDetails.push(`  ${finding.evidence}`)
        }
      }
    } catch {
      // Individual directory scan failure should not abort the entire check.
    }
  }

  if (scannedDirs === 0) {
    return {
      id: "security.skills.code_safety",
      name: "Skill code safety",
      category: "security",
      status: "skip",
      message: "No scannable skill directories found",
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  const status = totalCritical > 0 ? "fail" : totalWarn > 0 ? "warn" : "pass"
  const severity = totalCritical > 0 ? "critical" : totalWarn > 0 ? "warning" : "info"
  const message =
    status === "pass"
      ? `Scanned ${scannedDirs} skill dir(s), no dangerous patterns found`
      : `${totalCritical} critical, ${totalWarn} warning(s) across ${scannedDirs} skill dir(s)`

  return {
    id: "security.skills.code_safety",
    name: "Skill code safety",
    category: "security",
    status,
    message,
    ...(allDetails.length > 0 ? { details: allDetails.join("\n") } : {}),
    severity,
    durationMs: Date.now() - start,
    autoFixable: false,
    metadata: { scannedDirs, critical: totalCritical, warn: totalWarn },
  }
}

/**
 * Run all security checks
 */
export async function runSecurityChecks(options: CheckOptions): Promise<CheckResult[]> {
  // Ensure Flag values reflect current environment (tests may mutate env).
  reloadFlags()

  const results: CheckResult[] = []
  results.push(await checkNonLoopbackBindRequiresAuth())
  results.push(await checkServerScopes())
  results.push(await checkStateDirSymlink())
  results.push(await checkStateDirPerms())
  results.push(await checkConfigFileSymlink())
  results.push(await checkConfigFilePerms())
  results.push(await checkGatewayTokenFilePerms())
  results.push(await checkSkillDirectoriesPerms())

  if (options.full) {
    results.push(await checkSkillCodeSafety())
  }

  return results
}
