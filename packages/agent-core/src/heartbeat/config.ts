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

  const { start, end } = config.activeHours

  const parseTime = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number)
    return h * 60 + m
  }

  const startMinutes = parseTime(start)
  const endMinutes = parseTime(end)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  }
  // Wraps around midnight
  return nowMinutes >= startMinutes || nowMinutes < endMinutes
}
