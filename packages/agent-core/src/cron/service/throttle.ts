// Notification throttling and dedup for cron jobs.

import crypto from "crypto"
import type { CronThrottle } from "../types"

type ThrottleEntry = {
  sentAtMs: number
  hash: string
}

/** In-memory ring buffer of recent notification hashes per job. */
const history = new Map<string, ThrottleEntry[]>()

const MAX_ENTRIES_PER_JOB = 200

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

/**
 * Determine whether a notification should be suppressed.
 *
 * Returns a reason string if throttled, or undefined if the notification should proceed.
 */
export function shouldThrottle(
  jobId: string,
  outputHash: string,
  nowMs: number,
  config: CronThrottle | undefined,
): string | undefined {
  if (!config) {
    return undefined
  }

  const entries = history.get(jobId) ?? []

  const DEFAULT_WINDOW_MS = 3_600_000 // 1 hour

  const dedupWindowMs = config.dedupWindowMs
  if (typeof dedupWindowMs === "number" && dedupWindowMs > 0) {
    const cutoff = nowMs - dedupWindowMs
    const dup = entries.find((e) => e.sentAtMs >= cutoff && e.hash === outputHash)
    if (dup) {
      return `duplicate output within dedup window (${dedupWindowMs}ms)`
    }
  }

  const maxPer = config.maxPerWindow
  if (typeof maxPer === "number" && maxPer > 0) {
    const windowMs = typeof dedupWindowMs === "number" && dedupWindowMs > 0 ? dedupWindowMs : DEFAULT_WINDOW_MS
    const cutoff = nowMs - windowMs
    const countInWindow = entries.filter((e) => e.sentAtMs >= cutoff).length
    if (countInWindow >= maxPer) {
      return `max notifications per window reached (${maxPer}/${windowMs}ms)`
    }
  }

  return undefined
}

/** Record that a notification was sent for a job. */
export function recordSent(jobId: string, outputHash: string, nowMs: number): void {
  let entries = history.get(jobId)
  if (!entries) {
    entries = []
    history.set(jobId, entries)
  }
  entries.push({ sentAtMs: nowMs, hash: outputHash })
  // Trim to prevent unbounded growth.
  if (entries.length > MAX_ENTRIES_PER_JOB) {
    entries.splice(0, entries.length - MAX_ENTRIES_PER_JOB)
  }
}

/** Clear throttle history for a job (e.g. when removed). */
export function clearHistory(jobId: string): void {
  history.delete(jobId)
}

/** Clear all throttle history. Useful for testing. */
export function clearAllHistory(): void {
  history.clear()
}
