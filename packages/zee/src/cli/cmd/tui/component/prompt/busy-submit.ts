export type BusySubmitDecision = { submit: "prompt" } | { submit: "steer" } | { submit: "queue" }

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
