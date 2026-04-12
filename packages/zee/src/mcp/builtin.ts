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

function isSourceRuntime(execPath: string): boolean {
  const base = path.basename(execPath).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase()
  return base === "bun" || base === "node" || base === "deno"
}

function resolveSourceEntry(argv: string[]): string | undefined {
  const entry = argv[1]
  if (!entry) return undefined
  const normalized = entry.replace(/\\/g, "/")
  if (!/(^|\/)packages\/zee\/src\/index\.(ts|js)$/.test(normalized)) return undefined
  return path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry)
}

export function resolveBuiltinMcpServerCommand(
  name: BuiltinMcpServerName,
  input: RuntimeCommandInput = {},
): string[] {
  const execPath = input.execPath ?? process.execPath
  const argv = input.argv ?? process.argv
  const entry = isSourceRuntime(execPath) ? resolveSourceEntry(argv) : undefined

  if (entry) {
    if (path.basename(execPath).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase() === "bun") {
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
