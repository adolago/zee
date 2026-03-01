import { createHash } from "node:crypto"
import type { FluxRedaction } from "./types"

const REDACTED = "[REDACTED]"
const MAX_ARRAY_ITEMS = 16
const MAX_OBJECT_KEYS = 64
const MAX_DEPTH = 6

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /api[-_]?key/i,
  /token/i,
  /password/i,
  /secret/i,
  /cookie/i,
  /session/i,
  /refresh/i,
  /access/i,
  /credential/i,
  /bearer/i,
]

export function redactHeaderValue(name: string, value: string, mode: FluxRedaction): string {
  if (mode === "debug") return value
  if (!isSensitiveKey(name)) return value
  return summarizeSecret(value)
}

export function redactHeaders(
  headers: Record<string, string | undefined>,
  mode: FluxRedaction,
): Record<string, string | undefined> {
  const output: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      output[key] = value
      continue
    }
    output[key] = redactHeaderValue(key, value, mode)
  }
  return output
}

export function redactValue(value: unknown, mode: FluxRedaction, depth = 0): unknown {
  if (mode === "debug") return value
  if (depth >= MAX_DEPTH) return "[TRUNCATED]"
  if (value == null) return value

  if (typeof value === "string") {
    return mode === "strict" ? truncateString(value, 4096) : truncateString(value, 8192)
  }
  if (typeof value === "number" || typeof value === "boolean") return value

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_ARRAY_ITEMS)
    const mapped = limited.map((item) => redactValue(item, mode, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) mapped.push("[TRUNCATED_ARRAY]")
    return mapped
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    let count = 0
    for (const [key, nested] of Object.entries(input)) {
      count++
      if (count > MAX_OBJECT_KEYS) {
        output["__truncated__"] = true
        break
      }
      if (isSensitiveKey(key)) {
        if (typeof nested === "string") output[key] = summarizeSecret(nested)
        else output[key] = REDACTED
        continue
      }
      output[key] = redactValue(nested, mode, depth + 1)
    }
    return output
  }

  return String(value)
}

export function summarizeSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return REDACTED
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 12)
  return `${REDACTED}(sha256:${digest},len:${trimmed.length})`
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

function truncateString(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}
