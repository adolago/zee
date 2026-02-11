/**
 * Zee Reminder Status Tool
 *
 * Checks calendar and memory for reminders and returns a status message
 * suitable for display in the TUI banner.
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import {
  getTodayEvents,
  checkCredentialsExist,
  type CalendarEvent,
} from "./google/calendar.js";
import { getMemory } from "../../memory/unified.js";
import { Global } from "../../../packages/zee/src/global/index.js";
import path from "path";
import fs from "fs/promises";

const ReminderStatusParams = z.object({
  format: z.enum(["short", "detailed"]).default("short")
    .describe("Status format: short (one line) or detailed (with next reminder)"),
  autoSave: z.boolean().default(false)
    .describe("Automatically save status to KV store for TUI display"),
  setupCron: z.boolean().default(false)
    .describe("Set up automatic refresh every 15 minutes via cron job"),
});

interface ReminderInfo {
  type: "calendar" | "memory";
  title: string;
  time?: Date;
}

function getEventTime(event: CalendarEvent): Date | undefined {
  if (event.start.dateTime) {
    return new Date(event.start.dateTime);
  }
  if (event.start.date) {
    return new Date(event.start.date);
  }
  return undefined;
}

function formatTimeUntil(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

/**
 * Save a value to the KV store by directly writing to the JSON file.
 * This is used when the tool runs outside the TUI context.
 */
async function saveToKV(key: string, value: unknown): Promise<void> {
  const kvPath = path.join(Global.Path.state, "kv.json");

  try {
    // Read existing KV data
    let kvData: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(kvPath, "utf-8");
      kvData = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid, start with empty object
    }

    // Update the value
    kvData[key] = value;

    // Write back to file
    await fs.mkdir(Global.Path.state, { recursive: true });
    await fs.writeFile(kvPath, JSON.stringify(kvData, null, 2));
  } catch (error) {
    throw new Error(`Failed to save to KV store: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create a cron job to refresh the reminder status every 15 minutes.
 */
async function createRefreshCronJob(): Promise<ToolExecutionResult> {
  const rawBaseUrl =
    process.env.ZEE_URL ||
    process.env.ZEE_DAEMON_URL ||
    `http://127.0.0.1:${process.env.ZEE_PORT || process.env.ZEE_DAEMON_PORT || "3210"}`;
  const baseUrl = rawBaseUrl.replace(/\/$/, "");

  const gatewayHttpUrl = process.env.ZEE_GATEWAY_URL ||
    process.env.GATEWAY_URL ||
    "http://127.0.0.1:18789";

  try {
    const response = await fetch(`${gatewayHttpUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "cron.add",
        params: {
          name: "zee-reminder-status-refresh",
          description: "Auto-refresh Zee reminder status every 15 minutes for TUI display",
          enabled: true,
          schedule: { kind: "every", everyMs: 900000 }, // 15 minutes
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: {
            kind: "agentTurn",
            message: "Run zee:reminder-status with autoSave=true",
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway error: ${response.status} ${text}`);
    }

    const result = await response.json() as { result?: { id: string }; error?: { message: string } };

    if (result.error) {
      throw new Error(result.error.message);
    }

    return {
      title: "Cron Job Created",
      metadata: { jobId: result.result?.id },
      output: `Created cron job "zee-reminder-status-refresh" to refresh status every 15 minutes.

Job ID: ${result.result?.id}
Schedule: Every 15 minutes
Action: Run zee:reminder-status with autoSave=true

The TUI banner will automatically update with fresh reminder status.`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
      return {
        title: "Cron Setup Failed",
        metadata: { error: "connection_failed" },
        output: `Could not connect to Zee gateway to create cron job.

Ensure zee daemon is running with gateway enabled:
  zee daemon --gateway

Error: ${errorMsg}`,
      };
    }

    return {
      title: "Cron Setup Error",
      metadata: { error: errorMsg },
      output: `Failed to create cron job: ${errorMsg}`,
    };
  }
}

