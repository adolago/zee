// Cron schedule computation using croner library.

import { Cron } from "croner"
import type { CronSchedule } from "./types"

export function computeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  // Be defensive: cron jobs are loaded from disk and can be corrupted or
  // partially migrated (older clients / manual edits).
  if (!schedule || typeof schedule !== "object") {
    return undefined
  }
  const kind = (schedule as { kind?: unknown }).kind

  if (kind === "at") {
    const atMs = (schedule as { atMs?: unknown }).atMs
    if (typeof atMs !== "number" || !Number.isFinite(atMs)) {
      return undefined
    }
    return atMs > nowMs ? atMs : undefined
  }

  if (kind === "every") {
    const everyMsRaw = (schedule as { everyMs?: unknown }).everyMs
    if (typeof everyMsRaw !== "number" || !Number.isFinite(everyMsRaw)) {
      return undefined
    }
    const everyMs = Math.max(1, Math.floor(everyMsRaw))
    const anchorRaw = (schedule as { anchorMs?: unknown }).anchorMs
    const anchor =
      typeof anchorRaw === "number" && Number.isFinite(anchorRaw) ? Math.max(0, Math.floor(anchorRaw)) : nowMs
    if (nowMs < anchor) {
      return anchor
    }
    const elapsed = nowMs - anchor
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs))
    return anchor + steps * everyMs
  }

  if (kind !== "cron") {
    return undefined
  }

  const exprRaw = (schedule as { expr?: unknown }).expr
  if (typeof exprRaw !== "string") {
    return undefined
  }
  const expr = exprRaw.trim()
  if (!expr) {
    return undefined
  }

  const tzRaw = (schedule as { tz?: unknown }).tz
  const tz = typeof tzRaw === "string" ? tzRaw.trim() : ""

  try {
    const cron = new Cron(expr, {
      timezone: tz || undefined,
      catch: false,
    })

    // Croner can return a run time at or before the cursor (depending on
    // expression). Ensure the computed next time is strictly in the future.
    let cursor = nowMs
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = cron.nextRun(new Date(cursor))
      if (!next) {
        return undefined
      }
      const nextMs = next.getTime()
      if (Number.isFinite(nextMs) && nextMs > nowMs) {
        return nextMs
      }
      cursor += 1_000
    }
    return undefined
  } catch {
    return undefined
  }
}
