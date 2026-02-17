export type BusySubmitDecision = { submit: "prompt" } | { submit: "steer" } | { submit: "queue" }
export type SteerSubmitErrorKind = "steer_race_no_active_turn" | "steer_race_expected_turn_mismatch" | "other"

function normalizeErrorText(error: unknown): string {
  const raw = (() => {
    if (!error) return ""
    if (typeof error === "string") return error
    if (error instanceof Error) return error.message
    if (typeof error === "object") {
      const anyErr = error as any
      if (typeof anyErr?.error === "string") return anyErr.error
      if (typeof anyErr?.message === "string") return anyErr.message
      if (typeof anyErr?.error?.message === "string") return anyErr.error.message
      try {
        return JSON.stringify(error)
      } catch {
        return String(error)
      }
    }
    return String(error)
  })()
  return raw.replace(/\s+/g, " ").trim().toLowerCase()
}

export function classifySteerSubmitError(error: unknown): SteerSubmitErrorKind {
  const text = normalizeErrorText(error)
  if (!text) return "other"
  if (text.includes("no active turn to steer")) return "steer_race_no_active_turn"
  if (text.includes("steer rejected: expectedturnid does not match the active turn")) {
    return "steer_race_expected_turn_mismatch"
  }
  return "other"
}

export function decideBusySubmit(input: {
  sessionIsBusy: boolean
  hasSessionID: boolean
  hasActiveTurn: boolean
  trigger: "enter" | "tab"
}): BusySubmitDecision {
  if (!input.sessionIsBusy) return { submit: "prompt" }

  // No active session to steer against (new session flow).
  if (!input.hasSessionID) return { submit: "prompt" }

  // Session is busy, but no active assistant turn is steerable yet.
  if (!input.hasActiveTurn) return { submit: "queue" }

  if (input.trigger === "tab") return { submit: "queue" }
  return { submit: "steer" }
}
