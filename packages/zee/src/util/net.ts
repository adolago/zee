/**
 * Network Utilities
 *
 * Common patterns for HTTP requests and JSON parsing.
 */

import { z } from "zod"
import { Log } from "./log"

const log = Log.create({ service: "net-util" })

/**
 * Fetch with timeout using AbortController
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Response or null on timeout/error
 */
export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000,
): Promise<Response | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.debug("Fetch request timed out", { url, timeoutMs })
    } else {
      log.debug("Fetch request failed", {
        url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Safe JSON parse with optional zod schema validation
 *
 * @param json - JSON string to parse
 * @param schema - Optional zod schema for validation
 * @returns Parsed and validated data, or null on failure
 */
export function safeJsonParse<T>(json: string, schema?: z.ZodSchema<T>): T | null {
  try {
    const parsed = JSON.parse(json)
    if (schema) {
      const result = schema.safeParse(parsed)
      if (!result.success) {
        log.debug("JSON validation failed", {
          errors: result.error.flatten().fieldErrors,
        })
        return null
      }
      return result.data
    }
    return parsed as T
  } catch (error) {
    log.debug("JSON parse failed", {
      error: error instanceof Error ? error.message : String(error),
      jsonPreview: json.substring(0, 100),
    })
    return null
  }
}

/**
 * Type for event subscription cleanup function
 */
export type Unsubscribe = () => void

/**
 * Safe event subscription with automatic cleanup tracking
 *
 * @param emitter - Event emitter or similar object with subscribe method
 * @param event - Event name
 * @param handler - Event handler
 * @param cleanupList - Array to track cleanup functions
 * @returns Unsubscribe function
 */
export function safeSubscribe<T extends { on: (event: string, handler: (...args: any[]) => void) => any }>(
  emitter: T,
  event: string,
  handler: (...args: any[]) => void,
  cleanupList?: Unsubscribe[],
): Unsubscribe {
  emitter.on(event, handler)

  const unsubscribe: Unsubscribe = () => {
    try {
      // Try various unsubscribe methods
      if ("off" in emitter && typeof emitter.off === "function") {
        ;(emitter as any).off(event, handler)
      } else if ("removeListener" in emitter && typeof emitter.removeListener === "function") {
        ;(emitter as any).removeListener(event, handler)
      } else if ("removeEventListener" in emitter && typeof emitter.removeEventListener === "function") {
        ;(emitter as any).removeEventListener(event, handler)
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  if (cleanupList) {
    cleanupList.push(unsubscribe)
  }

  return unsubscribe
}

/**
 * Create a fetch request with JSON body and timeout
 *
 * @param url - URL to fetch
 * @param body - Request body (will be JSON stringified)
 * @param options - Additional fetch options
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Response or null on timeout/error
 */
export async function postJson(
  url: string,
  body: unknown,
  options?: Omit<RequestInit, "method" | "body" | "headers">,
  timeoutMs: number = 10000,
): Promise<Response | null> {
  return fetchWithTimeout(
    url,
    {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options as RequestInit | undefined)?.headers,
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )
}

export function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}
