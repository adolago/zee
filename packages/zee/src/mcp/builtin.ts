import path from "node:path"

export const BUILTIN_MCP_SERVER_NAMES = ["memory", "calendar", "consciousness"] as const
export type BuiltinMcpServerName = (typeof BUILTIN_MCP_SERVER_NAMES)[number]

type RuntimeCommandInput = {
  execPath?: string
  argv?: string[]
}

type BuiltinMcpServerConfig = {
  type: "local"
  command: string[]
  description: string
}

const DESCRIPTIONS: Record<BuiltinMcpServerName, string> = {
  memory: "Semantic memory storage and search via Zee local memory",
  calendar: "Calendar integration for scheduling",
  consciousness: "Local consciousness and reasoning tools",
}

export function isBuiltinMcpServerName(name: string): name is BuiltinMcpServerName {
  return (BUILTIN_MCP_SERVER_NAMES as readonly string[]).includes(name)
}

function runtimeBase(execPath: string): string {
  // Split on both separators: inputs may be Windows paths (with drive
  // letters and .exe suffixes) even when the host platform is not Windows.
  const base = execPath.split(/[\\/]/).pop() ?? execPath
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase()
}

function isAbsoluteCrossPlatform(entry: string): boolean {
  // path.isAbsolute is host-dependent; recognize Windows absolute paths too.
  if (/^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith("\\\\")) return true
  return path.isAbsolute(entry)
}

function isSourceRuntime(execPath: string): boolean {
  const base = runtimeBase(execPath)
  return base === "bun" || base === "node" || base === "deno"
}

function resolveSourceEntry(argv: string[]): string | undefined {
  const entry = argv[1]
  if (!entry) return undefined
  const normalized = entry.replace(/\\/g, "/")
  if (!/(^|\/)packages\/zee\/src\/index\.(ts|js)$/.test(normalized)) return undefined
  return isAbsoluteCrossPlatform(entry) ? entry : path.resolve(process.cwd(), entry)
}

export function resolveBuiltinMcpServerCommand(
  name: BuiltinMcpServerName,
  input: RuntimeCommandInput = {},
): string[] {
  const execPath = input.execPath ?? process.execPath
  const argv = input.argv ?? process.argv
  const entry = isSourceRuntime(execPath) ? resolveSourceEntry(argv) : undefined

  if (entry) {
    if (runtimeBase(execPath) === "bun") {
      return [execPath, "run", entry, "mcp-server", name]
    }
    return [execPath, entry, "mcp-server", name]
  }

  return [execPath, "mcp-server", name]
}

export function getBuiltinMcpServer(name: BuiltinMcpServerName): BuiltinMcpServerConfig {
  return {
    type: "local",
    command: resolveBuiltinMcpServerCommand(name),
    description: DESCRIPTIONS[name],
  }
}

export function getAllBuiltinMcpServers(): Record<BuiltinMcpServerName, BuiltinMcpServerConfig> {
  return Object.fromEntries(BUILTIN_MCP_SERVER_NAMES.map((name) => [name, getBuiltinMcpServer(name)])) as Record<
    BuiltinMcpServerName,
    BuiltinMcpServerConfig
  >
}

export function getBuiltinMcpRuntimeStatus(): Record<BuiltinMcpServerName, { command: string[]; available: boolean }> {
  return Object.fromEntries(
    BUILTIN_MCP_SERVER_NAMES.map((name) => {
      const command = resolveBuiltinMcpServerCommand(name)
      return [name, { command, available: command.length >= 3 && command.includes("mcp-server") }]
    }),
  ) as Record<BuiltinMcpServerName, { command: string[]; available: boolean }>
}
