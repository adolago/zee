/**
 * Zee Quick Reminder Tool
 *
 * Simplified reminder creation that wraps the cron gateway.
 * Provides a user-friendly "remind me" interface instead of requiring
 * full cron job configuration.
 *
 * Supports time expressions:
 * - Relative: "in 30m", "in 2h", "in 1d"
 * - Absolute: "at 14:00", "at 9:00"
 * - Named: "tomorrow 9am", "tomorrow 14:00"
 *
 * Ported from OpenClaw reminder patterns.
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";

// =============================================================================
// Gateway Client
// =============================================================================

function resolveGatewayHttpUrl(): string {
  const envUrl = process.env.ZEE_GATEWAY_URL || process.env.GATEWAY_URL;
  if (envUrl) {
    return envUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  }
  const port = process.env.ZEE_GATEWAY_PORT || "18789";
  return `http://127.0.0.1:${port}`;
}

async function callGatewayRpc<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  const baseUrl = resolveGatewayHttpUrl();
  const url = `${baseUrl}/rpc`;

  const controller = new AbortController();
  const timeoutId = setTimeout(controller.abort.bind(controller), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway error: ${response.status} ${text}`);
    }

    const result = await response.json() as { result?: T; error?: { message: string } };
    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gateway request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// =============================================================================
// Time Parsing
// =============================================================================

/**
 * Parse a time expression into a unix timestamp in milliseconds.
 *
 * Supported formats:
 * - "in 30m", "in 2h", "in 1d", "in 45s"
 * - "at 14:00", "at 9:30"
 * - "tomorrow 9am", "tomorrow 14:00", "tomorrow 9:30am"
 * - ISO date string
 * - Unix timestamp in ms
 */
