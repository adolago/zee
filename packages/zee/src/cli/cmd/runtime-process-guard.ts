import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Log } from "../../util/log"

const log = Log.create({ service: "runtime-process-guard" })

const DEFAULT_LIMITS = {
  maxTotal: 24,
  maxMcpTotal: 6,
  maxMcpPerServer: 1,
  maxClients: 4,
} as const

const DEFAULT_INTERVAL_MS = 30_000

type RuntimeKind = "daemon" | "gateway" | "mcp_server" | "zee_other"

type RuntimeCounts = {
  total: number
  daemons: number
  gateways: number
  mcpServers: number
  clients: number
  otherZee: number
}

export type RuntimeProcessLimits = {
  maxTotal: number
  maxMcpTotal: number
  maxMcpPerServer: number
  maxClients: number
}

export type RuntimeProcessEntry = {
  pid: number
  ppid?: number
  command: string
  kind: RuntimeKind
  zeeExecutable: boolean
  mcpServerName?: string
  taggedMcp: boolean
  taggedParentPid?: number
  orphaned: boolean
  systemdUnit?: string
  systemdManaged: boolean
  descendantOfCurrent: boolean
  exePath?: string
  exeDeleted: boolean
  binaryPinned: boolean
  hasTty: boolean
  interactiveClient: boolean
}

export type RuntimeSnapshot = {
  generatedAt: string
  currentPid: number
  expectedExecutablePaths?: string[]
  limits: RuntimeProcessLimits
  counts: RuntimeCounts
  processes: RuntimeProcessEntry[]
  violations: string[]
}

export type RuntimeMaintenanceKill = {
  pid: number
  kind: RuntimeKind
  command: string
  reason: string
  result: "terminated" | "killed" | "missing" | "failed"
}

export type RuntimeMaintenanceReport = {
  snapshotBefore: RuntimeSnapshot
  snapshotAfter: RuntimeSnapshot
  kills: RuntimeMaintenanceKill[]
}

export function parsePgrepOutput(output: string): Array<{ pid: number; command: string }> {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/)
      if (!match) return undefined
      const pid = Number.parseInt(match[1], 10)
      if (!Number.isFinite(pid)) return undefined
      return { pid, command: match[2] ?? "" }
    })
    .filter((entry): entry is { pid: number; command: string } => Boolean(entry))
}

