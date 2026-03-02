const THOUGHT_BLOCK_REGEX = /!\[thought[\s\S]*?\](?:!|$)/gi
const THINK_TAG_REGEX = /<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi
const THOUGHT_PREFIX_REGEX = /^\s*(?:!\[)?(?:[^\x00-\x7F]+)?thought\b/i
const THOUGHT_LEAK_MARKER_REGEX = /(?:!\[thought\b|<think(?:ing)?\b|(?:[^\x00-\x7F]+)?thought\b)/i
const CRITICAL_INSTRUCTION_REGEX = /critical\s+instruction/i
const ASSISTANT_ARTIFACT_ONLY_REGEX = /^(_model|json|\{\})$/i

const TOOL_PAYLOAD_KEYS = new Set([
  "command",
  "description",
  "recipient_name",
  "parameters",
  "tool_uses",
  "patchText",
  "threadID",
  "workdir",
  "follow",
])

/**
 * Remove known model-leak artifacts from assistant output before sending to users.
 */
export function sanitizeAssistantText(text: string): string {
  let cleaned = text.trim()
  if (!cleaned) return ""

  cleaned = removeKnownReasoningArtifacts(cleaned).trim()
  if (containsCriticalInstructionThoughtLeak(cleaned)) return ""
  if (!cleaned || THOUGHT_PREFIX_REGEX.test(cleaned)) return ""
  if (ASSISTANT_ARTIFACT_ONLY_REGEX.test(cleaned)) return ""
  if (isLikelyDanglingJsonArtifact(cleaned)) return ""
  if (isEffectivelyEmptyJsonArtifact(cleaned)) return ""
  if (isLikelyToolCallPayload(cleaned)) return ""

  return cleaned
}

function removeKnownReasoningArtifacts(text: string): string {
  let cleaned = text.replace(THOUGHT_BLOCK_REGEX, "").replace(THINK_TAG_REGEX, "")

  const thoughtStart = cleaned.search(/!\[thought\b/i)
  if (thoughtStart >= 0) {
    cleaned = cleaned.slice(0, thoughtStart)
  }

  const thinkStart = cleaned.search(/<think(?:ing)?\b/i)
  if (thinkStart >= 0) {
    const trailing = cleaned.slice(thinkStart)
    if (!/<\/think(?:ing)?>/i.test(trailing)) {
      cleaned = cleaned.slice(0, thinkStart)
    }
  }

  return cleaned
}

function containsCriticalInstructionThoughtLeak(text: string): boolean {
  return CRITICAL_INSTRUCTION_REGEX.test(text) && THOUGHT_LEAK_MARKER_REGEX.test(text)
}

function isLikelyDanglingJsonArtifact(text: string): boolean {
  const strippedFence = stripCodeFence(text.trim())
  if (!/^json\b/i.test(strippedFence)) return false
  const payload = strippedFence.replace(/^json\b[:\s]*/i, "").trim()
  if (!payload) return true
  return /^[{[]\s*$/.test(payload)
}

function isLikelyToolCallPayload(text: string): boolean {
  const parsed = parseLooseJsonObject(text)
  if (!parsed) return false
  return Object.keys(parsed).some((key) => TOOL_PAYLOAD_KEYS.has(key))
}

function isEffectivelyEmptyJsonArtifact(text: string): boolean {
  const parsed = parseLooseJsonObject(text)
  if (!parsed) return false
  const keys = Object.keys(parsed)
  if (keys.length === 0) return true
  if (!keys.includes("content")) return false
  return keys.every((key) => isEmptyJsonValue(parsed[key]))
}

function parseLooseJsonObject(text: string): Record<string, unknown> | undefined {
  const strippedFence = stripCodeFence(text.trim())
  const strippedPrefix = strippedFence.replace(/^json\b[:\s]*/i, "").trim()
  const candidate = strippedPrefix.startsWith("{") ? strippedPrefix : strippedFence
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return undefined

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
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => isEmptyJsonValue(item))
  if (typeof value === "object") {
    const nested = value as Record<string, unknown>
    return Object.keys(nested).length === 0 || Object.values(nested).every((item) => isEmptyJsonValue(item))
  }
  return false
}
