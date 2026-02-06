/**
 * Zee Domain Tools
 *
 * Personal assistant tools powered by Zee gateway:
 * - Memory management and search
 * - Cross-platform messaging
 * - Notifications and reminders
 * - Contact and calendar management
 */

import { z } from "zod";
import type { ToolDefinition, ToolRuntime, ToolExecutionContext, ToolExecutionResult } from "../../mcp/types";
import { Log } from "../../../packages/agent-core/src/util/log";
import { validateMediaPath, PathValidationError } from "../../../packages/agent-core/src/security/validate-path.js";
import {
  SPLITWISE_ACTIONS,
  buildSplitwiseRequest,
  callSplitwiseApi,
  resolveSplitwiseConfig,
  type SplitwiseAction,
  type SplitwiseValue,
} from "./splitwise.js";
import { resolveCodexbarConfig, runCodexbar } from "./codexbar.js";
import { withRetry, suggestRecovery, buildEscalation } from "../../swarm/recovery.js";

const log = Log.create({ service: "zee-tools" });

// Schema for gateway API responses
const GatewayResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
import {
  getTodayEvents,
  getWeekEvents,
  getMonthEvents,
  listEvents,
  formatEventsForCanvas,
  checkCredentialsExist,
  createEvent,
  updateEvent,
  deleteEvent,
  findFreeSlots,
  suggestMeetingTimes,
  quickAddEvent,
  type FormattedEvent,
  type TimeSlot,
} from "./google/calendar.js";
import { getMemory } from "../../memory/unified.js";
import { CLAUDE_CODE_TOOLS, registerClaudeCodeTools } from "./claude-code.js";
import { RESTART_SENTINEL_TOOLS } from "./restart-sentinel.js";
import { CRON_TOOLS } from "./cron.js";
import { PTY_SESSION_TOOLS } from "./pty-sessions.js";
import { ZEE_BROWSER_TOOLS } from "./browser.js";
import { ZEE_STANDALONE_BROWSER_TOOLS } from "./browser-standalone.js";
import { WHATSAPP_TOOLS } from "./whatsapp.js";
import { reminderStatusTool } from "./reminder-status.js";
import { bannerPushTool, bannerRefreshTool } from "./banner.js";

// =============================================================================
// Memory Store Tool
// =============================================================================

const MemoryStoreParams = z.object({
  content: z.string().describe("Content to remember"),
  category: z.enum(["conversation", "fact", "preference", "task", "decision", "note"])
    .default("note").describe("Memory category"),
  importance: z.number().min(0).max(1).default(0.5)
    .describe("Importance score (0-1)"),
  tags: z.array(z.string()).optional()
    .describe("Tags for categorization"),
  relatedTo: z.array(z.string()).optional()
    .describe("Related memory IDs"),
  // Context Tree
  domain: z.string().optional()
    .describe("Top-level domain (e.g., 'architecture', 'personal', 'work')"),
  topic: z.string().optional()
    .describe("Topic within domain (e.g., 'auth', 'meetings')"),
  subtopic: z.string().optional()
    .describe("Subtopic within topic (e.g., 'oauth', 'standup')"),
  // Version Control
  memoryId: z.string().optional()
    .describe("Provide to update an existing memory (creates new version)"),
  // Context Composer
  kind: z.enum(["curated", "auto", "agent"]).optional()
    .describe("How this memory was created (default: auto)"),
  priority: z.enum(["high", "normal", "low"]).optional()
    .describe("Retrieval priority (default: normal)"),
  bookmarked: z.boolean().optional()
    .describe("Bookmark for quick access"),
  // Dual Memory
  memoryType: z.enum(["fact", "reasoning"]).optional()
    .describe("Type: fact (what) or reasoning (why/how)"),
  // Opinion Confidence
  confidence: z.number().min(0).max(1).optional()
    .describe("Confidence score (0-1) for beliefs/opinions. Default: none (not a belief)"),
  evidenceFor: z.array(z.string()).optional()
    .describe("Initial evidence supporting this belief"),
  evidenceAgainst: z.array(z.string()).optional()
    .describe("Initial evidence contradicting this belief"),
});

