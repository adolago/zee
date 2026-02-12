export type BusySubmitDecision =
  | { submit: "prompt" }
  | { submit: "steer" }

export function decideBusySubmit(input: {
  sessionIsBusy: boolean
  hasSessionID: boolean
}): BusySubmitDecision {
  if (!input.sessionIsBusy) return { submit: "prompt" }

  // No active session to steer against (new session flow).
  if (!input.hasSessionID) return { submit: "prompt" }

  return { submit: "steer" }
}
