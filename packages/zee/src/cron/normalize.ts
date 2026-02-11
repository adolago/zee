// Input normalization for cron jobs.

import type { CronPayload } from "./types"

export function normalizeRequiredName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("cron job name is required")
  }
  const name = raw.trim()
  if (!name) {
    throw new Error("cron job name is required")
  }
  return name
}

export function normalizeOptionalText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}

export function normalizeOptionalAgentId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}

export function inferLegacyName(job: {
  schedule?: { kind?: unknown; everyMs?: unknown; expr?: unknown }
  payload?: { kind?: unknown; text?: unknown; message?: unknown; tool?: unknown }
}): string {
  const text =
    job?.payload?.kind === "systemEvent" && typeof job.payload.text === "string"
      ? job.payload.text
      : job?.payload?.kind === "agentTurn" && typeof job.payload.message === "string"
        ? job.payload.message
        : job?.payload?.kind === "toolInvoke" && typeof job.payload.tool === "string"
          ? `tool:${job.payload.tool}`
        : ""
  const firstLine =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  if (firstLine) {
    return firstLine.length > 60 ? firstLine.slice(0, 59) + "…" : firstLine
  }

  const kind = typeof job?.schedule?.kind === "string" ? job.schedule.kind : ""
  if (kind === "cron" && typeof job?.schedule?.expr === "string") {
    const expr = job.schedule.expr
    return `Cron: ${expr.length > 52 ? expr.slice(0, 51) + "…" : expr}`
  }
  if (kind === "every" && typeof job?.schedule?.everyMs === "number") {
    return `Every: ${job.schedule.everyMs}ms`
  }
  if (kind === "at") {
    return "One-shot"
  }
  return "Cron job"
}

export function normalizePayloadToSystemText(payload: CronPayload): string {
  if (payload.kind === "systemEvent") {
    return payload.text.trim()
  }
  if (payload.kind === "agentTurn") {
    return payload.message.trim()
  }
  return `tool:${payload.tool}`.trim()
}
