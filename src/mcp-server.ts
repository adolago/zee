#!/usr/bin/env node
/**
 * Standalone MCP server entry point for zee tools.
 * This avoids loading the full CLI which has pi-* dependencies.
 *
 * Usage:
 *   node dist/mcp-server.js
 *   # Or via npx/bunx after build
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "@sinclair/typebox";
import { createMcpCompatibleTools } from "./agents/mcp-tools.js";
import { loadConfig, type ZeeConfig } from "./config/config.js";

interface ZeeTool {
  name: string;
  label?: string;
  description: string;
  parameters: TSchema;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    >;
    details?: unknown;
  }>;
}

async function runMcpServer(config: ZeeConfig): Promise<void> {
  const server = new Server(
    { name: "zee-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const zeeTools = createMcpCompatibleTools({ config }) as ZeeTool[];
  const toolMap = new Map<string, ZeeTool>();
  for (const tool of zeeTools) {
    toolMap.set(tool.name, tool);
  }

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: zeeTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters as unknown as Record<string, unknown>,
      })),
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.execute(
        `mcp-${Date.now()}`,
        (args ?? {}) as Record<string, unknown>,
      );

      // Convert zee tool result to MCP format
      const mcpContent = result.content.map((item) => {
        if (item.type === "text") {
          return { type: "text" as const, text: item.text };
        }
        if (item.type === "image") {
          return {
            type: "image" as const,
            data: item.data,
            mimeType: item.mimeType,
          };
        }
        return { type: "text" as const, text: JSON.stringify(item) };
      });

      return { content: mcpContent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep alive until stdin closes
  process.stdin.on("end", () => {
    process.exit(0);
  });
}

// Main entry point
const config = loadConfig();
runMcpServer(config).catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
