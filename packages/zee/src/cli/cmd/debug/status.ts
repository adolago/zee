import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import { Installation } from "../../../installation"
import { Config } from "../../../config/config"
import { Global } from "../../../global"
import { Flag } from "../../../flag/flag"
import { createAuthorizedFetch } from "../../../server/auth"
import fs from "fs/promises"
import fsSync from "node:fs"
import path from "path"
import net from "net"
import { Zee } from "../../../paths"
import { Style, Symbols } from "../../style"
import { Timestamp } from "../../../util/timestamp"

const GATEWAY_ENV_HINTS = ["ZEE_GATEWAY_TOKEN", "ZEE_GATEWAY_PASSWORD"]

export const StatusCommand = cmd({
  command: "status",
  describe: "show zee system status and diagnostics",
  builder: (yargs) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .option("verbose", {
        alias: "v",
        type: "boolean",
        default: false,
        describe: "show verbose details",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const status = await collectStatus(args.verbose)

      if (args.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }

      printStatus(status, args.verbose)
    })
  },
})

interface SystemStatus {
  version: string
  runtime: Installation.RuntimeInfo
  binary: {
    path: string
    source: string
    exists: boolean
    resolved?: string
    modifiedAt?: string
    modifiedTs?: number
  }
  binaries: Array<{
    path: string
    source: string
    exists: boolean
    resolved?: string
    modifiedAt?: string
    modifiedTs?: number
  }>
  daemon: {
    running: boolean
    pid?: number
    port?: number
    url?: string
    version?: string
    healthy?: boolean
    error?: string
    runtime?: Installation.RuntimeInfo
  }
  processes: Array<{
    pid: number
    type: string
    cmd: string
  }>
  tools: {
    directories: string[]
    loaded: string[]
  }
  config: {
    directories: string[]
    provider?: string
    model?: string
  }
  gateway: {
    configured: boolean
    port: number
    listening: boolean
    configPath?: string
    envHints: string[]
    processes: Array<{
      pid: number
      cmd: string
    }>
    issues: string[]
  }
  sources: Array<{
    file: string
    modifiedAt: string
    modifiedTs: number
    newerThanBinary: boolean
  }>
  issues: string[]
}

type BinaryInfo = {
  path: string
  source: string
  exists: boolean
  resolved?: string
  modifiedAt?: string
  modifiedTs?: number
}

type DaemonHealth = Installation.RuntimeInfo & {
  healthy: boolean
}

function resolvePathBinary(): string | undefined {
  const pathEnv = process.env.PATH ?? ""
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, "zee")
    if (fsSync.existsSync(candidate)) return candidate
  }
  return undefined
}

function describeBinary(pathname: string, source: string): BinaryInfo {
  try {
    const stat = fsSync.statSync(pathname)
    const resolved = fsSync.realpathSync(pathname)
    return {
      path: pathname,
      source,
      exists: true,
      resolved,
      modifiedAt: stat.mtime.toISOString(),
      modifiedTs: stat.mtime.getTime(),
    }
  } catch {
    return { path: pathname, source, exists: false }
  }
}

function resolveBinaryCandidates(): BinaryInfo[] {
  const candidates: Array<{ path: string; source: string }> = []
  const home = process.env.HOME ?? ""
  const pathBinary = resolvePathBinary()
  if (pathBinary) candidates.push({ path: pathBinary, source: "PATH" })
  if (process.env.ZEE_BIN_PATH) {
    candidates.push({ path: process.env.ZEE_BIN_PATH, source: "ZEE_BIN_PATH" })
  }
  if (home) {
    candidates.push({ path: path.join(home, ".bun", "bin", "zee"), source: "BUN_LINK" })
    candidates.push({ path: path.join(home, "bin", "zee"), source: "LEGACY_HOME_BIN" })
    candidates.push({ path: path.join(home, ".local", "bin", "zee"), source: "LEGACY_LOCAL_BIN" })
  }
  const seen = new Set<string>()
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false
    seen.add(candidate.path)
    return true
  })
  return unique.map((candidate) => describeBinary(candidate.path, candidate.source))
}

function selectPrimaryBinary(binaries: BinaryInfo[]): BinaryInfo {
  const fromPath = binaries.find((b) => b.source === "PATH")
  if (fromPath) return fromPath
  const bunLink = binaries.find((b) => b.source === "BUN_LINK")
  if (bunLink) return bunLink
  return binaries[0] ?? { path: "zee", source: "PATH", exists: false }
}

