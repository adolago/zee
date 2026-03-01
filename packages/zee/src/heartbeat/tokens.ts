// Heartbeat token detection and stripping.

export const HEARTBEAT_TOKEN = "HEARTBEAT_OK"
const THOUGHT_BLOCK_RE = /!\[thought[\s\S]*?\](?:!|$)/gi
const THINK_TAG_RE = /<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi
const THOUGHT_PREFIX_RE = /^\s*(?:!\[)?(?:[^\x00-\x7F]+)?thought\b/i
const HEARTBEAT_ARTIFACT_ONLY_RE = /^(_model|json|\{\})$/i

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

/**
 * Remove known model-leak artifacts from heartbeat output before delivery.
 */
export function sanitizeHeartbeatText(text: string): string {
  let cleaned = text.trim()
  if (!cleaned) {
    return ""
  }

  cleaned = cleaned.replace(THOUGHT_BLOCK_RE, "").replace(THINK_TAG_RE, "").trim()
  if (!cleaned) {
    return ""
  }

  if (THOUGHT_PREFIX_RE.test(cleaned)) {
    return ""
  }

  if (HEARTBEAT_ARTIFACT_ONLY_RE.test(cleaned)) {
    return ""
  }

  if (isEffectivelyEmptyJsonArtifact(cleaned)) {
    return ""
  }

  return cleaned
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

function isEffectivelyEmptyJsonArtifact(text: string): boolean {
  const parsed = parseLooseJsonObject(text)
  if (!parsed) {
    return false
  }

  const keys = Object.keys(parsed)
  if (keys.length === 0) {
    return true
  }

  // We only treat structured output as "empty artifact" when it includes
  // a content field and all values are empty-ish.
  if (!keys.includes("content")) {
    return false
  }

  return keys.every((key) => isEmptyJsonValue(parsed[key]))
}

function parseLooseJsonObject(text: string): Record<string, unknown> | undefined {
  const strippedFence = stripCodeFence(text.trim())
  const strippedPrefix = strippedFence.replace(/^json\b[:\s]*/i, "").trim()
  const candidate = strippedPrefix.startsWith("{") ? strippedPrefix : strippedFence

  if (!candidate.startsWith("{") || !candidate.endsWith("}")) {
    return undefined
  }

  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }
  return undefined
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : text
}

function isEmptyJsonValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === "string") {
    return value.trim().length === 0
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => isEmptyJsonValue(item))
  }
  if (typeof value === "object") {
    const nested = value as Record<string, unknown>
    return Object.keys(nested).length === 0 || Object.values(nested).every((item) => isEmptyJsonValue(item))
  }
  return false
}
