// Heartbeat token detection and stripping.

export const HEARTBEAT_TOKEN = "HEARTBEAT_OK"

/**
 * Check if a response text contains only the HEARTBEAT_OK token
 * (possibly wrapped in markdown/HTML formatting).
 */
export function isHeartbeatAck(text: string): boolean {
  const stripped = stripMarkup(text).trim()
  return stripped === HEARTBEAT_TOKEN || stripped === ""
}

/**
 * Strip HEARTBEAT_OK tokens and surrounding markup from response text.
 * Returns empty string if the entire response was just an ack.
 */
export function stripHeartbeatAck(text: string): string {
  let result = text
  // Remove the token itself
  result = result.replace(new RegExp(HEARTBEAT_TOKEN, "gi"), "")
  // Strip common wrapping patterns
  result = stripMarkup(result).trim()
  return result
}

function stripMarkup(text: string): string {
  let result = text
  // Strip HTML tags
  result = result.replace(/<[^>]*>/g, "")
  // Strip markdown bold/italic markers
  result = result.replace(/\*{1,3}([^*]*)\*{1,3}/g, "$1")
  // Strip markdown code markers
  result = result.replace(/`([^`]*)`/g, "$1")
  return result.trim()
}
