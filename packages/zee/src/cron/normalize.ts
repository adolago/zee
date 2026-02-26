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

export function normalizePayloadToSystemText(payload: CronPayload): string {
  if (payload.kind === "systemEvent") {
    return payload.text.trim()
  }
  if (payload.kind === "agentTurn") {
    return payload.message.trim()
  }
  return `tool:${payload.tool}`.trim()
}
