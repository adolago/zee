/**
 * Built-in MCP server registry for Zee.
 *
 * Each server runs as a separate process using stdio transport.
 */

import path from "node:path";

const BUILTIN_NAMES = ["memory", "calendar", "consciousness"] as const;
type BuiltinName = (typeof BUILTIN_NAMES)[number];

function isSourceRuntime(execPath: string): boolean {
  const base = path.basename(execPath).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
  return base === "bun" || base === "node" || base === "deno";
}

function resolveSourceEntry(argv: string[]): string | undefined {
  const entry = argv[1];
  if (!entry) return undefined;
  const normalized = entry.replace(/\\/g, "/");
  if (!/(^|\/)packages\/zee\/src\/index\.(ts|js)$/.test(normalized)) return undefined;
  return path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
}

function resolveZeeMcpCommand(name: BuiltinName): string[] {
  const execPath = process.execPath;
  const entry = isSourceRuntime(execPath) ? resolveSourceEntry(process.argv) : undefined;
  if (entry) {
    if (path.basename(execPath).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase() === "bun") {
      return [execPath, "run", entry, "mcp-server", name];
    }
    return [execPath, entry, "mcp-server", name];
  }
  return [execPath, "mcp-server", name];
}

export const BUILTIN_MCP_SERVERS = {
  "memory": {
    type: "local" as const,
    command: resolveZeeMcpCommand("memory"),
    description: "Semantic memory storage and search via Zee local memory",
  },
  "calendar": {
    type: "local" as const,
    command: resolveZeeMcpCommand("calendar"),
    description: "Google Calendar integration for scheduling",
  },
  "consciousness": {
    type: "local" as const,
    command: resolveZeeMcpCommand("consciousness"),
    description: "IIT consciousness tools: Phi calculation, evolution, reasoning",
  },
} as const;

export function getBuiltinMcpServer(name: keyof typeof BUILTIN_MCP_SERVERS) {
  return BUILTIN_MCP_SERVERS[name];
}

export function getAllBuiltinMcpServers() {
  return BUILTIN_MCP_SERVERS;
}

export function generateMcpConfig() {
  return Object.fromEntries(
    Object.entries(BUILTIN_MCP_SERVERS).map(([name, config]) => [
      name,
      {
        type: config.type,
        command: config.command,
      },
    ])
  );
}
