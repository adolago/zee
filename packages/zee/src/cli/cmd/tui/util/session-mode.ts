import { parseExecutionMode, type ExecutionMode } from "@/session/mode"

export type SessionMode = ExecutionMode

export const SESSION_MODE_CYCLE: SessionMode[] = ["plan", "accept", "bypass"]

export const SESSION_MODE_TOAST: Record<SessionMode, { variant: "info" | "success" | "warning"; message: string }> = {
  plan: { variant: "info", message: "PLAN mode - Research only" },
  accept: { variant: "success", message: "ACCEPT mode - Edits auto-approved" },
  bypass: { variant: "warning", message: "BYPASS mode - All permissions skipped" },
}

export function normalizeSessionMode(value: unknown): SessionMode | undefined {
  return parseExecutionMode(value)
}

export function resolveEffectiveSessionMode(input: { sessionMode?: unknown; localDefault: SessionMode }): SessionMode {
  return normalizeSessionMode(input.sessionMode) ?? input.localDefault
}

export function nextSessionMode(mode: SessionMode): SessionMode {
  const idx = SESSION_MODE_CYCLE.indexOf(mode)
  return SESSION_MODE_CYCLE[(idx + 1) % SESSION_MODE_CYCLE.length]!
}