async function collectStatus(verbose: boolean): Promise<SystemStatus> {
  const runtime = Installation.runtimeInfo()
  const status: SystemStatus = {
    version: runtime.version,
    runtime,
    binary: {
      path: "zee",
      source: "PATH",
      exists: false,
    },
    binaries: [],
    daemon: {
      running: false,
    },
    processes: [],
    tools: {
      directories: [],
      loaded: [],
    },
    config: {
      directories: [],
    },
    gateway: {
      configured: false,
      port: 18789,
      listening: false,
      envHints: [],
      processes: [],
      issues: [],
    },
    sources: [],
    issues: [],
  }

  // Binary info
  status.binaries = resolveBinaryCandidates()
  status.binary = selectPrimaryBinary(status.binaries)
  const pathBinary = status.binaries.find((b) => b.source === "PATH")
  const bunLink = status.binaries.find((b) => b.source === "BUN_LINK")
  const legacyHome = status.binaries.find((b) => b.source === "LEGACY_HOME_BIN")
  const legacyLocal = status.binaries.find((b) => b.source === "LEGACY_LOCAL_BIN")
  const envBin = status.binaries.find((b) => b.source === "ZEE_BIN_PATH")

  if (!pathBinary) {
    status.issues.push("zee not found in PATH")
  }
  if (bunLink && !bunLink.exists) {
    status.issues.push("~/.bun/bin/zee missing; run `cd packages/zee && bun link`")
  }
  if (legacyHome?.exists) {
    status.issues.push("Legacy ~/bin/zee exists; remove to avoid confusion")
  }
  if (legacyLocal?.exists) {
    status.issues.push("Legacy ~/.local/bin/zee exists; remove to avoid confusion")
  }
  if (envBin && !envBin.exists) {
    status.issues.push(`${envBin.source} points to a missing binary`)
  }
  if (pathBinary && bunLink) {
    const pathResolved = pathBinary.resolved ?? pathBinary.path
    const bunResolved = bunLink.resolved ?? bunLink.path
    if (pathResolved !== bunResolved) {
      status.issues.push(`PATH zee points to ${pathBinary.path} (expected ${bunLink.path})`)
    }
  }

  // Check for running processes
  try {
    const { execSync } = await import("child_process")
    const psOutput = execSync('pgrep -af "(zee)" 2>/dev/null || true', { encoding: "utf-8" })
    const lines = psOutput.trim().split("\n").filter(Boolean)

    for (const line of lines) {
      const match = line.match(/^(\d+)\s+(.*)$/)
      if (!match) continue
      const pid = parseInt(match[1])
      const cmd = match[2]

      // Skip ourselves and grep
      if (cmd.includes("pgrep") || cmd.includes("status")) continue

      let type = "unknown"
      if (cmd.includes("daemon")) type = "daemon"
      else if (cmd.includes("print-logs") || cmd.match(/\/bin\/zee$/)) type = "tui"

      status.processes.push({ pid, type, cmd })

      if (type === "daemon") {
        status.daemon.running = true
        status.daemon.pid = pid
      }
    }
  } catch {
    // Ignore process check errors
  }

  // Daemon health check
  const daemonHost = process.env.ZEE_HOST || "127.0.0.1"
  let daemonPort = parseInt(process.env.ZEE_PORT || "3210")
  let daemonUrl = process.env.ZEE_URL?.trim()
  if (daemonUrl) {
    try {
      const parsed = new URL(daemonUrl)
      if (parsed.port) daemonPort = parseInt(parsed.port, 10)
    } catch {
      daemonUrl = undefined
    }
  }
  if (!daemonUrl) daemonUrl = `http://${daemonHost}:${daemonPort}`
  status.daemon.port = daemonPort
  status.daemon.url = daemonUrl

  try {
    const authorizedFetch = createAuthorizedFetch(fetch)
    const response = await authorizedFetch(`${daemonUrl}/global/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      const health = (await response.json()) as DaemonHealth
      const { healthy, ...runtimeInfo } = health
      status.daemon.healthy = Boolean(healthy)
      status.daemon.version = runtimeInfo.version
      status.daemon.runtime = runtimeInfo

      if (runtimeInfo.version !== status.runtime.version) {
        status.issues.push(
          `Daemon version (${runtimeInfo.version}) differs from runtime (${status.runtime.version}) - restart needed`,
        )
      }
      if (runtimeInfo.mode !== status.runtime.mode) {
        status.issues.push(`Daemon mode (${runtimeInfo.mode}) differs from runtime (${status.runtime.mode})`)
      }
    }
  } catch (e) {
    status.daemon.healthy = false
    status.daemon.error = e instanceof Error ? e.message : String(e)
    if (status.daemon.running) {
      status.issues.push("Daemon process running but health check failed")
    }
  }

  // Gateway status
  const gatewayPort = getGatewayPort()
  status.gateway.port = gatewayPort
  status.gateway.envHints = getGatewayEnvHints()
  status.gateway.configPath = await findZeeConfig()
  status.gateway.configured = Boolean(status.gateway.configPath || status.gateway.envHints.length > 0)

  try {
    status.gateway.listening = await isPortOpen("127.0.0.1", gatewayPort)
  } catch {
    status.gateway.listening = false
  }

  try {
    const { execSync } = await import("child_process")
    const gatewayOutput = execSync('pgrep -af "zee.*gateway" 2>/dev/null || true', { encoding: "utf-8" })
    const lines = gatewayOutput.trim().split("\n").filter(Boolean)
    status.gateway.processes = lines
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/)
        if (!match) return null
        const cmd = match[2]
        if (cmd.includes("pgrep")) return null
        return { pid: Number.parseInt(match[1], 10), cmd }
      })
      .filter((entry): entry is { pid: number; cmd: string } => Boolean(entry))
  } catch {
    // Ignore gateway process check errors
  }

  if (status.gateway.configured && !status.gateway.listening) {
    status.gateway.issues.push("Gateway configured but not listening")
    status.issues.push("Gateway configured but not listening")
  }

  // Tool directories
  const configDirs = await Config.directories()
  status.config.directories = configDirs

  for (const dir of configDirs) {
    const toolDir = path.join(dir, "tool")
    try {
      const files = await fs.readdir(toolDir)
      const tsFiles = files.filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      if (tsFiles.length > 0) {
        status.tools.directories.push(toolDir)
        status.tools.loaded.push(...tsFiles.map((f) => path.join(toolDir, f)))
      }
    } catch {
      // Tool directory doesn't exist, that's fine
    }
  }

  // Check source file timestamps (for rebuild detection)
  let binaryTimestampPath: string | undefined
  if (process.env.ZEE_BIN_PATH && fsSync.existsSync(process.env.ZEE_BIN_PATH)) {
    binaryTimestampPath = process.env.ZEE_BIN_PATH
  } else if (process.env.ZEE_BIN_PATH && fsSync.existsSync(process.env.ZEE_BIN_PATH)) {
    binaryTimestampPath = process.env.ZEE_BIN_PATH
  } else if (status.daemon.runtime?.execPath && fsSync.existsSync(status.daemon.runtime.execPath)) {
    binaryTimestampPath = status.daemon.runtime.execPath
  } else if (status.binary.exists) {
    binaryTimestampPath = status.binary.resolved ?? status.binary.path
  }

  if (verbose && binaryTimestampPath) {
    const binaryStat = fsSync.statSync(binaryTimestampPath)
    const binaryTs = binaryStat.mtime.getTime()
    const srcRoot = path.join(Global.Path.source, "packages", "zee", "src")
    const keyFiles = ["provider/transform.ts", "provider/provider.ts", "server/server.ts"]

    for (const file of keyFiles) {
      const fullPath = path.join(srcRoot, file)
      try {
        const stat = await fs.stat(fullPath)
        const newerThanBinary = stat.mtime.getTime() > binaryTs
        status.sources.push({
          file,
          modifiedAt: stat.mtime.toISOString(),
          modifiedTs: stat.mtime.getTime(),
          newerThanBinary,
        })

        if (newerThanBinary) {
          status.issues.push(`Source ${file} is newer than binary - rebuild needed`)
        }
      } catch {
        // File doesn't exist
      }
    }
  }

  // Config info
  try {
    const config = await Config.get()
    // config.model is a string in format "provider/model", e.g. "anthropic/claude-2"
    if (config.model) {
      const [providerPart, modelPart] = config.model.split("/")
      status.config.provider = providerPart
      status.config.model = modelPart || config.model
    }
  } catch {
    // Ignore config errors
  }

  return status
}

/**
 * Prints the system status with theme-aware colors.
 * Uses shared color constants from style.ts for consistency.
 *
 * CLI Mode: Uses ANSI colors mapped from theme
 * TUI Mode: Would use full RGB colors from theme.tsx
 */
function printStatus(status: SystemStatus, verbose: boolean) {
  // Use shared style constants instead of hardcoded ANSI codes
  const ok = (s: string) => `${Style.success}${Symbols.check}${Style.reset} ${s}`
  const err = (s: string) => `${Style.error}${Symbols.cross}${Style.reset} ${s}`
  const warn = (s: string) => `${Style.warning}${Symbols.warning}${Style.reset} ${s}`

  // Header with theme-aware colors
  console.log("")
  console.log(`${Style.theme.border}${Symbols.hDoubleLine.repeat(63)}${Style.reset}`)
  console.log(
    `${Style.theme.border}${Symbols.vDoubleLine}${Style.reset}${" ".repeat(22)}${Style.bold}ZEE STATUS${Style.reset}${" ".repeat(32)}${Style.theme.border}${Symbols.vDoubleLine}${Style.reset}`,
  )
  console.log(`${Style.theme.border}${Symbols.hDoubleLine.repeat(63)}${Style.reset}`)
  console.log("")

  // Runtime
  console.log(`${Style.info}Runtime:${Style.reset}`)
  console.log(`  Version: ${status.runtime.version} (${status.runtime.channel}/${status.runtime.mode})`)
  console.log(`  Exec: ${status.runtime.execPath}`)
  if (status.runtime.entry) {
    console.log(`  Entry: ${status.runtime.entry}`)
  }
  console.log("")

  // Binary
  console.log(`${Style.info}Binary:${Style.reset}`)
  if (status.binary.exists) {
    console.log(`  ${ok(`${status.binary.path} [${status.binary.source}]`)}`)
    if (status.binary.modifiedAt) {
      console.log(`  ${Style.dim}Modified: ${Timestamp.pretty(new Date(status.binary.modifiedAt))}${Style.reset}`)
    }
    if (verbose && status.binary.resolved && status.binary.resolved !== status.binary.path) {
      console.log(`  ${Style.dim}Resolved: ${status.binary.resolved}${Style.reset}`)
    }
  } else {
    console.log(`  ${err(`Not found at ${status.binary.path} [${status.binary.source}]`)}`)
  }
  if (verbose && status.binaries.length > 0) {
    console.log("  Candidates:")
    for (const candidate of status.binaries) {
      const label = `${candidate.path} [${candidate.source}]`
      if (candidate.exists) {
        console.log(`    ${ok(label)}`)
      } else {
        console.log(`    ${warn(label)}`)
      }
    }
  }
  console.log("")

  // Processes
  console.log(`${Style.info}Processes:${Style.reset}`)
  if (status.processes.length === 0) {
    console.log(`  ${warn("No zee processes running")}`)
  } else {
    for (const proc of status.processes) {
      const typeLabel = proc.type.charAt(0).toUpperCase() + proc.type.slice(1)
      console.log(`  ${ok(`${typeLabel}: PID ${proc.pid}`)}`)
      if (verbose) {
        console.log(`    ${Style.dim}${proc.cmd}${Style.reset}`)
      }
    }
  }
  console.log("")

  // Daemon
  console.log(`${Style.info}Daemon:${Style.reset}`)
  if (status.daemon.url) {
    console.log(`  URL: ${status.daemon.url}`)
  } else {
    console.log(`  Port: ${status.daemon.port}`)
  }
  if (status.daemon.healthy) {
    const daemonRuntime = status.daemon.runtime
    const version = daemonRuntime?.version ?? status.daemon.version ?? "unknown"
    const channel = daemonRuntime?.channel
    const mode = daemonRuntime?.mode
    const suffix = channel && mode ? ` (${channel}/${mode})` : ""
    console.log(`  ${ok(`Healthy (version: ${version}${suffix})`)}`)
    if (verbose && daemonRuntime?.execPath) {
      console.log(`  ${Style.dim}Exec: ${daemonRuntime.execPath}${Style.reset}`)
    }
    if (verbose && daemonRuntime?.entry) {
      console.log(`  ${Style.dim}Entry: ${daemonRuntime.entry}${Style.reset}`)
    }
  } else if (status.daemon.running) {
    console.log(`  ${warn("Process running but not healthy")}`)
    if (status.daemon.error) {
      console.log(`  ${Style.dim}Error: ${status.daemon.error}${Style.reset}`)
    }
  } else {
    console.log(`  ${err("Not running")}`)
  }
  console.log("")

  // Gateway
  console.log(`${Style.info}Gateway:${Style.reset}`)
  console.log(`  Port: ${status.gateway.port}`)
  if (status.gateway.listening) {
    console.log(`  ${ok("Listening")}`)
  } else if (status.gateway.configured) {
    console.log(`  ${warn("Configured but not listening")}`)
  } else {
    console.log(`  ${warn("Not configured")}`)
  }
  if (status.gateway.configPath) {
    console.log(`  Config: ${status.gateway.configPath}`)
  }
  if (status.gateway.envHints.length > 0) {
    console.log(`  Env: ${status.gateway.envHints.join(", ")}`)
  }
  if (verbose) {
    if (status.gateway.processes.length > 0) {
      console.log("  Processes:")
      for (const proc of status.gateway.processes) {
        console.log(`    ${Style.dim}${proc.pid} ${proc.cmd}${Style.reset}`)
      }
    } else {
      console.log(`  ${Style.dim}Processes: none${Style.reset}`)
    }
  }
  console.log("")

  // Tools
  console.log(`${Style.info}Tools:${Style.reset}`)
  if (status.tools.directories.length === 0) {
    console.log(`  ${warn("No tool directories found")}`)
  } else {
    for (const dir of status.tools.directories) {
      const tools = status.tools.loaded.filter((t) => t.startsWith(dir))
      console.log(`  ${ok(dir)} (${tools.length} tools)`)
      if (verbose) {
        for (const tool of tools) {
          console.log(`    ${Style.dim}- ${path.basename(tool)}${Style.reset}`)
        }
      }
    }
  }
  console.log("")

  // Source timestamps (verbose only)
  if (verbose && status.sources.length > 0) {
    console.log(`${Style.info}Sources:${Style.reset}`)
    for (const src of status.sources) {
      const modified = Timestamp.time(new Date(src.modifiedAt))
      if (src.newerThanBinary) {
        console.log(`  ${warn(`${src.file} (${modified}) - NEWER than binary`)}`)
      } else {
        console.log(`  ${ok(`${src.file} (${modified})`)}`)
      }
    }
    console.log("")
  }

  // Issues
  if (status.issues.length > 0) {
    console.log(`${Style.info}Issues:${Style.reset}`)
    for (const issue of status.issues) {
      console.log(`  ${err(issue)}`)
    }
    console.log("")
  }

  // Footer with theme-aware border color
  console.log(`${Style.theme.border}${Symbols.hDoubleLine.repeat(63)}${Style.reset}`)

  // Quick fix suggestions
  if (status.issues.length > 0) {
    console.log("")
    console.log(`${Style.info}Quick fixes:${Style.reset}`)
    if (status.issues.some((i) => i.includes("bun link") || i.includes("PATH zee"))) {
      console.log(`  Link: cd ${Global.Path.source}/packages/zee && bun link`)
    }
    if (status.issues.some((i) => i.includes("rebuild"))) {
      console.log(`  Rebuild: ${Global.Path.source}/scripts/reload.sh`)
    }
    if (status.issues.some((i) => i.includes("restart"))) {
      console.log(`  Restart: ${Global.Path.source}/scripts/reload.sh --no-build`)
    }
  }
}

function getGatewayPort(): number {
  const portRaw = Number.parseInt(process.env.ZEE_GATEWAY_PORT || "", 10)
  return Number.isFinite(portRaw) ? portRaw : 18789
}

function getGatewayEnvHints(): string[] {
  return GATEWAY_ENV_HINTS.filter((key) => Boolean(process.env[key]?.trim()))
}

async function findZeeConfig(): Promise<string | undefined> {
  const candidates = [
    ...["zee.jsonc", "zee.json"].map((file) => path.join(Global.Path.config, file)),
    ...["zee.jsonc", "zee.json"].map((file) => path.join(Zee.dataDir(), file)), // legacy
  ]
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Ignore missing config path
    }
  }
  return undefined
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
