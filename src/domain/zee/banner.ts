/**
 * Zee Banner Tools
 *
 * Maintains an always-on rotating banner in the zee TUI.
 * The banner is global (Zee-owned) and is shown even when using other personas.
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import { getTodayEvents, checkCredentialsExist, type CalendarEvent } from "./google/calendar.js";
import { getMemory } from "../../memory/unified.js";
import { Global } from "../../../packages/zee/src/global/index.js";
import { Storage } from "../../../packages/zee/src/storage/storage.js";
import path from "path";
import fs from "fs/promises";

type BannerItemKind = "reminder" | "todo" | "message";
type BannerItemPriority = "low" | "normal" | "high" | "urgent";

export interface ZeeBannerItem {
  id: string;
  kind: BannerItemKind;
  text: string;
  priority: BannerItemPriority;
  createdAt: number;
  expiresAt?: number;
}

export interface ZeeBannerV1 {
  version: 1;
  generatedAt: number;
  rotationMs: number;
  items: ZeeBannerItem[];
}

const DEFAULT_ROTATION_MS = 8000;
const DEFAULT_MESSAGE_TTL_MINUTES = 60 * 24;
const MAX_TOTAL_ITEMS = 24;
const MAX_MESSAGE_ITEMS = 12;
const MAX_REMINDER_ITEMS = 6;
const MAX_TODO_ITEMS = 6;

const BannerRefreshParams = z.object({
  autoSave: z.boolean().default(false).describe("Write the banner to KV store for TUI display"),
  setupCron: z.boolean().default(false).describe("Create a cron job to auto-refresh the banner"),
  rotationMs: z.number().int().min(1000).max(60000).default(DEFAULT_ROTATION_MS).describe("Client-side rotation interval"),
});

const BannerPushParams = z.object({
  message: z.string().min(1).describe("Message to show in the banner"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal").describe("Message priority"),
  ttlMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 14)
    .default(DEFAULT_MESSAGE_TTL_MINUTES)
    .describe("How long the message stays in the banner (minutes)"),
});

function sanitizeOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isExpired(item: ZeeBannerItem, nowMs: number): boolean {
  return typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) && item.expiresAt <= nowMs;
}

function normalizeBannerItem(raw: unknown): ZeeBannerItem | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const kind = x.kind;
  const text = x.text;
  const id = x.id;
  const priority = x.priority;
  const createdAt = x.createdAt;
  const expiresAt = x.expiresAt;

  if (kind !== "reminder" && kind !== "todo" && kind !== "message") return null;
  if (typeof text !== "string" || !text.trim()) return null;
  if (typeof id !== "string" || !id) return null;
  if (priority !== "low" && priority !== "normal" && priority !== "high" && priority !== "urgent") return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (expiresAt !== undefined && (typeof expiresAt !== "number" || !Number.isFinite(expiresAt))) return null;

  return {
    id,
    kind,
    text: sanitizeOneLine(text),
    priority,
    createdAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

function normalizeBanner(raw: unknown): ZeeBannerV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  if (x.version !== 1) return null;
  const generatedAt = x.generatedAt;
  const rotationMs = x.rotationMs;
  const items = x.items;

  if (typeof generatedAt !== "number" || !Number.isFinite(generatedAt)) return null;
  if (typeof rotationMs !== "number" || !Number.isFinite(rotationMs) || rotationMs <= 0) return null;
  if (!Array.isArray(items)) return null;

  const normalizedItems = items.map(normalizeBannerItem).filter((i): i is ZeeBannerItem => i !== null);
  return { version: 1, generatedAt, rotationMs, items: normalizedItems };
}

async function loadKV(): Promise<Record<string, unknown>> {
  const kvPath = path.join(Global.Path.state, "kv.json");
  try {
    const content = await fs.readFile(kvPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Ignore missing/invalid file
  }
  return {};
}

async function saveKV(kv: Record<string, unknown>): Promise<void> {
  const kvPath = path.join(Global.Path.state, "kv.json");
  await fs.mkdir(Global.Path.state, { recursive: true });
  await fs.writeFile(kvPath, JSON.stringify(kv, null, 2));
}

function getEventTime(event: CalendarEvent): Date | undefined {
  if (event.start.dateTime) return new Date(event.start.dateTime);
  if (event.start.date) return new Date(event.start.date);
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

function uniq(items: ZeeBannerItem[]): ZeeBannerItem[] {
  const seen = new Set<string>();
  const result: ZeeBannerItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function createBannerRefreshCronJob(): Promise<ToolExecutionResult> {
  const gatewayHttpUrl =
    process.env.ZEE_GATEWAY_URL ||
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
          name: "zee-banner-refresh",
          description: "Auto-refresh Zee banner for zee TUI",
          enabled: true,
          schedule: { kind: "every", everyMs: 900000 },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: {
            kind: "agentTurn",
            message: "Run zee:banner-refresh with autoSave=true",
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        title: "Cron Setup Failed",
        metadata: { error: "http_error", status: response.status },
        output: `Failed to create cron job: ${response.status} ${text}`,
      };
    }

    const json = (await response.json()) as any;
    if (json?.error) {
      return {
        title: "Cron Setup Failed",
        metadata: { error: json.error?.message ?? "rpc_error" },
        output: `Failed to create cron job: ${json.error?.message ?? "RPC error"}`,
      };
    }

    return {
      title: "Cron Setup Complete",
      metadata: { jobId: json?.result?.id },
      output: `Created cron job "zee-banner-refresh" to refresh the banner every 15 minutes.`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      title: "Cron Setup Error",
      metadata: { error: errorMsg },
      output: `Failed to create cron job: ${errorMsg}`,
    };
  }
}

async function getReminderItems(now: Date): Promise<{ items: ZeeBannerItem[]; calendarError?: string }> {
  const nowMs = now.getTime();
  const reminders: ZeeBannerItem[] = [];
  let calendarError: string | undefined;

  const hasCredentials = await checkCredentialsExist();
  if (hasCredentials) {
    try {
      const events = await getTodayEvents();
      const upcoming = events
        .map((e) => ({ event: e, time: getEventTime(e) }))
        .filter((x) => x.time && x.time.getTime() >= nowMs - 60 * 60 * 1000)
        .toSorted((a, b) => (a.time!.getTime() - b.time!.getTime()));

      for (const { event, time } of upcoming.slice(0, MAX_REMINDER_ITEMS)) {
        const title = sanitizeOneLine(event.summary || "(No title)");
        const minutesUntil = (time!.getTime() - nowMs) / (1000 * 60);
        const timeStr = formatTimeUntil(minutesUntil);
        const suffix = timeStr === "now" ? "now" : `in ${timeStr}`;
        reminders.push({
          id: uid("rem"),
          kind: "reminder",
          priority: "normal",
          createdAt: nowMs,
          text: `Calendar: ${title} ${suffix}`,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes("401") || errorMsg.includes("invalid_grant")) calendarError = "calendar auth error";
      else calendarError = "calendar unavailable";
    }
  }

  try {
    const store = getMemory();
    const memoryResults = await store.search({
      query: "reminder task due today upcoming",
      limit: 20,
      threshold: 0.5,
      category: "task",
    });

    for (const result of memoryResults) {
      if (reminders.length >= MAX_REMINDER_ITEMS) break;
      const content = result.entry.content.toLowerCase();
      const hasTimeIndicator = /\b(today|tomorrow|at \d|due|by \d|in \d+ (min|hour))\b/.test(content);
      if (!hasTimeIndicator) continue;
      reminders.push({
        id: uid("rem-mem"),
        kind: "reminder",
        priority: "normal",
        createdAt: nowMs,
        text: `Reminder: ${sanitizeOneLine(result.entry.content.split("\n")[0] ?? "").slice(0, 80)}`,
      });
    }
  } catch {
    // Memory errors are non-fatal
  }

  return { items: reminders, ...(calendarError ? { calendarError } : {}) };
}

async function getTodoItems(now: Date): Promise<{ totalOpen: number; items: ZeeBannerItem[] }> {
  const nowMs = now.getTime();
  const inProgress: string[] = [];
  const pending: string[] = [];
  let totalOpen = 0;

  try {
    const todoKeys = await Storage.list(["todo"]);
    for (const key of todoKeys) {
      const sessionID = key.at(1);
      if (!sessionID) continue;

      const todos = await Storage.read<any>(["todo", sessionID]).catch(() => []);
      if (!Array.isArray(todos)) continue;

      for (const todo of todos) {
        if (!todo || typeof todo !== "object") continue;
        const status = (todo as any).status;
        const content = (todo as any).content;
        if (typeof content !== "string" || !content.trim()) continue;
        if (status === "completed" || status === "cancelled") continue;
        totalOpen++;
        if (status === "in_progress") inProgress.push(content);
        else pending.push(content);
      }
    }
  } catch {
    // No todos / storage not initialized
  }

  const items: ZeeBannerItem[] = [];
  if (totalOpen > 0) {
    items.push({
      id: uid("todo-sum"),
      kind: "todo",
      priority: inProgress.length > 0 ? "high" : "normal",
      createdAt: nowMs,
      text: `Todos: ${totalOpen} open`,
    });
  }

  for (const content of inProgress.slice(0, 2)) {
    if (items.length >= MAX_TODO_ITEMS) break;
    items.push({
      id: uid("todo-ip"),
      kind: "todo",
      priority: "high",
      createdAt: nowMs,
      text: `In progress: ${sanitizeOneLine(content).slice(0, 120)}`,
    });
  }

  for (const content of pending.slice(0, 2)) {
    if (items.length >= MAX_TODO_ITEMS) break;
    items.push({
      id: uid("todo"),
      kind: "todo",
      priority: "normal",
      createdAt: nowMs,
      text: `Next: ${sanitizeOneLine(content).slice(0, 120)}`,
    });
  }

  return { totalOpen, items };
}

export const bannerRefreshTool: ToolDefinition = {
  id: "zee:banner-refresh",
  category: "domain",
  init: async () => ({
    description: `Refresh the Zee banner shown at the top of the zee TUI prompt.

The banner rotates items and is displayed even when using other personas.

Parameters:
- autoSave: Write to KV store for live TUI display (default: false)
- setupCron: Create a cron job to auto-refresh (default: false)
- rotationMs: Client-side rotation interval (default: 8000)`,
    parameters: BannerRefreshParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { autoSave, setupCron, rotationMs } = args;
      const now = new Date();
      const nowMs = now.getTime();

      ctx.metadata({ title: "Banner Refresh" });

      let cronResult: ToolExecutionResult | null = null;
      if (setupCron) {
        cronResult = await createBannerRefreshCronJob();
        if (cronResult.metadata?.error) return cronResult;
      }

      const kv = await loadKV();
      const existing = normalizeBanner(kv.zee_banner);
      const existingMessages = (existing?.items ?? [])
        .filter((i) => i.kind === "message")
        .filter((i) => !isExpired(i, nowMs))
        .slice(0, MAX_MESSAGE_ITEMS);

      const { items: reminderItems, calendarError } = await getReminderItems(now);
      const { totalOpen, items: todoItems } = await getTodoItems(now);

      const combined = uniq([
        ...reminderItems,
        ...todoItems,
        ...existingMessages,
      ])
        .slice(0, MAX_TOTAL_ITEMS);

      const banner: ZeeBannerV1 = {
        version: 1,
        generatedAt: nowMs,
        rotationMs,
        items: combined,
      };

      if (autoSave) {
        kv.zee_banner = banner;
        await saveKV(kv);
      }

      let output = `Banner items: ${banner.items.length}`;
      if (reminderItems.length > 0) output += `\nReminders: ${reminderItems.length}`;
      if (totalOpen > 0) output += `\nTodos open: ${totalOpen}`;
      if (existingMessages.length > 0) output += `\nMessages: ${existingMessages.length}`;
      if (calendarError) output += `\nCalendar: ${calendarError}`;
      if (autoSave) output += `\n\n[Saved to KV store: zee_banner]`;
      if (cronResult) output += `\n\n${cronResult.output}`;

      return {
        title: "Banner Refreshed",
        metadata: {
          autoSave,
          setupCron,
          rotationMs,
          counts: {
            reminders: reminderItems.length,
            todosOpen: totalOpen,
            messages: existingMessages.length,
            totalItems: banner.items.length,
          },
          calendarError,
          cronJobId: cronResult?.metadata?.jobId,
        },
        output,
      };
    },
  }),
};

export const bannerPushTool: ToolDefinition = {
  id: "zee:banner-push",
  category: "domain",
  init: async () => ({
    description: `Push a message into the Zee banner shown in zee TUI.

Messages are not dismissible in the UI; they expire after ttlMinutes (default: 24h).`,
    parameters: BannerPushParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { message, priority, ttlMinutes } = args;
      const nowMs = Date.now();
      ctx.metadata({ title: "Banner Push" });

      const kv = await loadKV();
      const existing = normalizeBanner(kv.zee_banner);
      const existingItems = (existing?.items ?? []).filter((i) => !isExpired(i, nowMs));
      const nonMessages = existingItems.filter((i) => i.kind !== "message");
      const messages = existingItems
        .filter((i) => i.kind === "message")
        .slice(0, MAX_MESSAGE_ITEMS);

      const item: ZeeBannerItem = {
        id: uid("msg"),
        kind: "message",
        priority,
        createdAt: nowMs,
        expiresAt: nowMs + ttlMinutes * 60 * 1000,
        text: sanitizeOneLine(message),
      };

      const nextMessages = [item, ...messages].slice(0, MAX_MESSAGE_ITEMS);
      const rotationMs =
        existing?.rotationMs && Number.isFinite(existing.rotationMs) && existing.rotationMs > 0
          ? existing.rotationMs
          : DEFAULT_ROTATION_MS;

      const banner: ZeeBannerV1 = {
        version: 1,
        generatedAt: nowMs,
        rotationMs,
        items: uniq([...nonMessages, ...nextMessages]).slice(0, MAX_TOTAL_ITEMS),
      };

      kv.zee_banner = banner;
      await saveKV(kv);

      return {
        title: "Banner Message Added",
        metadata: {
          priority,
          ttlMinutes,
          expiresAt: item.expiresAt,
          itemId: item.id,
          totalItems: banner.items.length,
        },
        output: `Added message to banner: "${item.text.substring(0, 120)}${item.text.length > 120 ? "..." : ""}"

[Saved to KV store: zee_banner]`,
      };
    },
  }),
};
