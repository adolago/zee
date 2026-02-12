/**
 * Per-session in-memory steering state.
 *
 * When a user sends a message while the processor is running, the steer
 * endpoint marks the session here. The processor checks this at finish-step
 * boundaries (after tool calls complete) and exits gracefully so the prompt
 * loop can continue with the new user message in context.
 */
export namespace SessionSteering {
  const pending = new Set<string>()

  /** Mark a session as having a pending steering message. */
  export function mark(sessionID: string) {
    pending.add(sessionID)
  }

  /** Check whether a session has a pending steering message. */
  export function check(sessionID: string): boolean {
    return pending.has(sessionID)
  }

  /** Clear the steering flag for a session. */
  export function clear(sessionID: string) {
    pending.delete(sessionID)
  }
}
