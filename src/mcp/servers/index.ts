/**
 * Built-in MCP server registry for Zee.
 *
 * Each server runs as a separate process using stdio transport.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const BUILTIN_MCP_SERVERS = {
  "memory": {
    type: "local" as const,
    command: ["bun", "run", join(__dirname, "memory.ts")],
    description: "Semantic memory storage and search via Qdrant",
  },
  "calendar": {
    type: "local" as const,
    command: ["bun", "run", join(__dirname, "calendar.ts")],
    description: "Google Calendar integration for scheduling",
  },
  "portfolio": {
    type: "local" as const,
    command: ["bun", "run", join(__dirname, "portfolio.ts")],
    description: "Financial tools: portfolio, market data, SEC filings",
  },
  "consciousness": {
    type: "local" as const,
    command: ["bun", "run", join(__dirname, "consciousness.ts")],
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
