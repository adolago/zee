import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";
import * as UsageStorage from "../../../packages/zee/src/usage/storage.js";
import { bannerPushTool } from "./banner.js";
import { sendWhatsAppMessage } from "./whatsapp-send.js";

function resolveWorkingDirectory(ctx: { extra?: Record<string, unknown> }): string {
  const cwd = ctx.extra?.cwd;
  if (typeof cwd === "string" && cwd.trim().length > 0) {
    return path.resolve(cwd);
  }
  return process.cwd();
}

type CommandResult = {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

function runCommand(command: string, args: string[], cwd: string, timeoutMs = 20_000): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: process.env,
  });

  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    return {
      ok: false,
      status: result.status,
      stdout,
      stderr,
      error: err.code === "ENOENT" ? `${command} not found on PATH` : err.message,
    };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
  };
}

function clipLines(input: string, maxLines: number): string {
  const lines = input.split("\n");
  if (lines.length <= maxLines) return input;
  return `${lines.slice(0, maxLines).join("\n")}\n... (${lines.length - maxLines} more lines truncated)`;
}

function summarizeRiskHints(diff: string): string[] {
  const hints: string[] = [];
  const addedLines = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));

  const checks: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /\bTODO\b/i, message: "TODO markers were added." },
    { pattern: /\bFIXME\b/i, message: "FIXME markers were added." },
    { pattern: /\bconsole\.log\s*\(/, message: "console.log statements were added." },
    { pattern: /\bany\b/, message: "`any` type usage was added." },
    { pattern: /\beval\s*\(/, message: "eval() usage was added." },
    { pattern: /\b(password|secret|token)\b/i, message: "Potential secret-related tokens were added." },
  ];

  for (const check of checks) {
    if (addedLines.some((line) => check.pattern.test(line))) {
      hints.push(check.message);
    }
  }
  return hints;
}

const ReviewParams = z.object({
  mode: z.enum(["working-tree", "commit", "range", "path"]).default("working-tree").describe("Review scope"),
  target: z.string().optional().describe("Commit hash, git range (A..B), or path (depends on mode)"),
  includePatch: z.boolean().default(true).describe("Include full patch output"),
  maxDiffLines: z.number().int().min(40).max(1200).default(400).describe("Maximum patch lines to return"),
});

export const reviewTool: ToolDefinition = {
  id: "zee:review",
  category: "domain",
  init: async () => ({
    description: `Generate a focused code review snapshot from git diff/show with quick risk hints.`,
    parameters: ReviewParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const cwd = resolveWorkingDirectory(ctx);
      ctx.metadata({ title: `Review: ${args.mode}` });

      const statusResult = runCommand("git", ["status", "--short"], cwd, 8_000);
      const statusText = statusResult.ok ? statusResult.stdout : statusResult.stderr || statusResult.error || "";

      let diffCommand: string[] = [];
      if (args.mode === "working-tree") {
        diffCommand = ["diff", "--no-color", "--unified=2"];
      } else if (args.mode === "commit") {
        if (!args.target) {
          return {
            title: "Review Failed",
            metadata: { error: "missing_target", mode: args.mode },
            output: "target is required when mode=commit",
          };
        }
        diffCommand = ["show", "--no-color", "--unified=2", "--stat", args.target];
      } else if (args.mode === "range") {
        if (!args.target) {
          return {
            title: "Review Failed",
            metadata: { error: "missing_target", mode: args.mode },
            output: "target is required when mode=range (example: main..HEAD)",
          };
        }
        diffCommand = ["diff", "--no-color", "--unified=2", "--stat", args.target];
      } else {
        if (!args.target) {
          return {
            title: "Review Failed",
            metadata: { error: "missing_target", mode: args.mode },
            output: "target path is required when mode=path",
          };
        }
        diffCommand = ["diff", "--no-color", "--unified=2", "--", args.target];
      }

      const diffResult = runCommand("git", diffCommand, cwd, 20_000);
      if (!diffResult.ok) {
        return {
          title: "Review Failed",
          metadata: { mode: args.mode, error: diffResult.stderr || diffResult.error },
          output: diffResult.stderr || diffResult.error || "Failed to run git review command.",
        };
      }

      const hints = summarizeRiskHints(diffResult.stdout);
      const patch = args.includePatch ? clipLines(diffResult.stdout, args.maxDiffLines) : "(patch omitted)";
      const hintText = hints.length > 0 ? hints.map((hint) => `- ${hint}`).join("\n") : "- No quick risk hints detected.";

      return {
        title: "Review Snapshot",
        metadata: {
          mode: args.mode,
          hintCount: hints.length,
          hasChanges: diffResult.stdout.length > 0,
        },
        output: [
          "Working tree status:",
          statusText || "(clean)",
          "",
          "Risk hints:",
          hintText,
          "",
          "Diff:",
          patch || "(no diff output)",
        ].join("\n"),
      };
    },
  }),
};

