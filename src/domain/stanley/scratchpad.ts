/**
 * Stanley Research Scratchpad Tool
 *
 * JSONL-based logging for autonomous research sessions.
 * Provides init/log/check_duplicate/read/close actions for
 * tracking tool calls, preventing duplicates, and maintaining
 * an audit trail of research steps.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";

// State directory: ~/.local/state/zee/stanley/scratchpad/
function getScratchpadDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "stanley", "scratchpad");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Compute a deterministic cache key for deduplication.
 * Sorts object keys alphabetically, filters undefined values,
 * and produces a SHA-256 hash.
 */
function computeArgsHash(toolId: string, args: Record<string, unknown>): string {
  const sortedEntries = Object.entries(args)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const canonical = sortedEntries
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("&");
  const input = `${toolId}|${canonical}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function truncate(text: string, maxChars: number = 2000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "... [truncated]";
}

// -- Zod schemas for each action --

const InitAction = z.object({
  action: z.literal("init"),
  question: z.string().describe("The research question being investigated"),
  plan: z.array(z.string()).describe("List of planned research steps"),
});

const LogAction = z.object({
  action: z.literal("log"),
  sessionId: z.string().describe("Session ID from init"),
  iteration: z.number().describe("Current iteration number (1-based)"),
  phase: z.string().describe("Current phase: decomposition, execution, validation, synthesis"),
  toolId: z.string().describe("Tool that was called (e.g., stanley:market-data)"),
  args: z.record(z.unknown()).describe("Arguments passed to the tool"),
  resultOk: z.boolean().describe("Whether the tool call succeeded"),
  resultSummary: z.string().describe("Brief summary of the result (max 2000 chars)"),
  notes: z.string().optional().describe("Assessment of the result quality/relevance"),
});

const CheckDuplicateAction = z.object({
  action: z.literal("check_duplicate"),
  sessionId: z.string().describe("Session ID from init"),
  toolId: z.string().describe("Tool to check"),
  args: z.record(z.unknown()).describe("Arguments to check"),
});

const ReadAction = z.object({
  action: z.literal("read"),
  sessionId: z.string().describe("Session ID from init"),
  lastN: z.number().optional().describe("Only return the last N entries"),
});

const CloseAction = z.object({
  action: z.literal("close"),
  sessionId: z.string().describe("Session ID from init"),
  summary: z.string().describe("Final research summary"),
});

const ScratchpadParams = z.discriminatedUnion("action", [
  InitAction,
  LogAction,
  CheckDuplicateAction,
  ReadAction,
  CloseAction,
]);

function getSessionPath(sessionId: string): string {
  return path.join(getScratchpadDir(), `${sessionId}.jsonl`);
}

function appendLine(filePath: string, data: Record<string, unknown>): void {
  appendFileSync(filePath, JSON.stringify(data) + "\n", "utf-8");
}

function readLines(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
}

export const scratchpadTool: ToolDefinition = {
  id: "stanley:scratchpad",
  category: "domain",
  init: async () => ({
    description: `Research scratchpad for autonomous multi-step financial research. Actions:
- init: Start a new research session with a question and plan. Returns sessionId.
- log: Record a tool call result (iteration, phase, toolId, args, result).
- check_duplicate: Check if a tool+args combination was already called. Returns {duplicate, previousResult}.
- read: Read back logged entries from the session (optionally last N).
- close: Mark session as completed with a summary.`,
    parameters: ScratchpadParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const input = args as z.infer<typeof ScratchpadParams>;

      switch (input.action) {
        case "init": {
          const sessionId = randomUUID().slice(0, 8);
          const dir = getScratchpadDir();
          ensureDir(dir);
          const filePath = getSessionPath(sessionId);
          appendLine(filePath, {
            type: "session",
            id: sessionId,
            question: input.question,
            plan: input.plan,
            startedAt: new Date().toISOString(),
          });
          ctx.metadata({ title: `Scratchpad: init ${sessionId}` });
          return {
            title: "Research Scratchpad: Initialized",
            metadata: { sessionId },
            output: JSON.stringify({ sessionId, planSteps: input.plan.length }),
          };
        }

        case "log": {
          const filePath = getSessionPath(input.sessionId);
          if (!existsSync(filePath)) {
            return {
              title: "Research Scratchpad: Error",
              metadata: { error: true },
              output: `Session ${input.sessionId} not found. Call init first.`,
            };
          }
          const argsHash = computeArgsHash(input.toolId, input.args);
          appendLine(filePath, {
            type: "entry",
            iteration: input.iteration,
            phase: input.phase,
            toolId: input.toolId,
            args: input.args,
            argsHash,
            result: {
              ok: input.resultOk,
              summary: truncate(input.resultSummary),
              fullLength: input.resultSummary.length,
            },
            notes: input.notes,
            timestamp: new Date().toISOString(),
          });
          ctx.metadata({ title: `Scratchpad: log ${input.toolId}` });
          return {
            title: "Research Scratchpad: Logged",
            metadata: { iteration: input.iteration, toolId: input.toolId },
            output: JSON.stringify({ logged: true, argsHash, iteration: input.iteration }),
          };
        }

        case "check_duplicate": {
          const filePath = getSessionPath(input.sessionId);
          if (!existsSync(filePath)) {
            return {
              title: "Research Scratchpad: Check",
              metadata: {},
              output: JSON.stringify({ duplicate: false }),
            };
          }
          const targetHash = computeArgsHash(input.toolId, input.args);
          const lines = readLines(filePath);
          for (const line of lines.reverse()) {
            if (
              line.type === "entry" &&
              line.argsHash === targetHash &&
              (line as any).toolId === input.toolId
            ) {
              const result = (line as any).result;
              ctx.metadata({ title: `Scratchpad: duplicate found` });
              return {
                title: "Research Scratchpad: Duplicate Found",
                metadata: { duplicate: true },
                output: JSON.stringify({
                  duplicate: true,
                  previousResult: result?.summary || "",
                  iteration: (line as any).iteration,
                }),
              };
            }
          }
          ctx.metadata({ title: `Scratchpad: no duplicate` });
          return {
            title: "Research Scratchpad: No Duplicate",
            metadata: { duplicate: false },
            output: JSON.stringify({ duplicate: false }),
          };
        }

        case "read": {
          const filePath = getSessionPath(input.sessionId);
          if (!existsSync(filePath)) {
            return {
              title: "Research Scratchpad: Empty",
              metadata: {},
              output: JSON.stringify({ entries: [], count: 0 }),
            };
          }
          let entries = readLines(filePath).filter((l) => l.type === "entry");
          if (input.lastN && input.lastN > 0) {
            entries = entries.slice(-input.lastN);
          }
          ctx.metadata({ title: `Scratchpad: read ${entries.length} entries` });
          return {
            title: "Research Scratchpad: Entries",
            metadata: { count: entries.length },
            output: JSON.stringify({ entries, count: entries.length }),
          };
        }

        case "close": {
          const filePath = getSessionPath(input.sessionId);
          if (!existsSync(filePath)) {
            return {
              title: "Research Scratchpad: Error",
              metadata: { error: true },
              output: `Session ${input.sessionId} not found.`,
            };
          }
          const allLines = readLines(filePath);
          const entryCount = allLines.filter((l) => l.type === "entry").length;
          appendLine(filePath, {
            type: "close",
            summary: input.summary,
            completedAt: new Date().toISOString(),
            totalEntries: entryCount,
          });
          ctx.metadata({ title: `Scratchpad: closed` });
          return {
            title: "Research Scratchpad: Closed",
            metadata: { totalEntries: entryCount },
            output: JSON.stringify({
              closed: true,
              totalEntries: entryCount,
              filePath,
            }),
          };
        }
      }
    },
  }),
};
