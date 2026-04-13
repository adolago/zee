#!/usr/bin/env node
/**
 * Memory MCP Server
 *
 * Exposes Zee's memory system via MCP protocol:
 * - memory_store: Store information in long-term memory
 * - memory_search: Search memories semantically
 * - memory_list: List memories with filters
 * - memory_delete: Delete a memory by ID
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import { getMemory } from "../../memory/unified.js";
import type { MemoryCategory } from "../../memory/types.js";
import { installMcpParentGuard } from "./parent-guard.js";

const MEMORY_CATEGORIES = [
  "conversation",
  "fact",
  "preference",
  "task",
  "decision",
  "relationship",
  "note",
  "pattern",
] as const;

// Create server
const server = new McpServer({
  name: "memory",
  version: "1.0.0",
});
const registerTool = server.tool.bind(server) as (...args: any[]) => void;

function defineToolSchema<T extends Record<string, z.ZodTypeAny>>(schema: T): Record<string, z.ZodTypeAny> {
  return schema;
}

// =============================================================================
// memory_store - Store information in memory
// =============================================================================

registerTool(
  "memory_store",
  `Store information in long-term memory for future reference.

Use this to remember:
- Important facts about the user
- Preferences and settings
- Tasks and decisions
- Notes from conversations

The memory is stored with semantic embeddings for later retrieval.`,
  defineToolSchema({
    content: z.string().describe("Content to remember"),
    category: z.enum(MEMORY_CATEGORIES).default("note").describe("Memory category"),
    importance: z.number().min(0).max(1).default(0.5).describe("Importance score (0-1)"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    summary: z.string().optional().describe("Optional short summary"),
  }),
  async (args: any) => {
    const { content, category, importance, tags, summary } = args;

    try {
      const store = getMemory();
      const entry = await store.save({
        category: category ?? "note",
        content,
        summary,
        metadata: {
          importance: importance ?? 0.5,
          tags,
        },
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            id: entry.id,
            category: entry.category,
            importance: importance ?? 0.5,
            message: `Memory stored: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// memory_search - Search memories semantically
// =============================================================================

registerTool(
  "memory_search",
  `Search memories using semantic similarity.

The search uses vector embeddings to find relevant memories based on meaning,
not just keyword matching. Results are ranked by similarity score.`,
  defineToolSchema({
    query: z.string().describe("Search query"),
    category: z.enum(MEMORY_CATEGORIES).optional().describe("Filter by category"),
    limit: z.number().default(10).describe("Maximum results to return"),
    threshold: z.number().min(0).max(1).default(0.5).describe("Minimum similarity threshold (0-1)"),
    tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
  }),
  async (args: any) => {
    const { query, category, limit, threshold, tags } = args;

    try {
      const store = getMemory();
      const results = await store.search({
        query,
        category,
        limit: limit ?? 10,
        threshold: threshold ?? 0.5,
        tags,
      });

      const formatted = results.map((r) => ({
        id: r.entry.id,
        category: r.entry.category,
        content: r.entry.content,
        summary: r.entry.summary,
        score: Math.round(r.score * 100) / 100,
        createdAt: new Date(r.entry.createdAt).toISOString(),
        tags: r.entry.metadata?.tags,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            count: results.length,
            results: formatted,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// memory_list - List memories with filters
// =============================================================================

registerTool(
  "memory_list",
  `List memories with optional filters.

Returns memories sorted by creation date (newest first).`,
  defineToolSchema({
    category: z.enum(MEMORY_CATEGORIES).optional().describe("Filter by category"),
    limit: z.number().default(20).describe("Maximum results to return"),
  }),
  async (args: any) => {
    const { category, limit } = args;

    try {
      const store = getMemory();
      const entries = await store.list({
        category,
        limit: limit ?? 20,
      });

      const formatted = entries.map((e) => ({
        id: e.id,
        category: e.category,
        content: e.content.substring(0, 200) + (e.content.length > 200 ? "..." : ""),
        summary: e.summary,
        createdAt: new Date(e.createdAt).toISOString(),
        tags: e.metadata?.tags,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            count: entries.length,
            memories: formatted,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// memory_delete - Delete a memory
// =============================================================================

registerTool(
  "memory_delete",
  `Delete a memory by its ID.`,
  defineToolSchema({
    id: z.string().describe("Memory ID to delete"),
  }),
  async (args: any) => {
    const { id } = args;

    try {
      const store = getMemory();
      await store.delete(id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            message: `Memory ${id} deleted`,
          }),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// memory_stats - Get memory statistics
// =============================================================================

registerTool(
  "memory_stats",
  `Get statistics about stored memories.`,
  {},
  async () => {
    try {
      const store = getMemory();
      const stats = await store.stats();

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            ...stats,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Start server
// =============================================================================

export async function startMemoryMcpServer() {
  installMcpParentGuard("memory");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