export const reminderStatusTool: ToolDefinition = {
  id: "zee:reminder-status",
  category: "domain",
  init: async () => ({
    description: `Check reminder/calendar status and return a status message.

Returns a formatted status string suitable for display in the TUI banner.
Checks Google Calendar for today's events and memory for reminder entries.

Parameters:
- format: "short" (default) or "detailed"
- autoSave: Save status to KV store for TUI display (default: false)
- setupCron: Create a cron job to auto-refresh every 15 minutes (default: false)

Examples:
- Check status: { }
- Detailed format: { format: "detailed" }
- Save to TUI: { autoSave: true }
- Full setup: { autoSave: true, setupCron: true }`,
    parameters: ReminderStatusParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { format, autoSave, setupCron } = args;
      const now = new Date();
      const reminders: ReminderInfo[] = [];
      let calendarError: string | null = null;

      // Handle setupCron first if requested
      let cronResult: ToolExecutionResult | null = null;
      if (setupCron) {
        cronResult = await createRefreshCronJob();
        if (cronResult.metadata?.error) {
          return cronResult;
        }
      }

      // Check Google Calendar for today's events
      const hasCredentials = await checkCredentialsExist();
      if (hasCredentials) {
        try {
          const events = await getTodayEvents();
          for (const event of events) {
            const eventTime = getEventTime(event);
            // Only include future or ongoing events
            if (eventTime && eventTime.getTime() >= now.getTime() - 60 * 60 * 1000) {
              reminders.push({
                type: "calendar",
                title: event.summary || "(No title)",
                time: eventTime,
              });
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.includes("401") || errorMsg.includes("invalid_grant")) {
            calendarError = "calendar auth error";
          } else {
            calendarError = "calendar unavailable";
          }
        }
      }

      // Check memory for reminder entries
      try {
        const store = getMemory();
        const memoryResults = await store.search({
          query: "reminder task due today upcoming",
          limit: 10,
          threshold: 0.5,
          category: "task",
        });

        for (const result of memoryResults) {
          const content = result.entry.content.toLowerCase();
          // Look for time indicators in memory content
          const hasTimeIndicator = /\b(today|tomorrow|at \d|due|by \d|in \d+ (min|hour))\b/.test(content);

          if (hasTimeIndicator) {
            reminders.push({
              type: "memory",
              title: result.entry.content.split("\n")[0].slice(0, 50),
            });
          }
        }
      } catch (error) {
        // Memory errors are non-fatal, just don't include memory reminders
      }

      // Sort reminders by time (events with no time go last)
      reminders.sort((a, b) => {
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.getTime() - b.time.getTime();
      });

      // Format the status message (concise style)
      let statusMessage: string;

      if (reminders.length === 0) {
        if (calendarError) {
          statusMessage = calendarError;
        } else {
          statusMessage = "Online.";
        }
      } else {
        const upcomingReminders = reminders.filter(r => {
          if (!r.time) return true;
          return r.time.getTime() >= now.getTime();
        });

        if (format === "detailed" && upcomingReminders.length > 0) {
          const next = upcomingReminders[0];
          if (next.time) {
            const minutesUntil = (next.time.getTime() - now.getTime()) / (1000 * 60);
            const timeStr = formatTimeUntil(minutesUntil);
            statusMessage = `Next: ${next.title} in ${timeStr}`;
          } else {
            statusMessage = `Next: ${next.title}`;
          }
        } else {
          const count = reminders.length;
          statusMessage = `${count} reminder${count !== 1 ? "s" : ""} today`;
        }
      }

      // Save to KV store if autoSave is enabled
      let savedToKV = false;
      if (autoSave) {
        try {
          await saveToKV("zee_status_banner", statusMessage);
          savedToKV = true;
        } catch (error) {
          // Non-fatal error, we'll include it in output
        }
      }

      // Build output combining cron result and status
      let output = statusMessage;

      if (savedToKV) {
        output += "\n\n[Saved to KV store: zee_status_banner]";
      }

      if (cronResult) {
        output += `\n\n${cronResult.output}`;
      }

      return {
        title: "Reminder Status",
        metadata: {
          reminderCount: reminders.length,
          format,
          autoSave,
          savedToKV,
          setupCron,
          cronJobId: cronResult?.metadata?.jobId,
          calendarError: calendarError ?? undefined,
        },
        output,
      };
    },
  }),
};