function getEnvInt(key: string): number | undefined {
  const raw = process.env[key]?.trim()
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

export function resolveRuntimeProcessLimits(
  input: Partial<RuntimeProcessLimits> = {},
): RuntimeProcessLimits {
  return {
    maxTotal:
      input.maxTotal ?? getEnvInt("ZEE_RUNTIME_MAX_PROCESSES_TOTAL") ?? DEFAULT_LIMITS.maxTotal,
    maxMcpTotal:
      input.maxMcpTotal ??
      getEnvInt("ZEE_RUNTIME_MAX_MCP_PROCESSES") ??
      DEFAULT_LIMITS.maxMcpTotal,
    maxMcpPerServer:
      input.maxMcpPerServer ??
      getEnvInt("ZEE_RUNTIME_MAX_MCP_PER_SERVER") ??
      DEFAULT_LIMITS.maxMcpPerServer,
    maxClients:
      input.maxClients ??
      getEnvInt("ZEE_RUNTIME_MAX_CLIENT_PROCESSES") ??
      DEFAULT_LIMITS.maxClients,
  }
}

function normalizeExePath(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined
  return rawPath.endsWith(" (deleted)") ? rawPath.slice(0, -" (deleted)".length) : rawPath
}

function isZeeExecutablePath(exePath: string | undefined): boolean {
  if (!exePath) return false
  const base = path.basename(exePath).toLowerCase()
  return base === "zee" || base === "zee.exe"
}

function isLikelyInteractiveClientCommand(command: string): boolean {
  const lower = command.toLowerCase()
  const trimmed = lower.trim()
  if (trimmed === "zee" || trimmed.endsWith("/zee")) return true
  if (lower.includes("--print-logs")) return true
  if (/\bzee\s+attach\b/.test(lower)) return true
  return false
}

async function resolveExpectedExecutablePaths(): Promise<Set<string>> {
  const configured = process.env.ZEE_EXPECTED_EXE?.trim()
  const candidates = [
    configured,
    path.join(os.homedir(), ".bun", "bin", "zee"),
    process.execPath,
  ].filter((value): value is string => Boolean(value))

  const paths = new Set<string>()
  for (const candidate of candidates) {
    try {
      paths.add(await fs.realpath(candidate))
    } catch {
      // Ignore and continue
    }
  }

  return paths
}

function runPgrep(pattern: string): Array<{ pid: number; command: string }> {
  try {
    const output = execFileSync("pgrep", ["-af", pattern], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return parsePgrepOutput(output)
  } catch (error) {
    const status = (error as NodeJS.ErrnoException & { status?: number })?.status
    if (status === 1) return []
    log.debug("pgrep failed", { pattern, error: String(error) })
    return []
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readProcPpid(pid: number): Promise<number | undefined> {
  try {
    const status = await fs.readFile(`/proc/${pid}/status`, "utf-8")
    const match = status.match(/^PPid:\s+(\d+)$/m)
    if (!match) return undefined
    const parsed = Number.parseInt(match[1], 10)
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function readProcEnv(pid: number): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(`/proc/${pid}/environ`)
    const env: Record<string, string> = {}
    for (const entry of raw.toString("utf-8").split("\u0000")) {
      if (!entry) continue
      const index = entry.indexOf("=")
      if (index <= 0) continue
      env[entry.slice(0, index)] = entry.slice(index + 1)
    }
    return env
  } catch {
    return {}
  }
}

async function readProcCgroup(pid: number): Promise<string | undefined> {
  try {
    return await fs.readFile(`/proc/${pid}/cgroup`, "utf-8")
  } catch {
    return undefined
  }
}

async function readProcExePath(pid: number): Promise<string | undefined> {
  try {
    return await fs.readlink(`/proc/${pid}/exe`)
  } catch {
    return undefined
  }
}

async function readProcStdinPath(pid: number): Promise<string | undefined> {
  try {
    return await fs.readlink(`/proc/${pid}/fd/0`)
  } catch {
    return undefined
  }
}

function isTerminalPath(fdPath: string | undefined): boolean {
  if (!fdPath) return false
  return fdPath.startsWith("/dev/pts/") || fdPath.startsWith("/dev/tty")
}

function extractSystemdUnit(cgroup: string | undefined): string | undefined {
  if (!cgroup) return undefined
  const matches = Array.from(cgroup.matchAll(/\/([^/\n]+\.service)(?:\/|$)/g))
  if (matches.length === 0) return undefined
  return matches[matches.length - 1]?.[1]
}

async function isDescendantOfPid(pid: number, ancestorPid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || !Number.isFinite(ancestorPid)) return false
  if (pid === ancestorPid) return true

  let current = pid
  const seen = new Set<number>()
  for (let depth = 0; depth < 64; depth += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ppid = await readProcPpid(current)
    if (!ppid || ppid <= 1) return false
    if (ppid === ancestorPid) return true
    if (seen.has(ppid)) return false
    seen.add(ppid)
    current = ppid
  }

  return false
}

export function extractMcpServerName(command: string): string | undefined {
  const normalized = command.replace(/\\/g, "/")
  const match = normalized.match(/src\/mcp\/servers\/([a-zA-Z0-9_-]+)\.ts\b/)
  return match?.[1]
}

export function classifyRuntimeProcess(command: string): RuntimeKind {
  if (extractMcpServerName(command)) return "mcp_server"

  const lower = command.toLowerCase()
  if (lower.includes("zee") && /(^|\s)daemon(\s|$)/.test(lower)) return "daemon"
  if (lower.includes("zee") && /(^|\s)gateway(\s|$)/.test(lower)) return "gateway"
  return "zee_other"
}

function shouldTrack(command: string): boolean {
  return command.includes("zee") || Boolean(extractMcpServerName(command))
}

function computeCounts(entries: RuntimeProcessEntry[]): RuntimeCounts {
  const clients = entries.filter((entry) => entry.kind === "zee_other").length
  return {
    total: entries.length,
    daemons: entries.filter((entry) => entry.kind === "daemon").length,
    gateways: entries.filter((entry) => entry.kind === "gateway").length,
    mcpServers: entries.filter((entry) => entry.kind === "mcp_server").length,
    clients,
    otherZee: clients,
  }
}

function buildViolations(entries: RuntimeProcessEntry[], limits: RuntimeProcessLimits): string[] {
  const counts = computeCounts(entries)
  const violations: string[] = []

  if (counts.total > limits.maxTotal) {
    violations.push(`total processes ${counts.total} exceeds maxTotal ${limits.maxTotal}`)
  }
  if (counts.mcpServers > limits.maxMcpTotal) {
    violations.push(`mcp servers ${counts.mcpServers} exceeds maxMcpTotal ${limits.maxMcpTotal}`)
  }
  if (counts.clients > limits.maxClients) {
    violations.push(`clients ${counts.clients} exceeds maxClients ${limits.maxClients}`)
  }

  const byServer = new Map<string, number>()
  for (const entry of entries) {
    if (entry.kind !== "mcp_server") continue
    const key = entry.mcpServerName ?? "unknown"
    byServer.set(key, (byServer.get(key) ?? 0) + 1)
  }

  for (const [server, count] of byServer) {
    if (count > limits.maxMcpPerServer) {
      violations.push(
        `mcp server ${server} count ${count} exceeds maxMcpPerServer ${limits.maxMcpPerServer}`,
      )
    }
  }

  const orphaned = entries.filter((entry) => entry.kind === "mcp_server" && entry.orphaned).length
  if (orphaned > 0) {
    violations.push(`found ${orphaned} orphaned mcp server process(es)`)
  }

  const orphanedDaemons = entries.filter((entry) => entry.kind === "daemon" && entry.orphaned).length
  if (orphanedDaemons > 0) {
    violations.push(`found ${orphanedDaemons} orphaned daemon process(es)`)
  }

  const orphanedGateways = entries.filter((entry) => entry.kind === "gateway" && entry.orphaned).length
  if (orphanedGateways > 0) {
    violations.push(`found ${orphanedGateways} orphaned gateway process(es)`)
  }

  const orphanedClients = entries.filter((entry) => entry.kind === "zee_other" && entry.orphaned).length
  if (orphanedClients > 0) {
    violations.push(`found ${orphanedClients} orphaned client process(es)`)
  }

  const deletedExecutables = entries.filter((entry) => entry.kind === "zee_other" && entry.exeDeleted).length
  if (deletedExecutables > 0) {
    violations.push(`found ${deletedExecutables} client process(es) with deleted executables`)
  }

  const binaryMismatches = entries.filter(
    (entry) =>
      entry.kind === "zee_other" &&
      !entry.binaryPinned &&
      !entry.systemdManaged &&
      !entry.descendantOfCurrent,
  ).length
  if (binaryMismatches > 0) {
    violations.push(`found ${binaryMismatches} client process(es) not using pinned zee binary`)
  }

  const detachedInteractiveClients = entries.filter(
    (entry) =>
      entry.kind === "zee_other" &&
      entry.interactiveClient &&
      !entry.hasTty &&
      !entry.systemdManaged &&
      !entry.descendantOfCurrent,
  ).length
  if (detachedInteractiveClients > 0) {
    violations.push(`found ${detachedInteractiveClients} detached interactive client process(es)`)
  }

  const unmanagedDaemonLike = entries.filter((entry) => {
    if (entry.kind !== "daemon" && entry.kind !== "gateway") return false
    return !entry.systemdManaged && !entry.descendantOfCurrent
  }).length
  if (unmanagedDaemonLike > 0) {
    violations.push(`found ${unmanagedDaemonLike} unmanaged daemon/gateway process(es)`)
  }

  return violations
}

export async function collectRuntimeSnapshot(input: {
  limits?: Partial<RuntimeProcessLimits>
  currentPid?: number
} = {}): Promise<RuntimeSnapshot> {
  const currentPid = input.currentPid ?? process.pid
  const limits = resolveRuntimeProcessLimits(input.limits)
  const expectedPaths = await resolveExpectedExecutablePaths()

  const raw = [...runPgrep("zee"), ...runPgrep("src/mcp/servers/")]
  const unique = new Map<number, { pid: number; command: string }>()
  for (const entry of raw) {
    if (!shouldTrack(entry.command)) continue
    if (entry.pid === currentPid) continue
    if (!unique.has(entry.pid)) unique.set(entry.pid, entry)
  }

  const baseEntries = Array.from(unique.values())
  const entries: RuntimeProcessEntry[] = await Promise.all(
    baseEntries.map(async (entry) => {
      const kind = classifyRuntimeProcess(entry.command)
      const ppid = await readProcPpid(entry.pid)
      const cgroup = await readProcCgroup(entry.pid)
      const stdinPath = await readProcStdinPath(entry.pid)
      const exeRawPath = await readProcExePath(entry.pid)
      const systemdUnit = extractSystemdUnit(cgroup)
      const systemdManaged = Boolean(systemdUnit)
      const env = kind === "mcp_server" ? await readProcEnv(entry.pid) : {}
      const taggedMcp = env.ZEE_MCP_SERVER === "1"
      const taggedParentRaw = env.ZEE_PARENT_PID
      const taggedParentParsed = taggedParentRaw ? Number.parseInt(taggedParentRaw, 10) : Number.NaN
      const taggedParentPid = Number.isFinite(taggedParentParsed) ? taggedParentParsed : undefined
      const parentPid = taggedParentPid ?? ppid
      const orphanable =
        kind === "mcp_server" || kind === "daemon" || kind === "gateway" || kind === "zee_other"
      const orphaned = orphanable && (!parentPid || parentPid <= 1 || !isPidAlive(parentPid))
      const descendantOfCurrent = await isDescendantOfPid(entry.pid, currentPid)
      const exePath = normalizeExePath(exeRawPath)
      const exeDeleted = Boolean(exeRawPath?.endsWith(" (deleted)"))
      const zeeExecutable = isZeeExecutablePath(exePath)
      const binaryPinned = expectedPaths.size > 0
        ? expectedPaths.has(exePath ?? "")
        : true
      const hasTty = isTerminalPath(stdinPath)
      const interactiveClient = kind === "zee_other" && isLikelyInteractiveClientCommand(entry.command)

      return {
        pid: entry.pid,
        ppid,
        command: entry.command,
        kind,
        zeeExecutable,
        mcpServerName: extractMcpServerName(entry.command),
        taggedMcp,
        taggedParentPid,
        orphaned,
        systemdUnit,
        systemdManaged,
        descendantOfCurrent,
        exePath,
        exeDeleted,
        binaryPinned,
        hasTty,
        interactiveClient,
      }
    }),
  )

  const trackedEntries = entries.filter((entry) => entry.kind === "mcp_server" || entry.zeeExecutable)

  trackedEntries.sort((a, b) => a.pid - b.pid)
  const counts = computeCounts(trackedEntries)
  const violations = buildViolations(trackedEntries, limits)

  return {
    generatedAt: new Date().toISOString(),
    currentPid,
    expectedExecutablePaths: Array.from(expectedPaths),
    limits,
    counts,
    processes: trackedEntries,
    violations,
  }
}

function mcpPriority(entry: RuntimeProcessEntry, currentPid: number): number {
  let score = 0
  if (entry.orphaned) score -= 1_000
  if (entry.ppid === currentPid) score += 200
  if (entry.taggedMcp) score += 100
  if (entry.mcpServerName) score += 10
  return score
}

export function isManagedMcpProcess(params: {
  entry: RuntimeProcessEntry
  currentPid: number
  processByPid: Map<number, RuntimeProcessEntry>
}): boolean {
  const { entry, currentPid, processByPid } = params
  if (entry.kind !== "mcp_server" || entry.orphaned) return false
  if (entry.systemdManaged) return true
  if (entry.descendantOfCurrent) return true
  if (entry.taggedMcp) return true
  if (entry.ppid === currentPid) return true
  if (!entry.ppid) return false

  const parent = processByPid.get(entry.ppid)
  if (!parent) return false
  return parent.kind === "daemon" || parent.kind === "gateway"
}

function selectMcpKills(
  snapshot: RuntimeSnapshot,
  currentPid: number,
): Array<{ entry: RuntimeProcessEntry; reason: string }> {
  const kills: Array<{ entry: RuntimeProcessEntry; reason: string }> = []
  const seen = new Set<number>()

  const mcpEntries = snapshot.processes.filter((entry) => entry.kind === "mcp_server")
  const processByPid = new Map(snapshot.processes.map((entry) => [entry.pid, entry]))

  for (const entry of mcpEntries) {
    if (!entry.orphaned) continue
    if (seen.has(entry.pid)) continue
    seen.add(entry.pid)
    kills.push({ entry, reason: "orphaned" })
  }

  let activeManaged = mcpEntries.filter((entry) =>
    isManagedMcpProcess({
      entry,
      currentPid,
      processByPid,
    }),
  )

  // Fallback: if nothing was recognized as managed, enforce limits across
  // all active MCP servers so doctor/fix still works on older daemons.
  if (activeManaged.length === 0) {
    activeManaged = mcpEntries.filter((entry) => !entry.orphaned)
  }

  const byServer = new Map<string, RuntimeProcessEntry[]>()
  for (const entry of activeManaged) {
    const key = entry.mcpServerName ?? "unknown"
    const list = byServer.get(key) ?? []
    list.push(entry)
    byServer.set(key, list)
  }

  for (const [, group] of byServer) {
    group.sort((a, b) => {
      const pa = mcpPriority(a, currentPid)
      const pb = mcpPriority(b, currentPid)
      if (pa !== pb) return pb - pa
      return b.pid - a.pid
    })

    const extras = group.slice(snapshot.limits.maxMcpPerServer)
    for (const entry of extras) {
      if (seen.has(entry.pid)) continue
      seen.add(entry.pid)
      kills.push({ entry, reason: "per-server-limit" })
    }
  }

  const survivors = activeManaged
    .filter((entry) => !seen.has(entry.pid))
    .sort((a, b) => {
      const pa = mcpPriority(a, currentPid)
      const pb = mcpPriority(b, currentPid)
      if (pa !== pb) return pa - pb
      return a.pid - b.pid
    })

  const overflow = Math.max(0, survivors.length - snapshot.limits.maxMcpTotal)
  for (const entry of survivors.slice(0, overflow)) {
    if (seen.has(entry.pid)) continue
    seen.add(entry.pid)
    kills.push({ entry, reason: "max-mcp-total" })
  }

  return kills
}

export function isProtectedDaemonLikeProcess(params: {
  entry: RuntimeProcessEntry
  currentPid: number
}): boolean {
  const { entry, currentPid } = params
  if (entry.kind !== "daemon" && entry.kind !== "gateway") return false
  if (entry.pid === currentPid) return true
  if (entry.systemdManaged) return true
  if (entry.descendantOfCurrent) return true
  return false
}

export function isProtectedClientProcess(params: {
  entry: RuntimeProcessEntry
  currentPid: number
}): boolean {
  const { entry, currentPid } = params
  if (entry.kind !== "zee_other") return false
  if (entry.pid === currentPid) return true
  if (entry.systemdManaged) return true
  if (entry.descendantOfCurrent) return true
  if (entry.hasTty && entry.binaryPinned && !entry.orphaned) return true
  return false
}

function selectDaemonGatewayKills(
  snapshot: RuntimeSnapshot,
  currentPid: number,
): Array<{ entry: RuntimeProcessEntry; reason: string }> {
  const kills: Array<{ entry: RuntimeProcessEntry; reason: string }> = []
  const seen = new Set<number>()

  const daemonLike = snapshot.processes.filter((entry) => entry.kind === "daemon" || entry.kind === "gateway")
  for (const entry of daemonLike) {
    if (seen.has(entry.pid)) continue
    if (isProtectedDaemonLikeProcess({ entry, currentPid })) continue
    seen.add(entry.pid)
    kills.push({
      entry,
      reason: entry.orphaned ? `orphaned-${entry.kind}` : `unmanaged-${entry.kind}`,
    })
  }

  return kills
}

function clientPriority(entry: RuntimeProcessEntry): number {
  let score = 0
  if (entry.descendantOfCurrent) score += 500
  if (entry.systemdManaged) score += 300
  if (entry.hasTty) score += 200
  if (entry.interactiveClient) score += 120
  if (entry.binaryPinned) score += 80
  if (!entry.orphaned) score += 40
  if (entry.exeDeleted) score -= 2_000
  if (!entry.binaryPinned) score -= 1_000
  if (entry.orphaned) score -= 1_000
  if (entry.interactiveClient && !entry.hasTty) score -= 700
  return score
}

function selectClientKills(
  snapshot: RuntimeSnapshot,
  currentPid: number,
): Array<{ entry: RuntimeProcessEntry; reason: string }> {
  const kills: Array<{ entry: RuntimeProcessEntry; reason: string }> = []
  const seen = new Set<number>()
  const clients = snapshot.processes.filter((entry) => entry.kind === "zee_other")

  const addKill = (entry: RuntimeProcessEntry, reason: string) => {
    if (seen.has(entry.pid)) return
    seen.add(entry.pid)
    kills.push({ entry, reason })
  }

  for (const entry of clients) {
    if (isProtectedClientProcess({ entry, currentPid })) continue
    if (entry.exeDeleted) {
      addKill(entry, "deleted-executable")
      continue
    }
    if (!entry.binaryPinned) {
      addKill(entry, "binary-mismatch")
      continue
    }
    if (entry.orphaned) {
      addKill(entry, "orphaned-client")
      continue
    }
    if (entry.interactiveClient && !entry.hasTty) {
      addKill(entry, "detached-client")
      continue
    }
  }

  const survivors = clients.filter((entry) => !seen.has(entry.pid))
  const overflow = Math.max(0, survivors.length - snapshot.limits.maxClients)
  if (overflow <= 0) return kills

  const byPriority = survivors
    .filter((entry) => !isProtectedClientProcess({ entry, currentPid }))
    .sort((a, b) => {
      const pa = clientPriority(a)
      const pb = clientPriority(b)
      if (pa !== pb) return pa - pb
      return a.pid - b.pid
    })

  for (const entry of byPriority.slice(0, overflow)) {
    addKill(entry, "client-over-limit")
  }

  return kills
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function terminatePid(pid: number): Promise<"terminated" | "killed" | "missing" | "failed"> {
  if (!isPidAlive(pid)) return "missing"

  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return isPidAlive(pid) ? "failed" : "missing"
  }

  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return "terminated"
    await sleep(100)
  }

  try {
    process.kill(pid, "SIGKILL")
  } catch {
    return isPidAlive(pid) ? "failed" : "terminated"
  }

  await sleep(100)
  return isPidAlive(pid) ? "failed" : "killed"
}

export async function runRuntimeProcessMaintenance(input: {
  limits?: Partial<RuntimeProcessLimits>
  dryRun?: boolean
  currentPid?: number
  reason?: string
} = {}): Promise<RuntimeMaintenanceReport> {
  const currentPid = input.currentPid ?? process.pid
  const snapshotBefore = await collectRuntimeSnapshot({
    limits: input.limits,
    currentPid,
  })

  const plannedKills = [
    ...selectDaemonGatewayKills(snapshotBefore, currentPid),
    ...selectMcpKills(snapshotBefore, currentPid),
    ...selectClientKills(snapshotBefore, currentPid),
  ]
  const seenPlanned = new Set<number>()
  const kills: RuntimeMaintenanceKill[] = []

  for (const plan of plannedKills) {
    if (seenPlanned.has(plan.entry.pid)) continue
    seenPlanned.add(plan.entry.pid)
    const result = input.dryRun ? "missing" : await terminatePid(plan.entry.pid)
    kills.push({
      pid: plan.entry.pid,
      kind: plan.entry.kind,
      command: plan.entry.command,
      reason: plan.reason,
      result,
    })
  }

  if (kills.length > 0) {
    log.warn("runtime process maintenance action", {
      reason: input.reason ?? "periodic",
      dryRun: Boolean(input.dryRun),
      kills: kills.map((kill) => ({
        pid: kill.pid,
        reason: kill.reason,
        result: kill.result,
      })),
    })
  }

  const snapshotAfter = await collectRuntimeSnapshot({
    limits: snapshotBefore.limits,
    currentPid,
  })

  return {
    snapshotBefore,
    snapshotAfter,
    kills,
  }
}

export function startRuntimeProcessGuard(input: {
  intervalMs?: number
  limits?: Partial<RuntimeProcessLimits>
  currentPid?: number
  reason?: string
} = {}): () => void {
  const intervalMs =
    typeof input.intervalMs === "number" && input.intervalMs >= 1_000
      ? Math.floor(input.intervalMs)
      : DEFAULT_INTERVAL_MS

  let inFlight = false
  const timer = setInterval(async () => {
    if (inFlight) return
    inFlight = true
    try {
      await runRuntimeProcessMaintenance({
        limits: input.limits,
        currentPid: input.currentPid,
        reason: input.reason ?? "runtime-guard",
      })
    } catch (error) {
      log.error("runtime process guard tick failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inFlight = false
    }
  }, intervalMs)

  timer.unref?.()

  return () => {
    clearInterval(timer)
  }
}