function parseTimeExpression(input: string): { atMs: number; label: string } | null {
  const trimmed = input.trim().toLowerCase();
  const nowMs = Date.now();
  const now = new Date(nowMs);

  // Relative: "in 30m", "in 2h", "in 1d", "in 45s"
  const relativeMatch = trimmed.match(/^in\s+(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const multipliers: Record<string, number> = {
      s: 1000, sec: 1000,
      m: 60 * 1000, min: 60 * 1000,
      h: 60 * 60 * 1000, hr: 60 * 60 * 1000, hour: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000,
    };
    const ms = value * (multipliers[unit] ?? 0);
    if (ms <= 0) return null;
    const target = new Date(nowMs + ms);
    return { atMs: nowMs + ms, label: target.toLocaleString() };
  }

  // Absolute today: "at 14:00", "at 9:30", "at 2pm", "at 2:30pm"
  const atMatch = trimmed.match(/^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (atMatch) {
    let hours = parseInt(atMatch[1], 10);
    const minutes = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
    const ampm = atMatch[3];
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    // If the time is in the past today, schedule for tomorrow
    if (target.getTime() <= nowMs) {
      target.setDate(target.getDate() + 1);
    }
    return { atMs: target.getTime(), label: target.toLocaleString() };
  }

  // Tomorrow: "tomorrow 9am", "tomorrow 14:00", "tomorrow 9:30am"
  const tomorrowMatch = trimmed.match(/^tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (tomorrowMatch) {
    let hours = parseInt(tomorrowMatch[1], 10);
    const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
    const ampm = tomorrowMatch[3];
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(hours, minutes, 0, 0);
    return { atMs: target.getTime(), label: target.toLocaleString() };
  }

  // Plain relative: "30m", "2h", "1d"
  const plainRelative = trimmed.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/);
  if (plainRelative) {
    const value = parseInt(plainRelative[1], 10);
    const unit = plainRelative[2];
    const multipliers: Record<string, number> = {
      s: 1000, sec: 1000,
      m: 60 * 1000, min: 60 * 1000,
      h: 60 * 60 * 1000, hr: 60 * 60 * 1000, hour: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000,
    };
    const ms = value * (multipliers[unit] ?? 0);
    if (ms <= 0) return null;
    const target = new Date(nowMs + ms);
    return { atMs: nowMs + ms, label: target.toLocaleString() };
  }

  // ISO date or timestamp
  const parsed = new Date(input).getTime();
  if (!isNaN(parsed) && parsed > nowMs) {
    return { atMs: parsed, label: new Date(parsed).toLocaleString() };
  }

  // Raw ms timestamp
  const numericMs = Number(input);
  if (!isNaN(numericMs) && numericMs > nowMs) {
    return { atMs: numericMs, label: new Date(numericMs).toLocaleString() };
  }

  return null;
}

// =============================================================================
// Schema
// =============================================================================

const RemindParams = z.object({
  action: z.enum(["set", "list", "cancel"])
    .describe("Action: set (create reminder), list (show active reminders), cancel (remove a reminder)"),

  // For set
  message: z.string().optional()
    .describe("Reminder message (required for set)"),
  when: z.string().optional()
    .describe("When to remind. Formats: 'in 30m', 'in 2h', 'at 14:00', 'at 9am', 'tomorrow 9am', ISO date, or ms timestamp"),
  deliver: z.boolean().default(false)
    .describe("Also deliver via last-used messaging channel"),

  // For cancel
  jobId: z.string().optional()
    .describe("Job ID of the reminder to cancel (required for cancel)"),
});

// =============================================================================
// Tool
// =============================================================================

export const remindTool: ToolDefinition = {
  id: "zee:remind",
  category: "domain",
  init: async () => ({
    description: `Quick reminders. Simplified wrapper around cron scheduling.

Actions:
- set: Create a one-time reminder { message: "Call dentist", when: "in 2h" }
- list: Show active reminders { }
- cancel: Remove a reminder { jobId: "..." }

Time formats for 'when':
- Relative: "in 30m", "in 2h", "in 1d"
- Absolute: "at 14:00", "at 9am", "at 2:30pm"
- Tomorrow: "tomorrow 9am", "tomorrow 14:00"
- Short: "30m", "2h" (same as "in 30m")
- ISO date or ms timestamp`,
    parameters: RemindParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, message, when, deliver, jobId } = args;

      ctx.metadata({ title: `Remind: ${action}` });

      // ---- SET ----
      if (action === "set") {
        if (!message?.trim()) {
          return {
            title: "Missing Message",
            metadata: { action, error: "missing_message" },
            output: "Provide 'message' for the reminder.",
          };
        }
        if (!when?.trim()) {
          return {
            title: "Missing Time",
            metadata: { action, error: "missing_when" },
            output: "Provide 'when' for the reminder (e.g. 'in 30m', 'at 14:00', 'tomorrow 9am').",
          };
        }

        const parsed = parseTimeExpression(when);
        if (!parsed) {
          return {
            title: "Invalid Time",
            metadata: { action, error: "invalid_when", input: when },
            output: `Could not parse time: "${when}"\n\nSupported formats:\n- "in 30m", "in 2h", "in 1d"\n- "at 14:00", "at 9am"\n- "tomorrow 9am"\n- ISO date string`,
          };
        }

        try {
          const jobName = `reminder: ${message.trim().substring(0, 50)}`;
          const payload: Record<string, unknown> = {
            kind: "agentTurn",
            message: `REMINDER: ${message.trim()}`,
          };

          if (deliver) {
            payload.deliver = true;
            payload.channel = "last";
            payload.bestEffortDeliver = true;
          }

          const result = await callGatewayRpc<{
            id: string;
            name: string;
          }>("cron.add", {
            name: jobName,
            description: `One-time reminder: ${message.trim()}`,
            enabled: true,
            deleteAfterRun: true,
            schedule: { kind: "at", atMs: parsed.atMs },
            sessionTarget: "main",
            wakeMode: "now",
            payload,
          });

          return {
            title: "Reminder Set",
            metadata: { jobId: result.id, atMs: parsed.atMs, deliver },
            output: `Reminder set for ${parsed.label}\n\nMessage: "${message.trim()}"\nJob ID: ${result.id}${deliver ? "\nWill also deliver via messaging channel." : ""}\n\nCancel with: { action: "cancel", jobId: "${result.id}" }`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);

          if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
            return {
              title: "Gateway Unavailable",
              metadata: { error: "connection_failed" },
              output: `Could not connect to Zee gateway to schedule reminder.\n\nEnsure zee daemon is running with --gateway.\n\nError: ${errorMsg}`,
            };
          }

          return {
            title: "Reminder Failed",
            metadata: { error: errorMsg },
            output: `Failed to create reminder: ${errorMsg}`,
          };
        }
      }

      // ---- LIST ----
      if (action === "list") {
        try {
          const result = await callGatewayRpc<{
            jobs: Array<{
              id: string;
              name: string;
              description?: string;
              enabled: boolean;
              schedule: { kind: string; atMs?: number; expr?: string; everyMs?: number };
              state: { nextRunAtMs?: number };
            }>;
          }>("cron.list", { includeDisabled: false });

          // Filter to reminder jobs (one-time "at" schedules with "reminder" in name)
          const reminders = result.jobs.filter(
            (j) => j.name.toLowerCase().startsWith("reminder:") || j.description?.toLowerCase().includes("reminder"),
          );

          if (reminders.length === 0) {
            return {
              title: "No Reminders",
              metadata: { action, count: 0 },
              output: "No active reminders.\n\nSet one with: { action: \"set\", message: \"...\", when: \"in 30m\" }",
            };
          }

          const list = reminders.map((r, i) => {
            const when = r.state.nextRunAtMs
              ? new Date(r.state.nextRunAtMs).toLocaleString()
              : r.schedule.atMs
                ? new Date(r.schedule.atMs).toLocaleString()
                : "unknown";
            return `${i + 1}. ${r.name}\n   When: ${when}\n   ID: ${r.id}`;
          }).join("\n\n");

          return {
            title: `${reminders.length} Reminder(s)`,
            metadata: { action, count: reminders.length },
            output: `Active reminders:\n\n${list}`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            title: "List Failed",
            metadata: { error: errorMsg },
            output: `Failed to list reminders: ${errorMsg}`,
          };
        }
      }

      // ---- CANCEL ----
      if (action === "cancel") {
        if (!jobId) {
          return {
            title: "Missing ID",
            metadata: { action, error: "missing_id" },
            output: "Provide 'jobId' to cancel a reminder. Use { action: \"list\" } to find it.",
          };
        }

        try {
          await callGatewayRpc<{ success: boolean }>("cron.remove", { id: jobId });

          return {
            title: "Reminder Cancelled",
            metadata: { action, jobId },
            output: `Cancelled reminder: ${jobId}`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            title: "Cancel Failed",
            metadata: { error: errorMsg },
            output: `Failed to cancel reminder: ${errorMsg}`,
          };
        }
      }

      return {
        title: "Unknown Action",
        metadata: { action },
        output: `Unknown remind action: ${action}`,
      };
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const REMINDER_TOOLS = [remindTool];
