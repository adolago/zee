/**
 * Zee Banner Refresh Tool
 *
 * Refreshes the always-on Zee banner shown at the top of the Zee TUI.
 * Intended to be called by cron (no LLM required).
 */

import { tool } from "@zee/plugin"

import { Storage } from "../../packages/zee/src/storage/storage"

import {
  DEFAULT_ROTATION_MS,
  MAX_MESSAGE_ITEMS,
  MAX_REMINDER_ITEMS,
  MAX_TODO_ITEMS,
  MAX_TOTAL_ITEMS,
  isExpired,
  loadKV,
  parseExistingBanner,
  sanitizeOneLine,
  saveKV,
  uid,
  uniq,
  type ZeeBannerItem,
  type ZeeBannerV1,
} from "./lib/zee-banner"

async function loadCalendarModule() {
  try {
    return await import("../../src/domain/zee/google/calendar.js")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.includes("Cannot find module") && !errorMsg.includes("ERR_MODULE_NOT_FOUND")) {
      throw error
    }
    return await import("../../src/domain/zee/google/calendar.ts")
  }
}

function getEventTime(event: any): Date | undefined {
  if (event?.start?.dateTime) return new Date(event.start.dateTime)
  if (event?.start?.date) return new Date(event.start.date)
  return undefined
}

function formatTimeUntil(minutes: number): string {
  if (minutes < 1) return "now"
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (mins === 0) return `${hours} hr`
  return `${hours} hr ${mins} min`
}

async function getReminderItems(now: Date): Promise<{ items: ZeeBannerItem[]; calendarError?: string }> {
  const nowMs = now.getTime()
  const reminders: ZeeBannerItem[] = []
  let calendarError: string | undefined

  try {
    const calendar = await loadCalendarModule()
    const hasCredentials = await calendar.checkCredentialsExist()
    if (!hasCredentials) return { items: reminders }

    try {
      const events = await calendar.getTodayEvents()
      const upcoming = (events as any[])
        .map((e) => ({ event: e, time: getEventTime(e) }))
        .filter((x) => x.time && x.time.getTime() >= nowMs - 60 * 60 * 1000)
        .sort((a, b) => a.time!.getTime() - b.time!.getTime())

      for (const { event, time } of upcoming.slice(0, MAX_REMINDER_ITEMS)) {
        const title = sanitizeOneLine(event?.summary || "(No title)")
        const minutesUntil = (time!.getTime() - nowMs) / (1000 * 60)
        const timeStr = formatTimeUntil(minutesUntil)
        const suffix = timeStr === "now" ? "now" : `in ${timeStr}`
        reminders.push({
          id: uid("rem"),
          kind: "reminder",
          priority: "normal",
          createdAt: nowMs,
          text: `Calendar: ${title} ${suffix}`,
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes("401") || errorMsg.includes("invalid_grant")) calendarError = "calendar auth error"
      else calendarError = "calendar unavailable"
    }
  } catch {
    // ignore missing calendar module
  }

  return { items: reminders, ...(calendarError ? { calendarError } : {}) }
}

interface TodoEntry {
  content: string
  sessionID: string
}

async function getTodoItems(now: Date): Promise<{ totalOpen: number; items: ZeeBannerItem[] }> {
  const nowMs = now.getTime()
  const inProgress: TodoEntry[] = []
  const pending: TodoEntry[] = []
  let totalOpen = 0

  try {
    const todoKeys = await Storage.list(["todo"])
    for (const key of todoKeys) {
      const sessionID = key.at(1)
      if (!sessionID) continue

      const todos = await Storage.read<any>(["todo", sessionID]).catch(() => [])
      if (!Array.isArray(todos)) continue

      for (const todo of todos) {
        if (!todo || typeof todo !== "object") continue
        const status = (todo as any).status
        const content = (todo as any).content
        if (typeof content !== "string" || !content.trim()) continue
        if (status === "completed" || status === "cancelled") continue
        totalOpen++
        if (status === "in_progress") inProgress.push({ content, sessionID })
        else pending.push({ content, sessionID })
      }
    }
  } catch {
    // ignore
  }

  const items: ZeeBannerItem[] = []
  if (totalOpen > 0) {
    items.push({
      id: uid("todo-sum"),
      kind: "todo",
      priority: inProgress.length > 0 ? "high" : "normal",
      createdAt: nowMs,
      text: `Todos: ${totalOpen} open`,
    })
  }

  for (const entry of inProgress.slice(0, 2)) {
    if (items.length >= MAX_TODO_ITEMS) break
    items.push({
      id: uid("todo-ip"),
      kind: "todo",
      priority: "high",
      createdAt: nowMs,
      text: `[TODO] In progress: ${sanitizeOneLine(entry.content).slice(0, 120)} (session: ${entry.sessionID})`,
    })
  }

  for (const entry of pending.slice(0, 2)) {
    if (items.length >= MAX_TODO_ITEMS) break
    items.push({
      id: uid("todo"),
      kind: "todo",
      priority: "normal",
      createdAt: nowMs,
      text: `[TODO] Next: ${sanitizeOneLine(entry.content).slice(0, 120)} (session: ${entry.sessionID})`,
    })
  }

  return { totalOpen, items }
}

export default tool({
  description: `Refresh the Zee banner shown at the top of the Zee TUI prompt.

The banner rotates items (reminders, todos, messages) and is shown even when using other personas.`,
  args: {
    autoSave: tool.schema
      .boolean()
      .default(true)
      .describe("Write the banner to KV store for live TUI display"),
    rotationMs: tool.schema
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(DEFAULT_ROTATION_MS)
      .describe("Client-side rotation interval (ms)"),
  },
  async execute(args) {
    const { autoSave, rotationMs } = args
    const now = new Date()
    const nowMs = now.getTime()

    const kv = await loadKV()
    const existing = parseExistingBanner(kv.zee_banner, nowMs)
    const existingMessages = existing.items
      .filter((i) => i.kind === "message")
      .filter((i) => !isExpired(i, nowMs))
      .slice(0, MAX_MESSAGE_ITEMS)

    const { items: reminderItems, calendarError } = await getReminderItems(now)
    const { totalOpen, items: todoItems } = await getTodoItems(now)

    const combined = uniq([...reminderItems, ...todoItems, ...existingMessages]).slice(0, MAX_TOTAL_ITEMS)

    const banner: ZeeBannerV1 = {
      version: 1,
      generatedAt: nowMs,
      rotationMs,
      items: combined,
    }

    if (autoSave) {
      kv.zee_banner = banner
      await saveKV(kv)
    }

    const parts: string[] = []
    parts.push(`Banner refreshed: ${banner.items.length} item(s)`)
    parts.push(`Rotation: ${rotationMs}ms`)
    if (reminderItems.length > 0) parts.push(`Reminders: ${reminderItems.length}`)
    if (totalOpen > 0) parts.push(`Todos open: ${totalOpen}`)
    if (existingMessages.length > 0) parts.push(`Messages: ${existingMessages.length}`)
    if (calendarError) parts.push(`Calendar: ${calendarError}`)
    if (autoSave) parts.push("Saved: kv.zee_banner")

    return parts.join("\n")
  },
})
