/**
 * Personas MCP Servers
 *
 * MCP servers exposing persona capabilities to external tools:
 * - memory: Qdrant-backed semantic memory
 * - calendar: Google Calendar integration
 * - portfolio: Financial tools via Stanley
 *
 * Each server runs as a separate process using stdio transport.
 * Register them in your zee config as local MCP servers.
 *
 * Example config:
 * ```json
 * {
 *   "mcp": {
 *     "memory": {
 *       "type": "local",
 *       "command": ["npx", "tsx", "src/mcp/servers/memory.ts"]
 *     },
 *     "calendar": {
 *       "type": "local",
 *       "command": ["npx", "tsx", "src/mcp/servers/calendar.ts"]
 *     },
 *     "portfolio": {
 *       "type": "local",
 *       "command": ["npx", "tsx", "src/mcp/servers/portfolio.ts"]
 *     }
 *   }
 * }
 * ```
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * MCP server configurations for personas
 */
export const PERSONA_MCP_SERVERS = {
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

/**
 * Get MCP server config by name
 */
export function getPersonaMcpServer(name: keyof typeof PERSONA_MCP_SERVERS) {
  return PERSONA_MCP_SERVERS[name];
}

/**
 * Get all persona MCP server configs
 */
export function getAllPersonaMcpServers() {
  return PERSONA_MCP_SERVERS;
}

/**
 * Generate MCP config entries for all persona servers
 */
export function generateMcpConfig() {
  return Object.fromEntries(
    Object.entries(PERSONA_MCP_SERVERS).map(([name, config]) => [
      name,
      {
        type: config.type,
        command: config.command,
      },
    ])
  );
}
