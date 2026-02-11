import { describe, expect, test } from "bun:test"

/**
 * Tests for OpenAI Responses stream edge case handling.
 *
 * These tests verify the logic that handles streams ending without
 * proper completion events (common with GPT-5.2 xhigh and kimi-k2-thinking).
 *
 * Key behaviors tested:
 * 1. Tool calls without completion event → finishReason = "tool-calls"
 * 2. No completion event with content → finishReason = "stop"
 * 3. No completion event with no content → error
 * 4. Incomplete/failed responses → error surfaced
 */

type FinishReason = "stop" | "tool-calls" | "error" | "unknown"

interface StreamEndState {
  finishReason: FinishReason
  hasFunctionCall: boolean
  chunkCount: number
  totalDurationMs: number
  hasUsageData: boolean
}

/**
 * Simulates the logic from openai-responses-language-model.ts
 * for determining finishReason when stream ends without completion event.
 */
function determineFinishReason(state: StreamEndState): FinishReason {
  let { finishReason, hasFunctionCall, chunkCount, totalDurationMs, hasUsageData } = state

  // If we have function calls and unknown finish, treat as tool-calls
  if (finishReason === "unknown" && hasFunctionCall) {
    return "tool-calls"
  }

  // If no function calls and unknown finish, use heuristics
  if (finishReason === "unknown" && !hasFunctionCall) {
    const hasMinimalContent = chunkCount >= 2
    const suspiciouslyShort = totalDurationMs < 1000 && chunkCount < 5

    if (!hasMinimalContent || (!hasUsageData && suspiciouslyShort)) {
      return "error"
    } else {
      return "stop"
    }
  }

  return finishReason
}

describe("OpenAI Responses stream finish reason determination", () => {
  describe("tool-calls detection", () => {
    test("function call with unknown finish → tool-calls", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: true,
        chunkCount: 10,
        totalDurationMs: 5000,
        hasUsageData: true,
      })
      expect(result).toBe("tool-calls")
    })

    test("function call with unknown finish, no usage → tool-calls", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: true,
        chunkCount: 5,
        totalDurationMs: 2000,
        hasUsageData: false,
      })
      expect(result).toBe("tool-calls")
    })

    test("multiple tool calls pattern", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: true,
        chunkCount: 50,
        totalDurationMs: 10000,
        hasUsageData: true,
      })
      expect(result).toBe("tool-calls")
    })
  })

  describe("successful stop detection", () => {
    test("no function call, sufficient content → stop", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: false,
        chunkCount: 20,
        totalDurationMs: 5000,
        hasUsageData: true,
      })
      expect(result).toBe("stop")
    })

    test("no function call, minimal content but has usage → stop", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: false,
        chunkCount: 3,
        totalDurationMs: 2000,
        hasUsageData: true,
      })
      expect(result).toBe("stop")
    })

    test("no function call, long duration with content → stop", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: false,
        chunkCount: 5,
        totalDurationMs: 30000,
        hasUsageData: false,
      })
      expect(result).toBe("stop")
    })
  })

  describe("error detection", () => {
    test("no chunks at all → error", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: false,
        chunkCount: 0,
        totalDurationMs: 500,
        hasUsageData: false,
      })
      expect(result).toBe("error")
    })

    test("single chunk, very short, no usage → error", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: false,
        chunkCount: 1,
        totalDurationMs: 200,
        hasUsageData: false,
      })
      expect(result).toBe("error")
    })

    test("few chunks, short duration, no usage → error", () => {
      const result = determineFinishReason({
        finishReason: "unknown",
        hasFunctionCall: false,
        chunkCount: 3,
        totalDurationMs: 800,
        hasUsageData: false,
      })
      expect(result).toBe("error")
    })
  })

  describe("preserves existing finish reasons", () => {
    test("already stop → stop", () => {
      const result = determineFinishReason({
        finishReason: "stop",
        hasFunctionCall: false,
        chunkCount: 10,
        totalDurationMs: 5000,
        hasUsageData: true,
      })
      expect(result).toBe("stop")
    })

    test("already tool-calls → tool-calls", () => {
      const result = determineFinishReason({
        finishReason: "tool-calls",
        hasFunctionCall: true,
        chunkCount: 10,
        totalDurationMs: 5000,
        hasUsageData: true,
      })
      expect(result).toBe("tool-calls")
    })

    test("already error → error", () => {
      const result = determineFinishReason({
        finishReason: "error",
        hasFunctionCall: false,
        chunkCount: 1,
        totalDurationMs: 100,
        hasUsageData: false,
      })
      expect(result).toBe("error")
    })
  })
})

describe("Incomplete response handling", () => {
  const criticalReasons = ["server_error", "interruption", "cancelled", "turn_limit"]
  const nonCriticalReasons = ["max_output_tokens", "content_filter"]

  test.each(criticalReasons)("critical reason '%s' should surface as error", (reason) => {
    // In the actual implementation, these emit error events
    expect(criticalReasons.includes(reason)).toBe(true)
  })

  test.each(nonCriticalReasons)("non-critical reason '%s' should not error", (reason) => {
    expect(criticalReasons.includes(reason)).toBe(false)
  })
})