const FilesParams = z.object({
  action: z.enum(["list", "find", "read"]).default("list").describe("File helper action"),
  path: z.string().default(".").describe("Base path"),
  pattern: z.string().optional().describe("Pattern for find action (regular expression syntax for rg)"),
  limit: z.number().int().min(1).max(500).default(100).describe("Maximum output rows"),
  lineStart: z.number().int().min(1).optional().describe("Start line for read action"),
  lineCount: z.number().int().min(1).max(1000).default(120).describe("Line count for read action"),
  includeHidden: z.boolean().default(false).describe("Include hidden files for list/find"),
});

export const filesTool: ToolDefinition = {
  id: "zee:files",
  category: "domain",
  init: async () => ({
    description: `Fast file helper for listing, searching, and partial file reads.`,
    parameters: FilesParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const cwd = resolveWorkingDirectory(ctx);
      const basePath = path.resolve(cwd, args.path);
      ctx.metadata({ title: `Files: ${args.action}` });

      if (args.action === "read") {
        const raw = await fs.readFile(basePath, "utf-8");
        const lines = raw.split("\n");
        const start = (args.lineStart ?? 1) - 1;
        const slice = lines.slice(start, start + args.lineCount);
        return {
          title: path.relative(cwd, basePath) || path.basename(basePath),
          metadata: {
            action: args.action,
            lineStart: start + 1,
            lineCount: slice.length,
          },
          output: slice.join("\n"),
        };
      }

      if (args.action === "list") {
        const listArgs = ["--files", basePath];
        if (args.includeHidden) listArgs.unshift("--hidden");

        let result = runCommand("rg", listArgs, cwd, 12_000);
        if (!result.ok && result.error?.includes("not found")) {
          result = runCommand("find", [basePath, "-type", "f"], cwd, 12_000);
        }
        if (!result.ok) {
          return {
            title: "Files List Failed",
            metadata: { action: args.action, error: result.stderr || result.error },
            output: result.stderr || result.error || "File listing failed.",
          };
        }

        const rows = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, args.limit);

        return {
          title: `Files (${rows.length})`,
          metadata: { action: args.action, count: rows.length },
          output: rows.length > 0 ? rows.join("\n") : "No files found.",
        };
      }

      if (!args.pattern) {
        return {
          title: "Files Find Failed",
          metadata: { action: args.action, error: "missing_pattern" },
          output: "pattern is required when action=find",
        };
      }

      const findArgs = ["-n", "--max-count", String(args.limit), args.pattern, basePath];
      if (args.includeHidden) findArgs.unshift("--hidden");
      const result = runCommand("rg", findArgs, cwd, 12_000);
      if (!result.ok) {
        return {
          title: "Files Find Failed",
          metadata: { action: args.action, error: result.stderr || result.error },
          output: result.stderr || result.error || "File search failed.",
        };
      }

      return {
        title: "File Matches",
        metadata: { action: args.action },
        output: result.stdout || "No matches found.",
      };
    },
  }),
};

const SessionBreakdownParams = z.object({
  sessionId: z.string().optional().describe("Session id (defaults to current session)"),
  includeRecentEvents: z.boolean().default(true).describe("Include recent usage events"),
  recentLimit: z.number().int().min(1).max(30).default(10).describe("How many recent events to include"),
});

export const sessionBreakdownTool: ToolDefinition = {
  id: "zee:session-breakdown",
  category: "domain",
  init: async () => ({
    description: `Show token/cost breakdown for a session using usage tracking storage.`,
    parameters: SessionBreakdownParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const sessionId = args.sessionId?.trim() || ctx.sessionId;
      ctx.metadata({ title: "Session Breakdown" });

      try {
        const usage = UsageStorage.getSessionUsage(sessionId);
        if (!usage) {
          return {
            title: "Session Breakdown",
            metadata: { sessionId, found: false },
            output: `No usage records found for session ${sessionId}.`,
          };
        }

        let recentBlock = "";
        if (args.includeRecentEvents) {
          const events = UsageStorage.queryEvents({
            sessionId,
            limit: args.recentLimit,
          });
          const rows = events.map((event) => {
            const ts = new Date(event.timestamp).toISOString();
            const totalTokens = event.inputTokens + event.outputTokens;
            return `- ${ts} ${event.providerId}/${event.modelId} tokens=${totalTokens} cost=$${event.totalCost.toFixed(4)}`;
          });
          recentBlock = rows.length > 0 ? `\n\nRecent events:\n${rows.join("\n")}` : "";
        }

        return {
          title: "Session Breakdown",
          metadata: {
            sessionId,
            requests: usage.requests,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cost: usage.cost,
          },
          output: [
            `Session: ${sessionId}`,
            `Requests: ${usage.requests}`,
            `Input tokens: ${usage.inputTokens}`,
            `Output tokens: ${usage.outputTokens}`,
            `Cost: $${usage.cost.toFixed(4)}`,
            `First request: ${new Date(usage.firstRequest).toISOString()}`,
            `Last request: ${new Date(usage.lastRequest).toISOString()}`,
            recentBlock,
          ].join("\n"),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          title: "Session Breakdown Failed",
          metadata: { sessionId, error: message },
          output: `Failed to read usage storage: ${message}`,
        };
      }
    },
  }),
};

