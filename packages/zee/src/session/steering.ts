/**
 * Per-session in-memory steering state.
 *
 * When a user sends a message while the processor is running, the steer
 * endpoint marks the active turn here. The processor checks this at finish-step
 * boundaries (after tool calls complete) and exits gracefully so the prompt
 * loop can continue with the new user message in context.
 */
export namespace SessionSteering {
  const pending = new Map<string, string>()

  /** Mark a session turn as having a pending steering message. */
  export function mark(sessionID: string, turnID: string) {
    pending.set(sessionID, turnID)
  }

  /** Check whether a session has a pending steering message for the specified turn. */
  export function check(sessionID: string, turnID: string): boolean {
    return pending.get(sessionID) === turnID
  }

  /** Clear the steering flag for a session (or only for a matching turn). */
  export function clear(sessionID: string, turnID?: string) {
    if (turnID === undefined) {
      pending.delete(sessionID)
      return
    }
    if (pending.get(sessionID) === turnID) pending.delete(sessionID)
  }
}
