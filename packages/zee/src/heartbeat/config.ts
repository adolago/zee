// Heartbeat configuration resolution.

import { DEFAULT_HEARTBEAT_EVERY } from "./heartbeat"

export type HeartbeatConfig = {
  enabled: boolean
  everyMs: number
  prompt?: string
  model?: string
  activeHours?: {
    start: string // "HH:MM"
    end: string // "HH:MM"
    timezone?: string
  }
}

const DURATION_RE = /^(\d+)\s*(ms|s|m|h|d)$/i

function parseDuration(raw: string): number {
  const match = DURATION_RE.exec(raw.trim())
  if (!match) {
    throw new Error(`invalid duration: "${raw}"`)
  }
  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  switch (unit) {
    case "ms":
      return value
    case "s":
      return value * 1000
    case "m":
      return value * 60 * 1000
    case "h":
      return value * 60 * 60 * 1000
    case "d":
      return value * 24 * 60 * 60 * 1000
    default:
      throw new Error(`unknown duration unit: "${unit}"`)
  }
}

export function resolveHeartbeatConfig(raw?: {
  enabled?: boolean
  every?: string
  prompt?: string
  model?: string
  activeHours?: { start: string; end: string; timezone?: string }
}): HeartbeatConfig {
  const enabled = raw?.enabled ?? false
  const everyStr = raw?.every ?? DEFAULT_HEARTBEAT_EVERY
  const everyMs = parseDuration(everyStr)

  return {
    enabled,
    everyMs,
    prompt: raw?.prompt,
    model: raw?.model,
    activeHours: raw?.activeHours,
  }
}

/**
 * Check if the current time is within active hours.
 * Returns true if no active hours are configured.
 */
export function isWithinActiveHours(config: HeartbeatConfig, now: Date = new Date()): boolean {
  if (!config.activeHours) {
    return true
  }

  const { start, end, timezone } = config.activeHours

  const parseTime = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number)
    return h * 60 + m
  }

  const startMinutes = parseTime(start)
  const endMinutes = parseTime(end)

  // Extract wall-clock hour/minute in the configured timezone.
  // Falls back to the daemon's local timezone if none is specified or if the
  // timezone string is invalid (Intl throws RangeError for unknown timezones).
  let nowH: number
  let nowM: number
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      })
      const parts = fmt.formatToParts(now)
      nowH = Number(parts.find((p) => p.type === "hour")!.value)
      nowM = Number(parts.find((p) => p.type === "minute")!.value)
      // Intl hour12:false can return 24 for midnight in some engines
      if (nowH === 24) nowH = 0
    } catch {
      // Invalid timezone string -- fall back to local time
      nowH = now.getHours()
      nowM = now.getMinutes()
    }
  } else {
    nowH = now.getHours()
    nowM = now.getMinutes()
  }
  const nowMinutes = nowH * 60 + nowM

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  }
  // Wraps around midnight
  return nowMinutes >= startMinutes || nowMinutes < endMinutes
}
