#!/usr/bin/env node
/**
 * Calendar MCP Server
 *
 * Exposes Zee's Google Calendar integration via MCP protocol:
 * - calendar_events: List events for a time range
 * - calendar_create: Create a new event
 * - calendar_update: Update an existing event
 * - calendar_delete: Delete an event
 * - calendar_free_slots: Find free time slots
 * - calendar_quick_add: Quick add event using natural language
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCalendarTools } from "./calendar-tools.js";
import { installMcpParentGuard } from "./parent-guard.js";

// Create server
const server = new McpServer({
  name: "calendar",
  version: "1.0.0",
});

registerCalendarTools(server);

// =============================================================================
// Start server
// =============================================================================

export async function startCalendarMcpServer() {
  installMcpParentGuard("calendar");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