const NotifyParams = z.object({
  message: z.string().min(1).describe("Notification message"),
  channel: z.enum(["banner", "whatsapp", "both"]).default("banner").describe("Notification channel"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal").describe("Banner priority"),
  ttlMinutes: z.number().int().min(1).max(60 * 24 * 7).default(60).describe("Banner TTL in minutes"),
  to: z.string().optional().describe("WhatsApp recipient for whatsapp/both channel"),
});

export const notificationRelayTool: ToolDefinition = {
  id: "zee:notify",
  category: "domain",
  init: async () => ({
    description: `Send concise notifications to banner and/or WhatsApp.`,
    parameters: NotifyParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "Notify" });
      const outcomes: string[] = [];

      if (args.channel === "banner" || args.channel === "both") {
        const runtime = await bannerPushTool.init();
        const bannerResult = await runtime.execute(
          {
            message: args.message,
            priority: args.priority,
            ttlMinutes: args.ttlMinutes,
          },
          ctx,
        );
        outcomes.push(`banner: ${bannerResult.title}`);
      }

      if (args.channel === "whatsapp" || args.channel === "both") {
        if (!args.to) {
          return {
            title: "Notify Failed",
            metadata: { channel: args.channel, error: "missing_to" },
            output: "to is required when channel includes whatsapp",
          };
        }
        const wa = await sendWhatsAppMessage({
          to: args.to,
          message: args.message,
        });
        if (!wa.success) {
          return {
            title: "Notify Failed",
            metadata: { channel: args.channel, error: wa.error, code: wa.code },
            output: `WhatsApp notification failed: ${wa.error}`,
          };
        }
        outcomes.push(`whatsapp: sent to ${args.to}`);
      }

      return {
        title: "Notification Sent",
        metadata: { channel: args.channel },
        output: outcomes.join("\n"),
      };
    },
  }),
};

function resolveHourInTimezone(timeZone?: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone,
  });
  const hourText = formatter.format(new Date());
  const parsed = Number.parseInt(hourText, 10);
  return Number.isFinite(parsed) ? parsed : new Date().getHours();
}

function isWithinQuietWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

const LateNightGuardParams = z.object({
  timezone: z.string().optional().describe("IANA timezone (defaults to local timezone)"),
  startHour: z.number().int().min(0).max(23).default(23).describe("Quiet window start hour"),
  endHour: z.number().int().min(0).max(23).default(6).describe("Quiet window end hour"),
  message: z.string().default("Late-night focus check: wrap up and rest soon.").describe("Guard reminder message"),
  notify: z.boolean().default(false).describe("Send banner reminder when inside quiet window"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal").describe("Reminder priority"),
});

export const lateNightGuardTool: ToolDefinition = {
  id: "zee:late-night-guard",
  category: "domain",
  init: async () => ({
    description: `Checks whether current time is in a late-night window and optionally pushes a reminder.`,
    parameters: LateNightGuardParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "Late-Night Guard" });
      const hour = resolveHourInTimezone(args.timezone);
      const inQuietWindow = isWithinQuietWindow(hour, args.startHour, args.endHour);

      let notifyResult = "";
      if (inQuietWindow && args.notify) {
        const runtime = await bannerPushTool.init();
        const pushed = await runtime.execute(
          {
            message: args.message,
            priority: args.priority,
            ttlMinutes: 120,
          },
          ctx,
        );
        notifyResult = `\nNotification: ${pushed.title}`;
      }

      return {
        title: inQuietWindow ? "Late-Night Window Active" : "Late-Night Window Inactive",
        metadata: {
          timezone: args.timezone,
          hour,
          inQuietWindow,
          startHour: args.startHour,
          endHour: args.endHour,
        },
        output: [
          `Current hour: ${hour}`,
          `Quiet window: ${args.startHour}:00 -> ${args.endHour}:00`,
          `Status: ${inQuietWindow ? "inside quiet window" : "outside quiet window"}`,
          inQuietWindow ? `Guidance: ${args.message}` : "Guidance: normal schedule window.",
          notifyResult,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
  }),
};

export const UX_TOOLS = [
  reviewTool,
  filesTool,
  sessionBreakdownTool,
  notificationRelayTool,
  lateNightGuardTool,
];
