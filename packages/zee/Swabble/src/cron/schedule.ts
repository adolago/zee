import { Cron } from "croner";
import type { CronSchedule } from "./types.js";
import { parseAbsoluteTimeMs } from "./parse.js";

function resolveCronTimezone(tz?: string) {
  const trimmed = typeof tz === "string" ? tz.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function computeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  // Be defensive: cron schedules are loaded from disk (JSON) and may be corrupted,
  // partially migrated, or contain invalid shapes from older clients.
  if (!schedule || typeof schedule !== "object") {
    return undefined;
  }
  const kind = (schedule as { kind?: unknown }).kind;

  if (schedule.kind === "at") {
    // Handle both canonical `at` (string) and legacy `atMs` (number) fields.
    // The store migration should convert atMs->at, but be defensive in case
    // the migration hasn't run yet or was bypassed.
    const sched = schedule as { at?: string; atMs?: number | string };
    const atMs =
      typeof sched.atMs === "number" && Number.isFinite(sched.atMs) && sched.atMs > 0
        ? sched.atMs
        : typeof sched.atMs === "string"
          ? parseAbsoluteTimeMs(sched.atMs)
          : typeof sched.at === "string"
            ? parseAbsoluteTimeMs(sched.at)
            : null;
    if (atMs === null) {
      return undefined;
    }
    return atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === "every") {
    if (typeof schedule.everyMs !== "number" || !Number.isFinite(schedule.everyMs)) {
      return undefined;
    }
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) {
      return anchor;
    }
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
    return anchor + steps * everyMs;
  }

  if (kind !== "cron") {
    return undefined;
  }
  const exprRaw = (schedule as { expr?: unknown }).expr;
  if (typeof exprRaw !== "string") {
    return undefined;
  }
  const expr = exprRaw.trim();
  if (!expr) {
    return undefined;
  }
  try {
    const cron = new Cron(expr, {
      timezone: resolveCronTimezone((schedule as { tz?: unknown }).tz as string | undefined),
      catch: false,
    });
    let cursor = nowMs;
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = cron.nextRun(new Date(cursor));
      if (!next) {
        return undefined;
      }
      const nextMs = next.getTime();
      if (Number.isFinite(nextMs) && nextMs > nowMs) {
        return nextMs;
      }
      cursor += 1_000;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
