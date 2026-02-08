export type BusySubmitBehavior = "followup" | "steer" | "reject"

export type BusySubmitDecision =
  | { submit: "prompt"; shouldAbort: boolean }
  | { submit: "promptAsync"; shouldAbort: false }
  | { submit: "reject"; shouldAbort: false }

export function decideBusySubmit(input: {
  sessionIsBusy: boolean
  hasSessionID: boolean
  behavior: BusySubmitBehavior
}): BusySubmitDecision {
  if (!input.sessionIsBusy) return { submit: "prompt", shouldAbort: false }

  // No active session to abort/queue against (new session flow).
  if (!input.hasSessionID) return { submit: "prompt", shouldAbort: false }

  if (input.behavior === "reject") return { submit: "reject", shouldAbort: false }
  if (input.behavior === "steer") return { submit: "prompt", shouldAbort: true }
  return { submit: "promptAsync", shouldAbort: false }
}

