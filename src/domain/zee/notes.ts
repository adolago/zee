/**
 * Zee Notes Tool
 *
 * Daily note-taking and journal management for the personal assistant.
 * Notes are stored in two places:
 * 1. Daily markdown files: ~/.local/state/zee/notes/YYYY-MM-DD.md
 * 2. Local semantic memory: domain="notes", topic=YYYY-MM-DD
 *
 * This gives both human-readable daily logs (like OpenClaw workspace/memory/)
 * and semantic search across all notes.
 *
 * Ported from OpenClaw daily memory file patterns.
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import { getMemory } from "../../memory/unified.js";
import { Global } from "../../../packages/zee/src/global/index.js";

// =============================================================================
// Constants
// =============================================================================

const NOTES_DOMAIN = "notes";

function getNotesDir(): string {
  return path.join(Global.Path.state, "notes");
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// =============================================================================
// File helpers
// =============================================================================

async function ensureNotesDir(): Promise<string> {
  const dir = getNotesDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function appendToDaily(date: string, entry: string): Promise<string> {
  const dir = await ensureNotesDir();
  const filePath = path.join(dir, `${date}.md`);

  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist yet, create with header
    existing = `# Notes - ${date}\n\n`;
  }

  const content = existing.trimEnd() + "\n\n" + entry + "\n";
  await fs.writeFile(filePath, content);
  return filePath;
}

async function readDaily(date: string): Promise<string | null> {
  const dir = getNotesDir();
  const filePath = path.join(dir, `${date}.md`);
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function listDailyFiles(limit: number): Promise<string[]> {
  const dir = getNotesDir();
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.replace(".md", ""))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

// =============================================================================
// Schema
// =============================================================================

const NotesParams = z.object({
  action: z.enum(["add", "today", "read", "search", "list"])
    .describe("Action: add (new note), today (read today's notes), read (specific date), search (semantic), list (recent files)"),

  // For add
  content: z.string().optional()
    .describe("Note content (required for add)"),
  tags: z.array(z.string()).optional()
    .describe("Tags for the note entry"),

  // For read
  date: z.string().optional()
    .describe("Date for 'read' action (YYYY-MM-DD format)"),

  // For search
  query: z.string().optional()
    .describe("Search query for semantic search across all notes"),

  // Pagination
  limit: z.number().default(10).describe("Maximum results"),
});

// =============================================================================
// Tool
// =============================================================================

export const notesTool: ToolDefinition = {
  id: "zee:notes",
  category: "domain",
  init: async () => ({
    description: `Daily note-taking and journal. Notes are stored as daily markdown files and indexed in semantic memory.

Actions:
- add: Append a note to today's log { content: "Met with client, discussed Q2 roadmap", tags?: ["work"] }
- today: Read today's notes { }
- read: Read a specific day's notes { date: "2026-04-01" }
- search: Semantic search across all notes { query: "client meeting roadmap" }
- list: List recent daily note files { limit?: 10 }

Notes are saved to ~/.local/state/zee/notes/YYYY-MM-DD.md and indexed in local semantic memory for recall.`,
    parameters: NotesParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, content, tags, date, query, limit } = args;

      ctx.metadata({ title: `Notes: ${action}` });

      // ---- ADD ----
      if (action === "add") {
        if (!content?.trim()) {
          return {
            title: "Missing Content",
            metadata: { action, error: "missing_content" },
            output: "Provide 'content' to add a note.",
          };
        }

        const today = todayDateStr();
        const time = nowTimeStr();
        const tagLine = tags?.length ? ` [${tags.join(", ")}]` : "";
        const entry = `## ${time}${tagLine}\n\n${content.trim()}`;

        try {
          const filePath = await appendToDaily(today, entry);

          // Also index in local memory for semantic search
          try {
            const store = getMemory();
            await store.save({
              category: "note",
              content: content.trim(),
              namespace: "zee",
              metadata: {
                importance: 0.5,
                tags: [...(tags ?? []), "daily-note"],
                agent: "zee",
              },
              domain: NOTES_DOMAIN,
              topic: today,
              kind: "auto",
              priority: "normal",
            });
          } catch {
            // Memory indexing failure is non-fatal; the file was still saved
          }

          return {
            title: "Note Added",
            metadata: { action, date: today, time, filePath },
            output: `Note added to ${today} at ${time}\nFile: ${filePath}\n\n${entry}`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            title: "Note Add Failed",
            metadata: { action, error: errorMsg },
            output: `Failed to add note: ${errorMsg}`,
          };
        }
      }

      // ---- TODAY ----
      if (action === "today") {
        const today = todayDateStr();
        const contents = await readDaily(today);

        if (!contents) {
          return {
            title: "No Notes Today",
            metadata: { action, date: today },
            output: `No notes for today (${today}).\n\nAdd one with: { action: "add", content: "..." }`,
          };
        }

        return {
          title: `Notes: ${today}`,
          metadata: { action, date: today },
          output: contents.trim(),
        };
      }

      // ---- READ ----
      if (action === "read") {
        if (!date) {
          return {
            title: "Missing Date",
            metadata: { action, error: "missing_date" },
            output: "Provide 'date' in YYYY-MM-DD format.",
          };
        }

        const contents = await readDaily(date);

        if (!contents) {
          return {
            title: "No Notes",
            metadata: { action, date },
            output: `No notes found for ${date}.`,
          };
        }

        return {
          title: `Notes: ${date}`,
          metadata: { action, date },
          output: contents.trim(),
        };
      }

      // ---- SEARCH ----
      if (action === "search") {
        if (!query) {
          return {
            title: "Missing Query",
            metadata: { action, error: "missing_query" },
            output: "Provide 'query' to search notes.",
          };
        }

        try {
          const store = getMemory();
          const results = await store.search({
            query,
            namespace: "zee",
            limit: limit ?? 10,
            threshold: 0.4,
            domain: NOTES_DOMAIN,
          });

          if (results.length === 0) {
            return {
              title: "No Results",
              metadata: { action, query, count: 0 },
              output: `No notes matching: "${query}"`,
            };
          }

          const list = results.map((r, i) => {
            const score = (r.score * 100).toFixed(0);
            const date = new Date(r.entry.createdAt).toLocaleDateString();
            const preview = r.entry.content.substring(0, 150);
            const ellipsis = r.entry.content.length > 150 ? "..." : "";
            return `${i + 1}. [${score}% match] (${date})\n   "${preview}${ellipsis}"`;
          }).join("\n\n");

          return {
            title: `${results.length} Note(s)`,
            metadata: { action, query, count: results.length },
            output: `Notes matching "${query}":\n\n${list}`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            title: "Search Error",
            metadata: { action, error: errorMsg },
            output: `Notes search failed: ${errorMsg}\n\nNote: Daily files are still available via 'today' or 'read' actions.`,
          };
        }
      }

      // ---- LIST ----
      if (action === "list") {
        const files = await listDailyFiles(limit ?? 10);

        if (files.length === 0) {
          return {
            title: "No Notes",
            metadata: { action, count: 0 },
            output: `No daily note files found.\n\nNotes are stored in: ${getNotesDir()}\nAdd one with: { action: "add", content: "..." }`,
          };
        }

        const list = files.map((f, i) => `${i + 1}. ${f}`).join("\n");

        return {
          title: `${files.length} Daily File(s)`,
          metadata: { action, count: files.length },
          output: `Recent daily notes:\n\n${list}\n\nRead one with: { action: "read", date: "${files[0]}" }`,
        };
      }

      return {
        title: "Unknown Action",
        metadata: { action },
        output: `Unknown notes action: ${action}`,
      };
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const NOTES_TOOLS = [notesTool];