export const memoryStoreTool: ToolDefinition = {
  id: "zee:memory-store",
  category: "domain",
  init: async () => ({
    description: `Store information in long-term memory. Organize with domain/topic/subtopic for structured retrieval. Provide memoryId to update an existing memory (creates new version). Use kind="curated" + priority="high" for important context, memoryType="reasoning" for reasoning traces.`,
    parameters: MemoryStoreParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { content, category, importance, tags, relatedTo, domain, topic, subtopic, memoryId, kind, priority, bookmarked, memoryType, confidence, evidenceFor, evidenceAgainst } = args;

      ctx.metadata({ title: `Storing memory: ${category}` });

      try {
        const store = getMemory();

        // Memory store is idempotent for the same memoryId, so retry on transient failures
        const saveResult = await withRetry(
          () => store.save({
            category,
            content,
            namespace: "zee",
            metadata: {
              importance,
              tags,
              surface: ctx.extra?.surface as string | undefined,
              sessionId: ctx.extra?.sessionId as string | undefined,
              agent: "zee",
              extra: relatedTo ? { relatedTo } : undefined,
            },
            domain,
            topic,
            subtopic,
            memoryId,
            kind,
            priority,
            bookmarked,
            memoryType,
            confidence,
            evidenceFor,
            evidenceAgainst,
          }),
          { toolName: "zee:memory-store", maxAttempts: 2 },
        );

        if ("error" in saveResult) {
          const err = saveResult.error;
          return {
            title: `Memory Store Failed`,
            metadata: { error: err.message, attempts: saveResult.attempts },
            output: buildEscalation(err, "zee:memory-store"),
          };
        }

        const entry = saveResult.result;
        const locationParts = [domain, topic, subtopic].filter(Boolean);
        const locationStr = locationParts.length > 0 ? `- Location: ${locationParts.join("/")}` : "";
        const versionStr = entry.version && entry.version > 1 ? `- Version: ${entry.version}` : "";
        const confidenceStr = entry.confidence !== undefined ? `- Confidence: ${(entry.confidence * 100).toFixed(0)}%` : "";

        return {
          title: `Memory Stored`,
          metadata: {
            id: entry.id,
            memoryId: entry.memoryId,
            category,
            importance,
            tags,
            version: entry.version,
            ...(saveResult.attempts > 1 ? { retries: saveResult.attempts - 1 } : {}),
          },
          output: `Remembered: "${content.substring(0, 100)}${content.length > 100 ? "..." : ""}"

Memory saved with ID: ${entry.id}
- Category: ${category}
- Importance: ${((importance ?? 0.5) * 100).toFixed(0)}%
${tags?.length ? `- Tags: ${tags.join(", ")}` : ""}
${locationStr}
${versionStr}
${confidenceStr}
${entry.memoryId ? `- Memory ID: ${entry.memoryId}` : ""}

This memory can be recalled later using zee:memory-search or zee:memory-agentic-search.`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        return {
          title: `Memory Store Error`,
          metadata: { error: errorMsg },
          output: `Failed to store memory: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Search Tool
// =============================================================================

const MemorySearchParams = z.object({
  query: z.string().describe("Search query"),
  category: z.enum(["conversation", "fact", "preference", "task", "decision", "note", "all"])
    .optional().describe("Filter by category"),
  limit: z.number().default(5).describe("Maximum results"),
  threshold: z.number().min(0).max(1).default(0.5)
    .describe("Minimum similarity threshold"),
  timeRange: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional().describe("Filter by time range"),
});

export const memorySearchTool: ToolDefinition = {
  id: "zee:memory-search",
  category: "domain",
  init: async () => ({
    description: `Search stored memories using semantic similarity. Understands meaning, not just keywords. Filter by category and timeRange.`,
    parameters: MemorySearchParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { query, category, limit, threshold, timeRange } = args;

      ctx.metadata({ title: `Searching: ${query}` });

      try {
        const store = getMemory();

        // Retry search on transient connection failures
        const searchResult = await withRetry(
          () => store.search({
            query,
            namespace: "zee",
            limit: limit ?? 5,
            threshold: threshold ?? 0.5,
            category: category && category !== "all" ? category as any : undefined,
            timeRange: timeRange ? {
              start: timeRange.start ? new Date(timeRange.start).getTime() : undefined,
              end: timeRange.end ? new Date(timeRange.end).getTime() : undefined,
            } : undefined,
          }),
          { toolName: "zee:memory-search" },
        );

        if ("error" in searchResult) {
          return {
            title: `Memory Search Failed`,
            metadata: { query, error: searchResult.error.message, attempts: searchResult.attempts },
            output: buildEscalation(searchResult.error, "zee:memory-search"),
          };
        }

        const results = searchResult.result;

        if (results.length === 0) {
          // Fallback: list recent memories when semantic search misses
          try {
            const fallbackCategory = category && category !== "all" ? category as any : undefined;
            const fallback = await store.list({ limit: limit ?? 5, category: fallbackCategory, namespace: "zee" });
            if (fallback.length > 0) {
              const formattedFallback = fallback
                .map((entry: any, i: number) => {
                  const preview = entry.content.substring(0, 150);
                  const ellipsis = entry.content.length > 150 ? "..." : "";
                  const date = new Date(entry.createdAt).toLocaleDateString();
                  return `${i + 1}. [${entry.category}] (${date})
   "${preview}${ellipsis}"
   ID: ${entry.id}`;
                })
                .join("\n\n");

              return {
                title: `${fallback.length} Recent Memories (fallback)`,
                metadata: { query, resultCount: fallback.length, fallback: true },
                output: `No semantic matches for "${query}", showing ${fallback.length} recent memories instead:

${formattedFallback}

(These are recent memories, not similarity-ranked. Try zee:memory-agentic-search with a domain filter for structured lookups.)`,
              };
            }
          } catch {
            // fallback itself failed, return standard no-results message
          }

          return {
            title: `No Memories Found`,
            metadata: { query, resultCount: 0 },
            output: `No memories found matching: "${query}"

Try:
- Using different keywords
- Removing category filters
- Using zee:memory-agentic-search with domain/topic filters for structured data`,
          };
        }

        const formattedResults = results.map((r, i) => {
          const preview = r.entry.content.substring(0, 150);
          const ellipsis = r.entry.content.length > 150 ? "..." : "";
          const date = new Date(r.entry.createdAt).toLocaleDateString();
          const score = (r.score * 100).toFixed(0);
          return `${i + 1}. [${r.entry.category}] (${score}% match, ${date})
   "${preview}${ellipsis}"
   ID: ${r.entry.id}`;
        }).join("\n\n");

        return {
          title: `Found ${results.length} Memories`,
          metadata: {
            query,
            resultCount: results.length,
            topScore: results[0]?.score,
          },
          output: `Found ${results.length} memories matching: "${query}"

${formattedResults}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        return {
          title: `Memory Search Error`,
          metadata: { error: errorMsg },
          output: `Failed to search memories: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Messaging Tool
// =============================================================================

const MessagingParams = z.object({
  channel: z.enum(["whatsapp", "matrix"])
    .describe("Messaging channel: whatsapp or matrix"),
  to: z.string().describe("Recipient: WhatsApp chatId/JID/E.164 or Matrix room ID"),
  message: z.string().describe("Message content (text or caption for media)"),
  mediaUrl: z.string().optional()
    .describe("URL or local file path to media (audio, image, video, document). For voice notes, use audio/ogg with opus codec."),
  account: z.string().optional()
    .describe('Account to use (default: "zee")'),
});

export const messagingTool: ToolDefinition = {
  id: "zee:messaging",
  category: "domain",
  init: async () => ({
    description: `Send messages via WhatsApp or Matrix gateways. Always search memory for recipient contact info before asking the user.

WhatsApp: to=E164 phone or JID ("num@c.us"/"id@g.us"). Supports mediaUrl for images/audio/video.
Matrix: to=room ID (e.g. "!room:server").`,
    parameters: MessagingParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { channel, to, message, mediaUrl, account } = args;

      const hasMedia = Boolean(mediaUrl?.trim());
      ctx.metadata({ title: `Sending via ${channel}${hasMedia ? " (media)" : ""}` });

      // Validate mediaUrl if it looks like a local file path
      let validatedMediaUrl = mediaUrl?.trim();
      if (validatedMediaUrl) {
        try {
          const result = validateMediaPath(validatedMediaUrl, {
            cwd: process.cwd(),
            permissive: true, // allow paths outside home, but block sensitive dirs
          });
          if (result) {
            validatedMediaUrl = result.resolved;
          }
        } catch (err) {
          if (err instanceof PathValidationError) {
            return {
              title: `${channel} Send Blocked`,
              metadata: { channel, to, error: err.message },
              output: `Media path blocked: ${err.message}`,
            };
          }
          throw err;
        }
      }

      const rawBaseUrl =
        process.env.AGENT_CORE_URL ||
        process.env.AGENT_CORE_DAEMON_URL ||
        `http://127.0.0.1:${process.env.AGENT_CORE_PORT || process.env.AGENT_CORE_DAEMON_PORT || "3210"}`;
      const baseUrl = rawBaseUrl.replace(/\/$/, "");

      try {
        if (channel === "whatsapp") {
          // Send via WhatsApp gateway (Zee only)
          // account can be 'zee' (bot number) or 'personal' (your number), or any configured account
          const accountId = account || "zee";
          const response = await fetch(`${baseUrl}/gateway/whatsapp/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId: to,
              message,
              accountId,
              ...(validatedMediaUrl ? { mediaUrl: validatedMediaUrl } : {}),
            }),
          });

          const rawResult = await response.json();
          const parseResult = GatewayResponseSchema.safeParse(rawResult);

          if (!parseResult.success) {
            log.error("WhatsApp gateway response validation failed", {
              errors: parseResult.error.flatten().fieldErrors,
            });
            return {
              title: `WhatsApp Send Failed`,
              metadata: { channel, to, error: "Invalid response from gateway" },
              output: `Failed to send WhatsApp message: Invalid response from gateway`,
            };
          }

          const result = parseResult.data;

          if (!result.success) {
            return {
              title: `WhatsApp Send Failed`,
              metadata: { channel, to, error: result.error },
              output: `Failed to send WhatsApp message: ${result.error || "Unknown error"}

Troubleshooting:
- Ensure \`agent-core daemon\` is running
- Check \`agent-core debug status\` shows Gateway: Active
- Verify recipient format (E164 like "+1555..." or JID like "1234567890@c.us")`,
            };
          }

          const accountLabel = accountId === "personal" ? "your personal WhatsApp" : `WhatsApp account "${accountId}"`;
          const mediaLabel = hasMedia ? " with media" : "";
          const preview = message.trim()
            ? `Preview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`
            : hasMedia
              ? `Media: ${mediaUrl}`
              : "";
          return {
            title: `WhatsApp Message Sent${mediaLabel}`,
            metadata: { channel, to, account: accountId, hasMedia, success: true },
            output: `Message sent via ${accountLabel} to ${to}${mediaLabel}

${preview}`,
          };

        } else if (channel === "matrix") {
          const accountId = account || "zee";
          const response = await fetch(`${baseUrl}/gateway/matrix/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              roomId: to,
              message,
              accountId,
              ...(validatedMediaUrl ? { mediaUrl: validatedMediaUrl } : {}),
            }),
          });

          const rawResult = await response.json();
          const parseResult = GatewayResponseSchema.safeParse(rawResult);

          if (!parseResult.success) {
            log.error("Matrix gateway response validation failed", {
              errors: parseResult.error.flatten().fieldErrors,
            });
            return {
              title: `Matrix Send Failed`,
              metadata: { channel, to, account: accountId, error: "Invalid response from gateway" },
              output: `Failed to send Matrix message: Invalid response from gateway`,
            };
          }

          const result = parseResult.data;

          if (!result.success) {
            return {
              title: `Matrix Send Failed`,
              metadata: { channel, to, account: accountId, error: result.error },
              output: `Failed to send Matrix message: ${result.error || "Unknown error"}

Troubleshooting:
- Ensure \`agent-core daemon\` is running
- Check \`agent-core debug status\` shows Gateway: Active
- Verify the room ID is correct (e.g., "!room:server")`,
            };
          }

          return {
            title: `Matrix Message Sent`,
            metadata: { channel, to, account: accountId, success: true },
            output: `Message sent via Matrix account "${accountId}" to ${to}

Preview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`,
          };
        }

        return {
          title: `Unsupported Channel`,
          metadata: { channel, error: "unsupported" },
          output: `Channel "${channel}" is not supported. Use "whatsapp" or "matrix".`,
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        return {
          title: `Messaging Error`,
          metadata: { channel, to, error: errorMsg },
          output: `Failed to send message: ${errorMsg}

Troubleshooting:
- Ensure agent-core daemon is running
- Check gateway status with /status command
- Verify network connectivity`,
        };
      }
    },
  }),
};

// =============================================================================
// Notification Tool
// =============================================================================

const NotificationParams = z.object({
  type: z.enum(["alert", "reminder", "summary", "update"])
    .describe("Notification type"),
  title: z.string().describe("Notification title"),
  body: z.string().describe("Notification body"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal")
    .describe("Priority level"),
  schedule: z.string().optional()
    .describe("ISO date or cron expression for scheduling"),
  channels: z.array(z.enum(["push", "whatsapp", "matrix", "email"])).default(["push"])
    .describe("Channels to notify through"),
});

export const notificationTool: ToolDefinition = {
  id: "zee:notification",
  category: "domain",
  init: async () => ({
    description: `Create notifications and reminders. Types: alert (immediate), reminder (scheduled), summary, update. Use schedule for ISO date or cron expression.`,
    parameters: NotificationParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { type, title, body, priority, schedule, channels } = args;

      ctx.metadata({ title: `Notification: ${title}` });

      return {
        title: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${title}`,
        metadata: {
          type,
          priority,
          scheduled: !!schedule,
          channels,
        },
        output: `[Zee would create ${type}]

Title: ${title}
Body: ${body}
Priority: ${priority}
${schedule ? `Schedule: ${schedule}` : "Immediate"}
Channels: ${channels.join(", ")}

The notification system will:
1. Store the notification/reminder
2. Schedule delivery if needed
3. Send through configured channels
4. Track read/acknowledged status`,
      };
    },
  }),
};

// =============================================================================
// Calendar Tool
// =============================================================================

const CalendarParams = z.object({
  action: z.enum(["list", "today", "week", "month", "show", "create", "update", "delete", "suggest", "find-free", "quick-add"])
    .describe("Calendar action"),
  dateRange: z.object({
    start: z.string(),
    end: z.string(),
  }).optional().describe("Date range for 'list' or 'find-free' action (ISO dates)"),
  year: z.number().optional().describe("Year for 'month' action"),
  month: z.number().min(0).max(11).optional().describe("Month (0-11) for 'month' action"),
  // Event creation/update parameters
  event: z.object({
    summary: z.string().describe("Event title"),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.string().describe("Start time (ISO datetime or YYYY-MM-DD for all-day)"),
    end: z.string().describe("End time (ISO datetime or YYYY-MM-DD for all-day)"),
    attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
  }).optional().describe("Event details for create/update"),
  eventId: z.string().optional().describe("Event ID for update/delete"),
  // Smart scheduling parameters
  durationMinutes: z.number().optional().describe("Meeting duration for 'suggest' action"),
  withinDays: z.number().optional().describe("Search window in days (default: 7)"),
  preferMorning: z.boolean().optional().describe("Prefer morning slots"),
  preferAfternoon: z.boolean().optional().describe("Prefer afternoon slots"),
  quickAddText: z.string().optional().describe("Natural language event for 'quick-add'"),
});

export const calendarTool: ToolDefinition = {
  id: "zee:calendar",
  category: "domain",
  init: async () => ({
    description: `Google Calendar with smart scheduling. Search memory for attendee emails before asking the user.

View: today/week/month/list/show. Manage: create/update/delete/quick-add. Smart: suggest (optimal times), find-free (available slots).
Create with { event: { summary, start, end } }. Quick-add with { quickAddText: "Lunch tomorrow at noon" }.`,
    parameters: CalendarParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, dateRange, year, month, event, eventId, durationMinutes, withinDays, preferMorning, preferAfternoon, quickAddText } = args;

      ctx.metadata({ title: `Calendar: ${action}` });

      // Check credentials first
      const hasCredentials = await checkCredentialsExist();
      if (!hasCredentials) {
        return {
          title: `Calendar Error`,
          metadata: { action },
          output: `Google Calendar credentials not found.

Please set up OAuth credentials at:
  ~/.zee/credentials/google/oauth-client.json
  ~/.zee/credentials/google/tokens.json

You can create credentials at:
  https://console.cloud.google.com/apis/credentials

Required scopes:
  - https://www.googleapis.com/auth/calendar
  - https://www.googleapis.com/auth/calendar.events`,
        };
      }

      try {
        // Handle event management actions
        if (action === "create" && event) {
          const isAllDay = !event.start.includes("T");
          const created = await createEvent("primary", {
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: isAllDay ? { date: event.start } : { dateTime: event.start },
            end: isAllDay ? { date: event.end } : { dateTime: event.end },
            attendees: event.attendees?.map((email: string) => ({ email })),
          });
          return {
            title: `Event Created`,
            metadata: { action, eventId: created.id },
            output: `Created event: ${created.summary}
ID: ${created.id}
When: ${created.start.dateTime || created.start.date}
${created.location ? `Where: ${created.location}` : ""}
${created.htmlLink ? `Link: ${created.htmlLink}` : ""}`,
          };
        }

        if (action === "update" && eventId && event) {
          const isAllDay = event.start && !event.start.includes("T");
          const updated = await updateEvent("primary", eventId, {
            summary: event.summary,
            description: event.description,
            location: event.location,
            ...(event.start && { start: isAllDay ? { date: event.start } : { dateTime: event.start } }),
            ...(event.end && { end: isAllDay ? { date: event.end } : { dateTime: event.end } }),
            ...(event.attendees && { attendees: event.attendees.map((email: string) => ({ email })) }),
          });
          return {
            title: `Event Updated`,
            metadata: { action, eventId },
            output: `Updated event: ${updated.summary}
When: ${updated.start.dateTime || updated.start.date}`,
          };
        }

        if (action === "delete" && eventId) {
          await deleteEvent("primary", eventId);
          return {
            title: `Event Deleted`,
            metadata: { action, eventId },
            output: `Deleted event: ${eventId}`,
          };
        }

        if (action === "quick-add" && quickAddText) {
          const created = await quickAddEvent("primary", quickAddText);
          return {
            title: `Event Created (Quick Add)`,
            metadata: { action, eventId: created.id },
            output: `Created: ${created.summary}
When: ${created.start.dateTime || created.start.date}
ID: ${created.id}`,
          };
        }

        // Handle smart scheduling actions
        if (action === "suggest") {
          const duration = durationMinutes || 30;
          const suggestions = await suggestMeetingTimes("primary", {
            durationMinutes: duration,
            withinDays: withinDays || 7,
            preferMorning,
            preferAfternoon,
          });

          if (suggestions.length === 0) {
            return {
              title: `No Available Slots`,
              metadata: { action, durationMinutes: duration },
              output: `No ${duration}-minute slots available in the next ${withinDays || 7} days.`,
            };
          }

          const suggestionsList = suggestions.map((s, i) => {
            const startStr = s.start.toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
            });
            const endStr = s.end.toLocaleTimeString("en-US", {
              hour: "numeric", minute: "2-digit",
            });
            return `${i + 1}. ${startStr} - ${endStr} (${s.reason}, score: ${s.score})`;
          }).join("\n");

          return {
            title: `Meeting Suggestions`,
            metadata: { action, count: suggestions.length, durationMinutes: duration },
            output: `Best times for a ${duration}-minute meeting:

${suggestionsList}

To schedule, use: { action: "create", event: { summary: "...", start: "<ISO>", end: "<ISO>" } }`,
          };
        }

        if (action === "find-free" && dateRange && durationMinutes) {
          const slots = await findFreeSlots("primary", {
            startDate: new Date(dateRange.start),
            endDate: new Date(dateRange.end),
            minDurationMinutes: durationMinutes,
          });

          if (slots.length === 0) {
            return {
              title: `No Free Slots`,
              metadata: { action, durationMinutes },
              output: `No ${durationMinutes}-minute free slots between ${dateRange.start} and ${dateRange.end}.`,
            };
          }

          const slotsList = slots.slice(0, 10).map((s) => {
            const startStr = s.start.toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
            });
            const endStr = s.end.toLocaleTimeString("en-US", {
              hour: "numeric", minute: "2-digit",
            });
            return `• ${startStr} - ${endStr} (${s.durationMinutes} min available)`;
          }).join("\n");

          return {
            title: `Free Time Slots`,
            metadata: { action, count: slots.length, durationMinutes },
            output: `Found ${slots.length} free slot(s) of ${durationMinutes}+ minutes:

${slotsList}${slots.length > 10 ? `\n... and ${slots.length - 10} more` : ""}`,
          };
        }

        // Handle view actions (original functionality)
        let events: FormattedEvent[] = [];
        let periodLabel = "";

        if (action === "show") {
          periodLabel = "Calendar";
        } else if (action === "today") {
          const raw = await getTodayEvents();
          events = formatEventsForCanvas(raw);
          periodLabel = "Today";
        } else if (action === "week") {
          const raw = await getWeekEvents();
          events = formatEventsForCanvas(raw);
          periodLabel = "This Week";
        } else if (action === "month") {
          const raw = await getMonthEvents("primary", year, month);
          events = formatEventsForCanvas(raw);
          const targetDate = new Date(year ?? new Date().getFullYear(), month ?? new Date().getMonth(), 1);
          periodLabel = targetDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        } else if (action === "list" && dateRange) {
          const raw = await listEvents("primary", {
            timeMin: new Date(dateRange.start).toISOString(),
            timeMax: new Date(dateRange.end).toISOString(),
          });
          events = formatEventsForCanvas(raw);
          periodLabel = `${dateRange.start} to ${dateRange.end}`;
        }

        // Format events for display
        const eventsList = events.length > 0
          ? events.map((e) => {
              const time = e.isAllDay ? "All day" : `${e.startTime}${e.endTime ? ` - ${e.endTime}` : ""}`;
              const loc = e.location ? ` @ ${e.location}` : "";
              return `• ${e.date} ${time}: ${e.title}${loc}`;
            }).join("\n")
          : "No events found.";

        return {
          title: `Calendar: ${periodLabel}`,
          metadata: { action, eventCount: events.length, period: periodLabel },
          output: `${periodLabel} - ${events.length} event(s)

${eventsList}`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("401") || errorMessage.includes("invalid_grant")) {
          return {
            title: `Calendar Auth Error`,
            metadata: { action },
            output: `Google Calendar authentication failed. Re-authenticate at ~/.zee/credentials/google/`,
          };
        }

        return {
          title: `Calendar Error`,
          metadata: { action },
          output: `Calendar operation failed: ${errorMessage}`,
        };
      }
    },
  }),
};

