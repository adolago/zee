import type { NamedError } from "@zee/util/error"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_JITTER_FACTOR = 0.25
  export const RETRY_MAX_RETRIES = 5
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

  const RETRYABLE_MESSAGE_PATTERNS = [
    /429|500|502|503|504|524/i,
    /rate increased too quickly|rate limit|rate-limit|rate_limit|too many requests/i,
    /overloaded|service unavailable|service_unavailable|service-unavailable|internal error|internal_error|internal server error|server error|server_error|server-error|provider returned error|provider_returned_error|provider-returned-error/i,
    /terminated|fetch failed|failed to fetch|network[-_\s]error|upstream connect|connection error|connection refused|connection lost|socket connection was closed|socket hang up|reset before headers|getaddrinfo|enotfound|eai_again|econnrefused|econnreset|etimedout/i,
    /^timeout$|\b(?:request|response|connection|network|stream|read) (?:timeout|timed out|time out)\b/i,
    /try your request again|retry your request|resource exhausted|resource_exhausted/i,
  ]

  export function matchesRetryableMessage(value: unknown) {
    return typeof value === "string" && RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(value))
  }

  function cap(ms: number) {
    return Math.min(ms, RETRY_MAX_DELAY)
  }

  function exponential(attempt: number, random: number) {
    const base = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
    return Math.ceil(base + base * RETRY_JITTER_FACTOR * random)
  }

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError, random = Math.random()) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            return Math.ceil(parsedSeconds * 1000)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }

        return cap(Math.min(exponential(attempt, random), RETRY_MAX_DELAY_NO_HEADERS))
      }
    }

    return cap(Math.min(exponential(attempt, random), RETRY_MAX_DELAY_NO_HEADERS))
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    // Context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      const status = error.data.statusCode
      if (
        !error.data.isRetryable &&
        !(status !== undefined && status >= 500) &&
        !matchesRetryableMessage(error.data.message) &&
        !matchesRetryableMessage(error.data.responseBody)
      )
        return undefined
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    const json = iife(() => {
      try {
        if (typeof error.data?.message === "string") {
          const parsed = JSON.parse(error.data.message)
          return parsed
        }
        return JSON.parse(error.data.message)
      } catch {
        return undefined
      }
    })
    try {
      if (!json || typeof json !== "object") {
        return matchesRetryableMessage((error.data as any)?.message) ? String((error.data as any).message) : undefined
      }
      const code = typeof (json as any).code === "string" ? (json as any).code : ""

      if ((json as any).type === "error" && (json as any).error?.type === "too_many_requests") {
        return "Too Many Requests"
      }
      if (code.includes("exhausted") || code.includes("unavailable")) {
        return "Provider is overloaded"
      }
      if ((json as any).type === "error" && (json as any).error?.code?.includes("rate_limit")) {
        return "Rate Limited"
      }
      if (matchesRetryableMessage((error.data as any)?.message)) {
        return String((error.data as any).message)
      }
      return JSON.stringify(json)
    } catch {
      return undefined
    }
    return undefined
  }
}
