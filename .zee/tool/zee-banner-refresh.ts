/**
 * Zee Banner Refresh Tool
 *
 * Refreshes the always-on Zee banner shown at the top of the Zee TUI.
 * Intended to be called by cron (no LLM required).
 */

import { tool } from "@zee/plugin"
import { spawnSync } from "node:child_process"

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

const TODO_RECENCY_WINDOW_DAYS = 7
const TODO_DUE_WINDOW_DAYS = 7
const TODO_AGENDA_ITEMS = Math.min(MAX_TODO_ITEMS, 3)

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

function parseTaskTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return undefined

  const compactUtc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  if (compactUtc) {
    const year = Number(compactUtc[1])
    const monthIndex = Number(compactUtc[2]) - 1
    const day = Number(compactUtc[3])
    const hour = Number(compactUtc[4])
    const minute = Number(compactUtc[5])
    const second = Number(compactUtc[6])
    return Date.UTC(year, monthIndex, day, hour, minute, second)
  }

  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
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

async function getTodoItems(now: Date): Promise<{
  totalOpen: number
  actionableCount: number
  filteredStaleCount: number
  items: ZeeBannerItem[]
}> {
  const nowMs = now.getTime()
  const recentCutoffMs = nowMs - TODO_RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const dueCutoffMs = nowMs + TODO_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const result = spawnSync(
    process.env.ZEE_TASKMASTER_COMMAND || "task",
    ["rc.verbose=nothing", "rc.recurrence=0", "status:pending", "or", "status:waiting", "export"],
    {
      encoding: "utf-8",
      timeout: 5000,
    },
  )
  if (result.error || result.status !== 0 || !result.stdout) {
    return { totalOpen: 0, actionableCount: 0, filteredStaleCount: 0, items: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { totalOpen: 0, actionableCount: 0, filteredStaleCount: 0, items: [] }
  }
  if (!Array.isArray(parsed)) return { totalOpen: 0, actionableCount: 0, filteredStaleCount: 0, items: [] }

  const inProgress: Array<{ description: string; urgency: number }> = []
  const dueSoon: Array<{ description: string; urgency: number; dueAt: number }> = []
  const pending: Array<{ description: string; urgency: number }> = []
  const seen = new Set<string>()
  let totalOpen = 0
  let filteredStaleCount = 0

  for (const row of parsed) {
    if (!row || typeof row !== "object") continue
    const task = row as Record<string, unknown>
    const description = typeof task.description === "string" ? sanitizeOneLine(task.description) : ""
    if (!description) continue

    const status = task.status
    if (status !== "pending" && status !== "waiting") continue
    const urgency = typeof task.urgency === "number" && Number.isFinite(task.urgency) ? task.urgency : 0
    const dueAt = parseTaskTimestamp(task.due)
    const waitAt = parseTaskTimestamp(task.wait)
    const recencyAt = parseTaskTimestamp(task.modified) ?? parseTaskTimestamp(task.entry)
    const isInProgress = typeof task.start === "string" && task.start.trim().length > 0

    const project = typeof task.project === "string" ? sanitizeOneLine(task.project) : ""
    const key = `${project}:${description}`
    if (seen.has(key)) continue
    seen.add(key)

    totalOpen += 1

    if (status === "waiting" && typeof waitAt === "number" && waitAt > nowMs) {
      filteredStaleCount += 1
      continue
    }

    const dueSoonEnough = typeof dueAt === "number" && dueAt <= dueCutoffMs
    const recentEnough = typeof recencyAt === "number" && recencyAt >= recentCutoffMs
    if (!isInProgress && !dueSoonEnough && !recentEnough) {
      filteredStaleCount += 1
      continue
    }

    if (isInProgress) {
      inProgress.push({ description, urgency })
    } else if (dueSoonEnough && typeof dueAt === "number") {
      dueSoon.push({ description, urgency, dueAt })
    } else {
      pending.push({ description, urgency })
    }
  }

  inProgress.sort((a, b) => b.urgency - a.urgency)
  dueSoon.sort((a, b) => {
    if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt
    return b.urgency - a.urgency
  })
  pending.sort((a, b) => b.urgency - a.urgency)
  const actionableCount = inProgress.length + dueSoon.length + pending.length

  const items: ZeeBannerItem[] = []
  if (inProgress.length > 0) {
    items.push({
      id: uid("todo-ip"),
      kind: "todo",
      priority: "high",
      createdAt: nowMs,
      text: `In progress: ${sanitizeOneLine(inProgress[0]!.description).slice(0, 120)}`,
    })
  }

  const nextCandidates = [...dueSoon, ...pending, ...inProgress.slice(1)]
  for (const entry of nextCandidates) {
    if (items.length >= TODO_AGENDA_ITEMS) break
    items.push({
      id: uid("todo"),
      kind: "todo",
      priority: "normal",
      createdAt: nowMs,
      text: `Next: ${sanitizeOneLine(entry.description).slice(0, 120)}`,
    })
  }

  return { totalOpen, actionableCount, filteredStaleCount, items }
}

export default tool({
  description: `Refresh the Zee banner shown at the top of the Zee TUI prompt.

The banner rotates items (reminders, todos, messages) across the unified Zee runtime.`,
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
    const { totalOpen, actionableCount, filteredStaleCount, items: todoItems } = await getTodoItems(now)

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
    if (actionableCount > 0) parts.push(`Todos actionable: ${actionableCount}`)
    if (totalOpen > 0) parts.push(`Todos open: ${totalOpen}`)
    if (filteredStaleCount > 0) parts.push(`Todos filtered: ${filteredStaleCount}`)
    if (existingMessages.length > 0) parts.push(`Messages: ${existingMessages.length}`)
    if (calendarError) parts.push(`Calendar: ${calendarError}`)
    if (autoSave) parts.push("Saved: kv.zee_banner")

    return parts.join("\n")
  },
})