// =============================================================================
// Contacts Tool
// =============================================================================

const ContactsParams = z.object({
  action: z.enum(["search", "get", "create", "update"])
    .describe("Contacts action"),
  query: z.string().optional()
    .describe("Search query (name, email, phone)"),
  contactId: z.string().optional()
    .describe("Contact ID for get/update"),
  data: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional().describe("Contact data"),
});

export const contactsTool: ToolDefinition = {
  id: "zee:contacts",
  category: "domain",
  init: async () => ({
    description: `Manage contact information. Actions: search, get, create, update. Always check memory for existing contacts before creating duplicates.`,
    parameters: ContactsParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, query, contactId, data } = args;

      ctx.metadata({ title: `Contacts: ${action}` });

      return {
        title: `Contacts: ${action}`,
        metadata: {
          action,
          hasQuery: !!query,
          hasData: !!data,
        },
        output: `[Zee would ${action} contacts]

Action: ${action}
${query ? `Query: "${query}"` : ""}
${contactId ? `Contact ID: ${contactId}` : ""}
${data ? `Data: ${JSON.stringify(data, null, 2)}` : ""}

Contacts are synced across:
- WhatsApp contacts
- Phone contacts
- Email address book
- Custom contact database`,
      };
    },
  }),
};

// =============================================================================
// Splitwise Tool
// =============================================================================

const SplitwiseValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const SplitwiseParams = z.object({
  action: z.enum(SPLITWISE_ACTIONS as [SplitwiseAction, ...SplitwiseAction[]])
    .describe("Splitwise action to perform"),
  groupId: z.number().optional().describe("Group ID for group actions"),
  friendId: z.number().optional().describe("Friend ID for friend actions"),
  expenseId: z.number().optional().describe("Expense ID for expense actions"),
  endpoint: z.string().optional().describe("Endpoint for request action (e.g., get_expenses)"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method for request action"),
  query: z.record(SplitwiseValueSchema).optional().describe("Query parameters"),
  payload: z.record(SplitwiseValueSchema).optional().describe("Request payload"),
  payloadFormat: z.enum(["json", "form"]).default("json").describe("Payload encoding for POST/PUT"),
  timeoutMs: z.number().optional().describe("Override timeout in ms"),
});

export const splitwiseTool: ToolDefinition = {
  id: "zee:splitwise",
  category: "domain",
  init: async () => ({
    description: `Access Splitwise API for shared expenses and balances. Search memory for group/friend IDs before asking the user. Actions: current-user, groups, friends, expenses, create-expense, balances, request (custom endpoint).`,
    parameters: SplitwiseParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Splitwise: ${args.action}` });

      const config = resolveSplitwiseConfig();
      if (!config.enabled) {
        return {
          title: "Splitwise Disabled",
          metadata: { action: args.action, enabled: false },
          output: `Splitwise tooling is disabled.

Enable it in agent-core.jsonc:
{
  "zee": {
    "splitwise": {
      "enabled": true,
      "token": "{env:SPLITWISE_TOKEN}"
    }
  }
}`,
        };
      }

      if (config.error) {
        return {
          title: "Splitwise Configuration Error",
          metadata: { action: args.action, enabled: true },
          output: config.error,
        };
      }

      if (!config.token) {
        return {
          title: "Splitwise Token Missing",
          metadata: { action: args.action, enabled: true },
          output: `Splitwise token is not configured.

Set one of:
- zee.splitwise.token in agent-core.jsonc
- zee.splitwise.tokenFile in agent-core.jsonc
- SPLITWISE_TOKEN environment variable`,
        };
      }

      const requestResult = buildSplitwiseRequest({
        action: args.action,
        groupId: args.groupId,
        friendId: args.friendId,
        expenseId: args.expenseId,
        endpoint: args.endpoint,
        method: args.method,
        query: args.query as Record<string, SplitwiseValue> | undefined,
        payload: args.payload as Record<string, SplitwiseValue> | undefined,
        payloadFormat: args.payloadFormat,
        timeoutMs: args.timeoutMs,
      });

      if (requestResult.error || !requestResult.request) {
        return {
          title: "Splitwise Request Error",
          metadata: { action: args.action },
          output: requestResult.error || "Invalid Splitwise request.",
        };
      }

      try {
        const response = await callSplitwiseApi(requestResult.request, config);
        const output =
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data, null, 2);

        if (!response.ok) {
          return {
            title: `Splitwise Error (${response.status})`,
            metadata: {
              action: args.action,
              endpoint: requestResult.request.endpoint,
              status: response.status,
            },
            output: output || response.raw || "Splitwise request failed.",
          };
        }

        return {
          title: `Splitwise ${args.action}`,
          metadata: {
            action: args.action,
            endpoint: requestResult.request.endpoint,
            status: response.status,
          },
          output: output || "Splitwise request succeeded.",
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isTimeout = error instanceof Error && error.name === "AbortError";
        return {
          title: "Splitwise Request Failed",
          metadata: { action: args.action, error: errorMsg },
          output: isTimeout
            ? `Splitwise request timed out.`
            : `Splitwise request failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// CodexBar Tool
// =============================================================================

const CodexbarParams = z.object({
  args: z.array(z.string()).default([]).describe("Arguments to pass to codexbar CLI"),
  timeoutMs: z.number().optional().describe("Override timeout in ms"),
});

export const codexbarTool: ToolDefinition = {
  id: "zee:codexbar",
  category: "domain",
  init: async () => ({
    description: `Run CodexBar CLI commands to check provider usage and resets. Pass CLI arguments via args array.`,
    parameters: CodexbarParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "CodexBar" });

      const config = resolveCodexbarConfig();
      if (!config.enabled) {
        return {
          title: "CodexBar Disabled",
          metadata: { enabled: false },
          output: `CodexBar tooling is disabled.

Enable it in agent-core.jsonc:
{
  "zee": {
    "codexbar": {
      "enabled": true
    }
  }
}`,
        };
      }

      if (config.error) {
        return {
          title: "CodexBar Configuration Error",
          metadata: { enabled: true },
          output: config.error,
        };
      }

      const result = runCodexbar(args.args, config, args.timeoutMs);
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      const output = stdout || stderr;

      if (!result.ok) {
        return {
          title: "CodexBar Failed",
          metadata: { exitCode: result.status, error: result.error },
          output: result.error || output || "CodexBar command failed.",
        };
      }

      return {
        title: "CodexBar Output",
        metadata: { exitCode: result.status },
        output: output || "CodexBar command completed with no output.",
      };
    },
  }),
};

// =============================================================================
// WhatsApp Reaction Tool
// =============================================================================

const WhatsAppReactionParams = z.object({
  action: z.enum(["react"]).describe("Action to perform"),
  chatJid: z.string().describe("WhatsApp chat JID (e.g., '1234567890@c.us' for DM, 'groupId@g.us' for groups)"),
  messageId: z.string().describe("Message stanza ID to react to"),
  emoji: z.string().describe("Emoji character (e.g., '👍', '❤️', '😂'). Empty string to remove reaction."),
  remove: z.boolean().optional().describe("Set true to explicitly remove the reaction"),
});

export const whatsappReactionTool: ToolDefinition = {
  id: "zee:whatsapp-react",
  category: "domain",
  init: async () => ({
    description: `Add or remove emoji reactions to WhatsApp messages. chatJid format: "num@c.us" (DM) or "id@g.us" (group). Empty emoji or remove=true to remove reaction.`,
    parameters: WhatsAppReactionParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, chatJid, messageId, emoji, remove } = args;

      ctx.metadata({ title: `WhatsApp: ${remove ? "Remove" : "Add"} reaction` });

      const rawBaseUrl =
        process.env.AGENT_CORE_URL ||
        process.env.AGENT_CORE_DAEMON_URL ||
        `http://127.0.0.1:${process.env.AGENT_CORE_PORT || process.env.AGENT_CORE_DAEMON_PORT || "3210"}`;
      const baseUrl = rawBaseUrl.replace(/\/$/, "");

      try {
        // Note: This endpoint needs to be added to the server
        // For now, we'll use the existing sendMessage with a reaction-specific format
        // until a dedicated endpoint is added
        const response = await fetch(`${baseUrl}/gateway/whatsapp/react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatJid, messageId, emoji: remove ? "" : emoji }),
        });

        if (!response.ok) {
          // Fallback: endpoint not implemented yet
          return {
            title: `WhatsApp Reaction (Not Implemented)`,
            metadata: { action, chatJid, messageId, emoji, remove },
            output: `WhatsApp reaction endpoint not yet available.

The reaction would be:
- Chat: ${chatJid}
- Message: ${messageId}
- Emoji: ${remove ? "(remove)" : emoji}

To enable reactions, add the /gateway/whatsapp/react endpoint to the daemon.`,
          };
        }

        const rawResult = await response.json();
        const parseResult = GatewayResponseSchema.safeParse(rawResult);

        if (!parseResult.success) {
          log.error("WhatsApp reaction response validation failed", {
            errors: parseResult.error.flatten().fieldErrors,
          });
          return {
            title: `WhatsApp Reaction Failed`,
            metadata: { action, chatJid, messageId, emoji, error: "Invalid response from gateway" },
            output: `Failed to ${remove ? "remove" : "add"} reaction: Invalid response from gateway`,
          };
        }

        const result = parseResult.data;

        if (!result.success) {
          return {
            title: `WhatsApp Reaction Failed`,
            metadata: { action, chatJid, messageId, emoji, error: result.error },
            output: `Failed to ${remove ? "remove" : "add"} reaction: ${result.error || "Unknown error"}`,
          };
        }

        return {
          title: `WhatsApp Reaction ${remove ? "Removed" : "Added"}`,
          metadata: { action, chatJid, messageId, emoji, success: true },
          output: remove
            ? `Removed reaction from message ${messageId.substring(0, 8)}...`
            : `Added ${emoji} reaction to message ${messageId.substring(0, 8)}...`,
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Connection error likely means endpoint not implemented
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: `WhatsApp Reaction (Daemon Unavailable)`,
            metadata: { action, chatJid, messageId, emoji, error: errorMsg },
            output: `Could not connect to daemon to send reaction.

Ensure agent-core daemon is running with --whatsapp flag.

The reaction would be:
- Chat: ${chatJid}
- Message: ${messageId}
- Emoji: ${remove ? "(remove)" : emoji}`,
          };
        }

        return {
          title: `WhatsApp Reaction Error`,
          metadata: { action, chatJid, messageId, emoji, error: errorMsg },
          output: `Error sending reaction: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Browse Tool (Context Tree Navigation)
// =============================================================================

const MemoryBrowseParams = z.object({
  action: z.enum(["list-domains", "list-topics", "list-subtopics", "get-entries"])
    .describe("Browse action"),
  domain: z.string().optional()
    .describe("Domain to browse (required for list-topics, list-subtopics, get-entries)"),
  topic: z.string().optional()
    .describe("Topic to browse (required for list-subtopics)"),
  subtopic: z.string().optional()
    .describe("Subtopic filter for get-entries"),
  limit: z.number().optional()
    .describe("Max results for get-entries"),
});

export const memoryBrowseTool: ToolDefinition = {
  id: "zee:memory-browse",
  category: "domain",
  init: async () => ({
    description: `Browse the memory context tree to discover domains/topics before searching. Actions: list-domains, list-topics, list-subtopics, get-entries.`,
    parameters: MemoryBrowseParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, domain, topic, subtopic, limit } = args;

      ctx.metadata({ title: `Memory Browse: ${action}` });

      try {
        const store = getMemory();

        if (action === "list-domains") {
          const domains = await store.listDomains();
          if (domains.length === 0) {
            return {
              title: "No Domains",
              metadata: { action, count: 0 },
              output: "No memory domains found. Store memories with a 'domain' field to create tree structure.",
            };
          }
          const list = domains.map((d) => `- ${d.domain}`).join("\n");
          return {
            title: `${domains.length} Domains`,
            metadata: { action, count: domains.length },
            output: `Memory domains:\n\n${list}`,
          };
        }

        if (action === "list-topics") {
          if (!domain) {
            return {
              title: "Missing Domain",
              metadata: { action, error: "missing_domain" },
              output: "Provide 'domain' to list topics.",
            };
          }
          const topics = await store.listTopics(domain);
          if (topics.length === 0) {
            return {
              title: `No Topics in ${domain}`,
              metadata: { action, domain, count: 0 },
              output: `No topics found in domain "${domain}".`,
            };
          }
          const list = topics.map((t) => `- ${t.topic}`).join("\n");
          return {
            title: `${topics.length} Topics in ${domain}`,
            metadata: { action, domain, count: topics.length },
            output: `Topics in "${domain}":\n\n${list}`,
          };
        }

        if (action === "list-subtopics") {
          if (!domain || !topic) {
            return {
              title: "Missing Parameters",
              metadata: { action, error: "missing_params" },
              output: "Provide 'domain' and 'topic' to list subtopics.",
            };
          }
          const subtopics = await store.listSubtopics(domain, topic);
          if (subtopics.length === 0) {
            return {
              title: `No Subtopics in ${domain}/${topic}`,
              metadata: { action, domain, topic, count: 0 },
              output: `No subtopics found in "${domain}/${topic}".`,
            };
          }
          const list = subtopics.map((s) => `- ${s.subtopic}`).join("\n");
          return {
            title: `${subtopics.length} Subtopics in ${domain}/${topic}`,
            metadata: { action, domain, topic, count: subtopics.length },
            output: `Subtopics in "${domain}/${topic}":\n\n${list}`,
          };
        }

        if (action === "get-entries") {
          if (!domain) {
            return {
              title: "Missing Domain",
              metadata: { action, error: "missing_domain" },
              output: "Provide 'domain' to get entries.",
            };
          }
          const results = await store.agenticSearch({
            domain,
            topic,
            subtopic,
            namespace: "zee",
            limit: limit ?? 20,
          });
          if (results.length === 0) {
            const path = [domain, topic, subtopic].filter(Boolean).join("/");
            return {
              title: `No Entries at ${path}`,
              metadata: { action, domain, topic, subtopic, count: 0 },
              output: `No memories found at "${path}".`,
            };
          }
          const list = results.map((r, i) => {
            const e = r.entry;
            const preview = e.content.substring(0, 120);
            const ellipsis = e.content.length > 120 ? "..." : "";
            const ver = e.version && e.version > 1 ? ` (v${e.version})` : "";
            return `${i + 1}. [${e.category}]${ver} "${preview}${ellipsis}"\n   ID: ${e.id} | memoryId: ${e.memoryId ?? "n/a"}`;
          }).join("\n\n");
          return {
            title: `${results.length} Entries`,
            metadata: { action, domain, topic, subtopic, count: results.length },
            output: `Memories at ${[domain, topic, subtopic].filter(Boolean).join("/")}:\n\n${list}`,
          };
        }

        return {
          title: "Unknown Action",
          metadata: { action },
          output: `Unknown browse action: ${action}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Memory Unavailable",
            metadata: { error: "connection_failed" },
            output: `Could not connect to memory storage (Qdrant). Error: ${errorMsg}`,
          };
        }
        return {
          title: "Memory Browse Error",
          metadata: { error: errorMsg },
          output: `Failed to browse memories: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Agentic Search Tool
// =============================================================================

const MemoryAgenticSearchParams = z.object({
  domain: z.string().describe("Domain to search within"),
  topic: z.string().optional().describe("Topic filter"),
  subtopic: z.string().optional().describe("Subtopic filter"),
  query: z.string().optional().describe("Optional semantic query within filtered set"),
  kind: z.union([
    z.enum(["curated", "auto", "agent"]),
    z.array(z.enum(["curated", "auto", "agent"])),
  ]).optional().describe("Filter by kind"),
  priority: z.union([
    z.enum(["high", "normal", "low"]),
    z.array(z.enum(["high", "normal", "low"])),
  ]).optional().describe("Filter by priority"),
  bookmarked: z.boolean().optional().describe("Filter bookmarked only"),
  memoryType: z.enum(["fact", "reasoning"]).optional().describe("Filter by memory type"),
  limit: z.number().optional().describe("Max results (default 20)"),
});

export const memoryAgenticSearchTool: ToolDefinition = {
  id: "zee:memory-agentic-search",
  category: "domain",
  init: async () => ({
    description: `Filter-first memory search by domain/topic, then optional semantic search within results. Use when you know the domain. Supports kind, priority, bookmarked, and memoryType filters.`,
    parameters: MemoryAgenticSearchParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { domain, topic, subtopic, query, kind, priority, bookmarked, memoryType, limit } = args;

      ctx.metadata({ title: `Agentic Search: ${domain}${topic ? "/" + topic : ""}` });

      try {
        const store = getMemory();
        const results = await store.agenticSearch({
          domain,
          topic,
          subtopic,
          query,
          namespace: "zee",
          kind: kind as any,
          priority: priority as any,
          bookmarked,
          memoryType: memoryType as any,
          limit,
        });

        if (results.length === 0) {
          return {
            title: "No Results",
            metadata: { domain, topic, subtopic, query, count: 0 },
            output: `No memories found matching filters.`,
          };
        }

        const list = results.map((r, i) => {
          const e = r.entry;
          const preview = e.content.substring(0, 150);
          const ellipsis = e.content.length > 150 ? "..." : "";
          const score = r.score < 1.0 ? ` (${(r.score * 100).toFixed(0)}% match)` : "";
          const ver = e.version && e.version > 1 ? ` v${e.version}` : "";
          const date = new Date(e.createdAt).toLocaleDateString();
          return `${i + 1}. [${e.category}${ver}]${score} (${date})
   "${preview}${ellipsis}"
   ID: ${e.id}`;
        }).join("\n\n");

        return {
          title: `${results.length} Results`,
          metadata: { domain, topic, subtopic, query, count: results.length },
          output: `Found ${results.length} memories:\n\n${list}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Memory Unavailable",
            metadata: { error: "connection_failed" },
            output: `Could not connect to memory storage (Qdrant). Error: ${errorMsg}`,
          };
        }
        return {
          title: "Agentic Search Error",
          metadata: { error: errorMsg },
          output: `Search failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Version Tool
// =============================================================================

const MemoryVersionParams = z.object({
  action: z.enum(["history", "rollback"])
    .describe("Version action"),
  memoryId: z.string()
    .describe("Memory ID (stable across versions)"),
  targetVersion: z.number().optional()
    .describe("Target version number for rollback"),
});

export const memoryVersionTool: ToolDefinition = {
  id: "zee:memory-version",
  category: "domain",
  init: async () => ({
    description: `View version history or rollback a memory. Actions: history (show all versions), rollback (revert to specific version).`,
    parameters: MemoryVersionParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, memoryId, targetVersion } = args;

      ctx.metadata({ title: `Memory Version: ${action}` });

      try {
        const store = getMemory();

        if (action === "history") {
          const history = await store.getMemoryHistory(memoryId);
          if (history.length === 0) {
            return {
              title: "No History",
              metadata: { action, memoryId, count: 0 },
              output: `No versions found for memoryId: ${memoryId}`,
            };
          }

          const list = history.map((e) => {
            const status = e.superseded ? "[superseded]" : "[current]";
            const date = new Date(e.createdAt).toLocaleString();
            const preview = e.content.substring(0, 100);
            const ellipsis = e.content.length > 100 ? "..." : "";
            return `v${e.version ?? 1} ${status} (${date})
   "${preview}${ellipsis}"
   ID: ${e.id}`;
          }).join("\n\n");

          return {
            title: `${history.length} Versions`,
            metadata: { action, memoryId, count: history.length },
            output: `Version history for ${memoryId}:\n\n${list}`,
          };
        }

        if (action === "rollback") {
          if (targetVersion === undefined) {
            return {
              title: "Missing Target",
              metadata: { action, memoryId, error: "missing_target" },
              output: "Provide 'targetVersion' for rollback.",
            };
          }

          const result = await store.rollbackMemory(memoryId, targetVersion);
          if (!result) {
            return {
              title: "Rollback Failed",
              metadata: { action, memoryId, targetVersion },
              output: `Could not rollback. Either memoryId "${memoryId}" not found or version ${targetVersion} does not exist.`,
            };
          }

          return {
            title: `Rolled Back to v${targetVersion}`,
            metadata: { action, memoryId, targetVersion, restoredId: result.id },
            output: `Memory ${memoryId} rolled back to version ${targetVersion}.

Current content: "${result.content.substring(0, 150)}${result.content.length > 150 ? "..." : ""}"`,
          };
        }

        return {
          title: "Unknown Action",
          metadata: { action },
          output: `Unknown version action: ${action}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Memory Unavailable",
            metadata: { error: "connection_failed" },
            output: `Could not connect to memory storage (Qdrant). Error: ${errorMsg}`,
          };
        }
        return {
          title: "Version Error",
          metadata: { error: errorMsg },
          output: `Version operation failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Entity Pages Tool
// =============================================================================

const MemoryEntitiesParams = z.object({
  action: z.enum(["generate", "list", "read"])
    .describe("Entity pages action: generate (create/update pages), list (show all entities), read (read a page)"),
  entity: z.string().optional()
    .describe("Entity name for generate (specific) or read action"),
});

export const memoryEntitiesTool: ToolDefinition = {
  id: "zee:memory-entities",
  category: "domain",
  init: async () => ({
    description: `Manage auto-generated entity pages. Generate creates Markdown pages from entity-tagged memories. List shows known entities. Read returns an entity page.`,
    parameters: MemoryEntitiesParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, entity } = args;

      ctx.metadata({ title: `Entities: ${action}` });

      try {
        const store = getMemory();

        if (action === "list") {
          const { discoverEntities } = await import("../../memory/entity-pages.js");
          const entities = await discoverEntities(store, "zee");
          if (entities.length === 0) {
            return {
              title: "No Entities",
              metadata: { action, count: 0 },
              output: "No entities found in memory. Store memories with metadata.entities to create entity pages.",
            };
          }
          return {
            title: `${entities.length} Entities`,
            metadata: { action, count: entities.length },
            output: `Known entities:\n\n${entities.map((e) => `- ${e}`).join("\n")}`,
          };
        }

        if (action === "read") {
          if (!entity) {
            return {
              title: "Missing Entity",
              metadata: { action, error: "missing_entity" },
              output: "Provide 'entity' name to read.",
            };
          }
          const { getMarkdownSync } = await import("../../memory/markdown-sync.js");
          const mdSync = getMarkdownSync();
          const content = mdSync.readEntityPage(entity);
          if (!content) {
            return {
              title: "Page Not Found",
              metadata: { action, entity },
              output: `No entity page found for "${entity}". Use action "generate" to create one.`,
            };
          }
          return {
            title: `Entity: ${entity}`,
            metadata: { action, entity },
            output: content,
          };
        }

        if (action === "generate") {
          const { generateEntityPages } = await import("../../memory/entity-pages.js");
          const results = await generateEntityPages(store, {
            entities: entity ? [entity] : undefined,
            namespace: "zee",
          });

          if (results.length === 0) {
            return {
              title: "No Pages Generated",
              metadata: { action, count: 0 },
              output: entity
                ? `No memories found for entity "${entity}".`
                : "No entities with enough data to generate pages.",
            };
          }

          const list = results.map((r) => `- ${r.entityName}: ${r.factCount} facts -> ${r.filePath}`).join("\n");
          return {
            title: `${results.length} Pages Generated`,
            metadata: { action, count: results.length },
            output: `Generated entity pages:\n\n${list}`,
          };
        }

        return {
          title: "Unknown Action",
          metadata: { action },
          output: `Unknown entities action: ${action}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Entity Pages Error",
          metadata: { error: errorMsg },
          output: `Entity pages operation failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Temporal Query Tool
// =============================================================================

const MemoryTemporalParams = z.object({
  since: z.string().optional()
    .describe("Start of time range. Relative: '30d', '2w', '6h', '90m'. Absolute: ISO date string. Default: 30 days ago."),
  until: z.string().optional()
    .describe("End of time range. Same format as 'since'. Default: now."),
  entity: z.string().optional()
    .describe("Filter by entity name (matches metadata.entities array)"),
  category: z.enum(["conversation", "fact", "preference", "task", "decision", "note", "all"])
    .optional().describe("Filter by category"),
  domain: z.string().optional()
    .describe("Filter by domain"),
  topic: z.string().optional()
    .describe("Filter by topic"),
  query: z.string().optional()
    .describe("Optional semantic query to refine results within time range"),
  minConfidence: z.number().min(0).max(1).optional()
    .describe("Minimum confidence filter for belief entries"),
  limit: z.number().default(20)
    .describe("Maximum results (default 20)"),
});

/** Parse relative time strings like '30d', '2w', '6h', '90m' to milliseconds offset */
function parseRelativeTime(input: string): number | null {
  const match = input.match(/^(\d+)(m|h|d|w)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] ?? 0);
}

/** Resolve a time parameter to a unix timestamp */
function resolveTimeParam(input: string | undefined, defaultMs: number): number {
  if (!input) return defaultMs;
  const relativeMs = parseRelativeTime(input);
  if (relativeMs !== null) {
    return Date.now() - relativeMs;
  }
  const parsed = new Date(input).getTime();
  if (isNaN(parsed)) return defaultMs;
  return parsed;
}

export const memoryTemporalTool: ToolDefinition = {
  id: "zee:memory-temporal",
  category: "domain",
  init: async () => ({
    description: `Query memories by time range with optional filters. Use relative times like '30d' (30 days), '2w' (2 weeks), '6h' (6 hours), '90m' (90 minutes) or ISO dates. Combine with entity, category, domain, and semantic query filters.`,
    parameters: MemoryTemporalParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { since, until, entity, category, domain, topic, query, minConfidence, limit } = args;

      const now = Date.now();
      const sinceMs = resolveTimeParam(since, now - 30 * 24 * 60 * 60 * 1000); // default 30d
      const untilMs = resolveTimeParam(until, now);

      const sinceLabel = since ?? "30d ago";
      const untilLabel = until ?? "now";
      ctx.metadata({ title: `Temporal: ${sinceLabel} to ${untilLabel}` });

      try {
        const store = getMemory();

        if (query) {
          // Semantic search with time range filter
          const results = await store.search({
            query,
            namespace: "zee",
            limit: limit ?? 20,
            threshold: 0.3,
            category: category && category !== "all" ? category as any : undefined,
            domain,
            topic,
            timeRange: { start: sinceMs, end: untilMs },
            minConfidence,
          });

          // Post-filter by entity if specified
          const filtered = entity
            ? results.filter((r) => {
                const entities = r.entry.metadata?.entities ?? [];
                return entities.some((e) =>
                  e.toLowerCase().includes(entity.toLowerCase()),
                );
              })
            : results;

          if (filtered.length === 0) {
            return {
              title: "No Temporal Results",
              metadata: { since: sinceLabel, until: untilLabel, count: 0 },
              output: `No memories found between ${sinceLabel} and ${untilLabel}${entity ? ` for entity "${entity}"` : ""}.`,
            };
          }

          const list = filtered.map((r, i) => {
            const e = r.entry;
            const date = new Date(e.createdAt).toLocaleString();
            const preview = e.content.substring(0, 150);
            const ellipsis = e.content.length > 150 ? "..." : "";
            const score = (r.score * 100).toFixed(0);
            const conf = e.confidence !== undefined ? ` [${(e.confidence * 100).toFixed(0)}% conf]` : "";
            return `${i + 1}. [${e.category}] (${score}% match, ${date})${conf}
   "${preview}${ellipsis}"
   ID: ${e.id}`;
          }).join("\n\n");

          return {
            title: `${filtered.length} Temporal Results`,
            metadata: { since: sinceLabel, until: untilLabel, count: filtered.length },
            output: `Memories from ${sinceLabel} to ${untilLabel}${entity ? ` about "${entity}"` : ""}:\n\n${list}`,
          };
        }

        // No semantic query: use agentic search with time-based scroll
        // Build filter for Qdrant scroll
        const results = await store.agenticSearch({
          domain: domain ?? "*",
          topic,
          namespace: "zee",
          limit: limit ?? 20,
        });

        // Post-filter by time range and entity
        const filtered = results.filter((r) => {
          const t = r.entry.createdAt;
          if (t < sinceMs || t > untilMs) return false;
          if (entity) {
            const entities = r.entry.metadata?.entities ?? [];
            if (!entities.some((e) => e.toLowerCase().includes(entity.toLowerCase()))) return false;
          }
          if (category && category !== "all" && r.entry.category !== category) return false;
          if (minConfidence !== undefined && (r.entry.confidence ?? 1) < minConfidence) return false;
          return true;
        });

        if (filtered.length === 0) {
          return {
            title: "No Temporal Results",
            metadata: { since: sinceLabel, until: untilLabel, count: 0 },
            output: `No memories found between ${sinceLabel} and ${untilLabel}${entity ? ` for entity "${entity}"` : ""}.`,
          };
        }

        const list = filtered.map((r, i) => {
          const e = r.entry;
          const date = new Date(e.createdAt).toLocaleString();
          const preview = e.content.substring(0, 150);
          const ellipsis = e.content.length > 150 ? "..." : "";
          const conf = e.confidence !== undefined ? ` [${(e.confidence * 100).toFixed(0)}% conf]` : "";
          return `${i + 1}. [${e.category}] (${date})${conf}
   "${preview}${ellipsis}"
   ID: ${e.id}`;
        }).join("\n\n");

        return {
          title: `${filtered.length} Temporal Results`,
          metadata: { since: sinceLabel, until: untilLabel, count: filtered.length },
          output: `Memories from ${sinceLabel} to ${untilLabel}${entity ? ` about "${entity}"` : ""}:\n\n${list}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Memory Unavailable",
            metadata: { error: "connection_failed" },
            output: `Could not connect to memory storage (Qdrant). Error: ${errorMsg}`,
          };
        }
        return {
          title: "Temporal Query Error",
          metadata: { error: errorMsg },
          output: `Temporal query failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Belief Tool (Opinion Confidence)
// =============================================================================

const MemoryBeliefParams = z.object({
  action: z.enum(["reinforce", "challenge", "status"])
    .describe("Belief action: reinforce (add supporting evidence), challenge (add contradicting evidence), status (view confidence)"),
  id: z.string()
    .describe("Memory entry ID to update"),
  evidence: z.string().optional()
    .describe("Evidence text (required for reinforce/challenge)"),
  strength: z.number().min(0.01).max(0.5).optional()
    .describe("How much to adjust confidence (default: 0.1 for reinforce, 0.15 for challenge)"),
});

export const memoryBeliefTool: ToolDefinition = {
  id: "zee:memory-belief",
  category: "domain",
  init: async () => ({
    description: `Manage belief confidence on memory entries. Use reinforce to increase confidence with supporting evidence, challenge to decrease with contradicting evidence, or status to view current confidence and evidence.`,
    parameters: MemoryBeliefParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, id, evidence, strength } = args;

      ctx.metadata({ title: `Belief: ${action}` });

      try {
        const store = getMemory();

        if (action === "status") {
          const entry = await store.get(id);
          if (!entry) {
            return {
              title: "Not Found",
              metadata: { action, id },
              output: `Memory entry not found: ${id}`,
            };
          }

          const conf = entry.confidence;
          const forList = (entry.evidenceFor ?? []).map((e, i) => `  ${i + 1}. ${e}`).join("\n");
          const againstList = (entry.evidenceAgainst ?? []).map((e, i) => `  ${i + 1}. ${e}`).join("\n");
          const lastChallenged = entry.lastChallenged
            ? new Date(entry.lastChallenged).toLocaleString()
            : "never";

          return {
            title: `Belief: ${conf !== undefined ? `${(conf * 100).toFixed(0)}%` : "no confidence set"}`,
            metadata: { action, id, confidence: conf },
            output: `Memory: "${entry.content.substring(0, 100)}${entry.content.length > 100 ? "..." : ""}"

Confidence: ${conf !== undefined ? `${(conf * 100).toFixed(0)}%` : "not tracked"}
Last challenged: ${lastChallenged}

Evidence FOR (${(entry.evidenceFor ?? []).length}):
${forList || "  (none)"}

Evidence AGAINST (${(entry.evidenceAgainst ?? []).length}):
${againstList || "  (none)"}`,
          };
        }

        if (!evidence) {
          return {
            title: "Missing Evidence",
            metadata: { action, id, error: "missing_evidence" },
            output: `Provide 'evidence' text for ${action} action.`,
          };
        }

        if (action === "reinforce") {
          const result = await store.reinforceBelief(id, evidence, strength ?? 0.1);
          if (!result) {
            return {
              title: "Reinforce Failed",
              metadata: { action, id },
              output: `Memory entry not found: ${id}`,
            };
          }
          return {
            title: `Reinforced to ${(result.confidence! * 100).toFixed(0)}%`,
            metadata: { action, id, confidence: result.confidence },
            output: `Belief reinforced: ${(result.confidence! * 100).toFixed(0)}% confidence
Evidence added: "${evidence}"
Total supporting evidence: ${(result.evidenceFor ?? []).length}`,
          };
        }

        if (action === "challenge") {
          const result = await store.challengeBelief(id, evidence, strength ?? 0.15);
          if (!result) {
            return {
              title: "Challenge Failed",
              metadata: { action, id },
              output: `Memory entry not found: ${id}`,
            };
          }
          return {
            title: `Challenged to ${(result.confidence! * 100).toFixed(0)}%`,
            metadata: { action, id, confidence: result.confidence },
            output: `Belief challenged: ${(result.confidence! * 100).toFixed(0)}% confidence
Evidence added: "${evidence}"
Total contradicting evidence: ${(result.evidenceAgainst ?? []).length}`,
          };
        }

        return {
          title: "Unknown Action",
          metadata: { action },
          output: `Unknown belief action: ${action}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Belief Error",
          metadata: { error: errorMsg },
          output: `Belief operation failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Memory Reflect Tool
// =============================================================================

const MemoryReflectParams = z.object({
  namespace: z.string().optional()
    .describe("Namespace to reflect on (default: zee)"),
  duplicateThreshold: z.number().min(0.5).max(1).optional()
    .describe("Similarity threshold for duplicate detection (default: 0.92)"),
  staleDays: z.number().optional()
    .describe("Days without challenge before a belief decays (default: 30)"),
  scanLimit: z.number().optional()
    .describe("Max entries to scan per run (default: 200)"),
  updateEntityPages: z.boolean().optional()
    .describe("Whether to regenerate entity pages (default: true)"),
});

export const memoryReflectTool: ToolDefinition = {
  id: "zee:memory-reflect",
  category: "domain",
  init: async () => ({
    description: `Run the memory reflect job: deduplicates similar facts, decays stale beliefs, and regenerates entity pages. Designed for scheduled curation but can be run on-demand.`,
    parameters: MemoryReflectParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: "Memory Reflect" });

      try {
        const store = getMemory();
        const { runReflect } = await import("../../memory/reflect.js");

        const result = await runReflect(store, {
          namespace: args.namespace,
          duplicateThreshold: args.duplicateThreshold,
          staleDays: args.staleDays,
          scanLimit: args.scanLimit,
          updateEntityPages: args.updateEntityPages,
        });

        return {
          title: `Reflect Complete (${result.durationMs}ms)`,
          metadata: result,
          output: `Memory reflect completed in ${result.durationMs}ms:

- Duplicates merged: ${result.duplicatesMerged}
- Stale beliefs found: ${result.staleBeliefs}
- Beliefs decayed: ${result.beliefsDecayed}
- Entity pages updated: ${result.entityPagesUpdated}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: "Reflect Error",
          metadata: { error: errorMsg },
          output: `Reflect job failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Plan Tools (Proactive Planning Loop)
// =============================================================================

import {
  createPlan,
  advancePlan,
  failStep,
  getPlan,
  listPlans,
  abandonPlan,
  formatPlan,
} from "../../swarm/planner.js";

const PlanCreateParams = z.object({
  objective: z.string().describe("What the plan aims to achieve"),
  steps: z.array(z.string()).min(1).max(20)
    .describe("Ordered list of step descriptions"),
  persona: z.enum(["zee", "stanley", "johny"]).optional()
    .describe("Persona owning this plan (default: current persona)"),
});

export const planCreateTool: ToolDefinition = {
  id: "zee:plan-create",
  category: "domain",
  init: async () => ({
    description: `Create a multi-step plan for complex requests. Plans persist in memory and can be resumed across sessions.`,
    parameters: PlanCreateParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const persona = args.persona ?? (ctx.extra?.persona as string) ?? "zee";
      const sessionId = ctx.extra?.sessionId as string | undefined;

      ctx.metadata({ title: `Creating plan: ${args.objective.slice(0, 40)}...` });

      try {
        const plan = await createPlan(persona, args.objective, args.steps, sessionId);

        // Auto-start the first step
        const advanced = await advancePlan(plan.id);

        return {
          title: `Plan Created`,
          metadata: { planId: plan.id, steps: plan.steps.length },
          output: `${formatPlan(advanced.plan)}

Next: Work on step 1, then call zee:plan-advance with planId "${plan.id}" and the result.`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: `Plan Creation Failed`,
          metadata: { error: errorMsg },
          output: `Failed to create plan: ${errorMsg}`,
        };
      }
    },
  }),
};

const PlanAdvanceParams = z.object({
  planId: z.string().describe("Plan ID to advance"),
  result: z.string().optional().describe("Result/output from the completed step"),
  failed: z.boolean().optional().describe("Set true if the step failed"),
  error: z.string().optional().describe("Error description if step failed"),
});

export const planAdvanceTool: ToolDefinition = {
  id: "zee:plan-advance",
  category: "domain",
  init: async () => ({
    description: `Advance a plan by completing the current step. Record result and move to next step. Set failed=true with error if step failed.`,
    parameters: PlanAdvanceParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Advancing plan` });

      try {
        if (args.failed) {
          const plan = await failStep(args.planId, args.error ?? "Step failed");
          return {
            title: `Step Failed`,
            metadata: { planId: args.planId },
            output: `${formatPlan(plan)}

Step marked as failed. You can retry or move on to the next step.`,
          };
        }

        const { plan, nextStep, completed } = await advancePlan(args.planId, args.result);

        if (completed) {
          return {
            title: `Plan Completed`,
            metadata: { planId: args.planId, completed: true },
            output: `${formatPlan(plan)}

All steps completed. Summarize the results to the user.`,
          };
        }

        return {
          title: `Step Completed`,
          metadata: { planId: args.planId, nextStep: nextStep?.description },
          output: `${formatPlan(plan)}

Next: ${nextStep?.description ?? "No more steps"}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: `Plan Advance Failed`,
          metadata: { error: errorMsg },
          output: `Failed to advance plan: ${errorMsg}`,
        };
      }
    },
  }),
};

const PlanStatusParams = z.object({
  planId: z.string().optional().describe("Specific plan ID to check"),
  persona: z.enum(["zee", "stanley", "johny"]).optional()
    .describe("List plans for a persona"),
  status: z.enum(["active", "completed", "abandoned"]).optional()
    .describe("Filter by plan status"),
});

export const planStatusTool: ToolDefinition = {
  id: "zee:plan-status",
  category: "domain",
  init: async () => ({
    description: `Check plan status. View a specific plan by planId or list all plans for a persona filtered by status.`,
    parameters: PlanStatusParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Plan status` });

      try {
        if (args.planId) {
          const plan = await getPlan(args.planId);
          if (!plan) {
            return {
              title: `Plan Not Found`,
              metadata: { planId: args.planId },
              output: `No plan found with ID: ${args.planId}`,
            };
          }
          return {
            title: `Plan: ${plan.objective.slice(0, 40)}`,
            metadata: { planId: plan.id, status: plan.status },
            output: formatPlan(plan),
          };
        }

        const persona = args.persona ?? (ctx.extra?.persona as string) ?? "zee";
        const plans = await listPlans(persona, { status: args.status });

        if (plans.length === 0) {
          return {
            title: `No Plans`,
            metadata: { persona, status: args.status },
            output: `No ${args.status ?? ""} plans found for ${persona}.`,
          };
        }

        const list = plans.map((p) => formatPlan(p)).join("\n\n---\n\n");
        return {
          title: `${plans.length} Plans`,
          metadata: { persona, count: plans.length },
          output: list,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: `Plan Status Error`,
          metadata: { error: errorMsg },
          output: `Failed to get plan status: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const ZEE_TOOLS = [
  memoryStoreTool,
  memorySearchTool,
  memoryBrowseTool,
  memoryAgenticSearchTool,
  memoryVersionTool,
  memoryEntitiesTool,
  memoryTemporalTool,
  memoryBeliefTool,
  memoryReflectTool,
  messagingTool,
  notificationTool,
  calendarTool,
  contactsTool,
  splitwiseTool,
  codexbarTool,
  whatsappReactionTool,
  reminderStatusTool,
  bannerRefreshTool,
  bannerPushTool,
  planCreateTool,
  planAdvanceTool,
  planStatusTool,
  ...CLAUDE_CODE_TOOLS,
  ...RESTART_SENTINEL_TOOLS,
  ...CRON_TOOLS,
  ...PTY_SESSION_TOOLS,
  ...ZEE_BROWSER_TOOLS,
  ...ZEE_STANDALONE_BROWSER_TOOLS,
  ...WHATSAPP_TOOLS,
];

export function registerZeeTools(registry: { register: (tool: ToolDefinition, options: { source: string }) => void }): void {
  for (const tool of ZEE_TOOLS) {
    registry.register(tool, { source: "domain" });
  }
}

export { registerZeeTools as registerZeeDomainTools };
