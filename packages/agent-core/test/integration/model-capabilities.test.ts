/**
 * Comprehensive Model Capabilities Test Suite
 *
 * Tests model capabilities from the TUI perspective including:
 * - Tool calling (single and parallel)
 * - Stream stalling detection and alerts
 * - Long context handling
 * - Extended thinking modes
 * - Error recovery and retry
 *
 * Uses mock providers to simulate various model behaviors without
 * requiring real API credentials.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createMockProvider, createTrackingMockProvider, type MockResponse } from "../mock/llm-provider"
import { StreamHealthMonitor, StreamHealth, noopStatusHandler, noopBusPublisher } from "../../src/session/stream-health"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

// Test options for stream health that avoid Instance context
const testOptions = {
  statusHandler: noopStatusHandler,
  busPublisher: noopBusPublisher,
}

// Skip in full test mode due to Bun timing issues
const isFullSuite = process.env["AGENT_CORE_FULL_TEST_SUITE"] === "true"

describe("Model Tool Calling", () => {
  describe("single tool call", () => {
    test("model requests single tool call", async () => {
      const response: MockResponse = {
        toolCalls: [
          {
            toolCallId: "call_001",
            toolName: "Read",
            args: { file_path: "/tmp/test.txt" },
          },
        ],
        finishReason: "tool-calls",
      }

      const provider = createMockProvider({
        responses: new Map([["read file", response]]),
      })

      const result = await provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "read file /tmp/test.txt" }] }],
      })

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls![0].toolName).toBe("Read")
      expect(result.toolCalls![0].args).toEqual({ file_path: "/tmp/test.txt" })
      expect(result.finishReason).toBe("tool-calls")
    })

    test("streaming tool call emits correct events", async () => {
      const response: MockResponse = {
        toolCalls: [
          {
            toolCallId: "call_002",
            toolName: "Bash",
            args: { command: "ls -la" },
          },
        ],
        finishReason: "tool-calls",
      }

      const provider = createMockProvider({
        responses: new Map([["run command", response]]),
      })

      const { stream } = await provider.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "run command ls" }] }],
      })

      const events: Array<{ type: string; toolName?: string }> = []
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        events.push({ type: value.type, toolName: value.toolName })
      }

      expect(events.some((e) => e.type === "tool-call")).toBe(true)
      expect(events.find((e) => e.type === "tool-call")?.toolName).toBe("Bash")
      expect(events.some((e) => e.type === "finish")).toBe(true)
    })
  })

  describe("parallel tool calls", () => {
    test("model requests multiple tools in parallel", async () => {
      const response: MockResponse = {
        toolCalls: [
          { toolCallId: "call_001", toolName: "Read", args: { file_path: "/src/a.ts" } },
          { toolCallId: "call_002", toolName: "Read", args: { file_path: "/src/b.ts" } },
          { toolCallId: "call_003", toolName: "Glob", args: { pattern: "**/*.ts" } },
        ],
        finishReason: "tool-calls",
      }

      const provider = createMockProvider({
        responses: new Map([["read multiple files", response]]),
      })

      const result = await provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "read multiple files" }] }],
      })

      expect(result.toolCalls).toHaveLength(3)
      expect(result.toolCalls!.map((tc) => tc.toolName)).toEqual(["Read", "Read", "Glob"])
    })

    test("streaming parallel tools emits all tool-call events", async () => {
      const response: MockResponse = {
        toolCalls: [
          { toolCallId: "call_001", toolName: "Read", args: { file_path: "/a.ts" } },
          { toolCallId: "call_002", toolName: "Read", args: { file_path: "/b.ts" } },
        ],
        finishReason: "tool-calls",
      }

      const provider = createMockProvider({
        responses: new Map([["parallel", response]]),
      })

      const { stream } = await provider.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "parallel read" }] }],
      })

      const toolCalls: string[] = []
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === "tool-call" && value.toolName) {
          toolCalls.push(value.toolName)
        }
      }

      expect(toolCalls).toHaveLength(2)
      expect(toolCalls).toEqual(["Read", "Read"])
    })
  })

  describe("tool call with text", () => {
    test("model provides text before tool call", async () => {
      const response: MockResponse = {
        text: "I'll read that file for you.",
        toolCalls: [{ toolCallId: "call_001", toolName: "Read", args: { file_path: "/test.txt" } }],
        finishReason: "tool-calls",
      }

      const provider = createMockProvider({
        responses: new Map([["with text", response]]),
      })

      const result = await provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "with text" }] }],
      })

      expect(result.text).toBe("I'll read that file for you.")
      expect(result.toolCalls).toHaveLength(1)
    })

    test("streaming emits text-delta before tool-call", async () => {
      const response: MockResponse = {
        text: "Let me check that.",
        toolCalls: [{ toolCallId: "call_001", toolName: "Grep", args: { pattern: "error" } }],
        finishReason: "tool-calls",
      }

      const provider = createMockProvider({
        responses: new Map([["check", response]]),
      })

      const { stream } = await provider.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "check for errors" }] }],
      })

      const eventTypes: string[] = []
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        eventTypes.push(value.type)
      }

      // Text deltas should come before tool-call
      const textIndex = eventTypes.indexOf("text-delta")
      const toolIndex = eventTypes.indexOf("tool-call")
      expect(textIndex).toBeLessThan(toolIndex)
    })
  })
})

describe("Tool Continuation Logic", () => {
  /**
   * Simulates the shouldContinueAfterTools logic used by extended-thinking models
   * (GPT-5.2, kimi-k2-thinking) that may produce tool calls without final synthesis.
   */
  type PartType = "text" | "tool" | "reasoning"
  interface MockPart {
    type: PartType
    text?: string
  }

  function shouldContinueAfterTools(parts: MockPart[]): boolean {
    let lastToolIndex = -1
    let lastTextIndex = -1
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.type === "tool") lastToolIndex = i
      if (part.type === "text" && part.text?.trim()) lastTextIndex = i
    }
    if (lastToolIndex === -1) return false
    if (lastTextIndex === -1) return true
    return lastTextIndex < lastToolIndex
  }

  test("continue when only tool calls present", () => {
    const parts: MockPart[] = [{ type: "tool" }, { type: "tool" }]
    expect(shouldContinueAfterTools(parts)).toBe(true)
  })

  test("continue when tool is last meaningful part", () => {
    const parts: MockPart[] = [{ type: "text", text: "Let me search" }, { type: "tool" }]
    expect(shouldContinueAfterTools(parts)).toBe(true)
  })

  test("do not continue when text follows tool (synthesis complete)", () => {
    const parts: MockPart[] = [{ type: "tool" }, { type: "text", text: "Based on the search results..." }]
    expect(shouldContinueAfterTools(parts)).toBe(false)
  })

  test("ignore empty text after tool", () => {
    const parts: MockPart[] = [{ type: "text", text: "Searching" }, { type: "tool" }, { type: "text", text: "" }]
    expect(shouldContinueAfterTools(parts)).toBe(true)
  })
})

describe.skipIf(isFullSuite)("Stream Stalling Detection", () => {
  let monitor: StreamHealthMonitor

  beforeEach(() => {
    StreamHealth.clear()
  })

  afterEach(() => {
    if (monitor) monitor.dispose()
    StreamHealth.clear()
  })

  test("detects no stall when events arrive regularly", async () => {
    monitor = new StreamHealthMonitor({
      sessionID: "test-stall-1",
      messageID: "msg-1",
      ...testOptions,
    })

    // Simulate regular event flow
    for (let i = 0; i < 5; i++) {
      monitor.recordEvent("text-delta", 100)
      await Bun.sleep(10)
    }

    expect(monitor.isStalled()).toBe(false)
    expect(monitor.getReport().stallWarnings).toBe(0)
  })

  test("checkForStall returns false when events are recent", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "test-stall-2",
      messageID: "msg-2",
      ...testOptions,
    })

    monitor.recordEvent("text-delta")
    expect(monitor.checkForStall()).toBe(false)
  })

  test("stall detection ignores completed streams", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "test-stall-3",
      messageID: "msg-3",
      ...testOptions,
    })

    monitor.complete()
    expect(monitor.checkForStall()).toBe(false)
  })

  test("stall detection ignores errored streams", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "test-stall-4",
      messageID: "msg-4",
      ...testOptions,
    })

    monitor.fail("Connection lost")
    expect(monitor.checkForStall()).toBe(false)
  })

  test("stream health report tracks event types", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "test-events",
      messageID: "msg-events",
      ...testOptions,
    })

    monitor.recordEvent("start")
    monitor.recordEvent("text-delta", 50)
    monitor.recordEvent("text-delta", 75)
    monitor.recordEvent("tool-call")
    monitor.recordEvent("tool-result")
    monitor.recordEvent("finish")

    const report = monitor.getReport()
    expect(report.progress.eventsReceived).toBe(6)
    expect(report.progress.textDeltaEvents).toBe(2)
    expect(report.progress.toolCallEvents).toBe(2) // tool-call + tool-result
    expect(report.progress.bytesReceived).toBe(125)
  })

  test("default stall thresholds are configured", () => {
    expect(StreamHealth.thresholds.stallWarningMs).toBe(15_000)
    expect(StreamHealth.thresholds.stallTimeoutMs).toBe(60_000)
  })
})

describe("Long Context Handling", () => {
  test("provider accepts large prompt arrays", async () => {
    const largePrompt: Array<{ role: "user"; content: Array<{ type: "text"; text: string }> }> = []

    // Simulate 100 conversation turns
    for (let i = 0; i < 100; i++) {
      largePrompt.push({
        role: "user",
        content: [{ type: "text", text: `Message ${i}: ${"x".repeat(1000)}` }],
      })
    }

    const provider = createMockProvider({
      defaultResponse: {
        text: "Processed large context successfully.",
        usage: { promptTokens: 50000, completionTokens: 100, totalTokens: 50100 },
      },
    })

    const result = await provider.doGenerate({ prompt: largePrompt })

    expect(result.text).toBe("Processed large context successfully.")
    expect(result.usage.promptTokens).toBe(50000)
  })

  test("streaming handles large responses", async () => {
    const longText = "word ".repeat(1000) // 1000 words

    const provider = createMockProvider({
      defaultResponse: {
        text: longText,
        usage: { promptTokens: 100, completionTokens: 5000, totalTokens: 5100 },
      },
    })

    const { stream } = await provider.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "generate long response" }] }],
    })

    let textContent = ""
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === "text-delta" && value.textDelta) {
        textContent += value.textDelta
      }
    }

    // Trim both and compare - streaming adds spaces between words
    expect(textContent.trim()).toBe(longText.trim())
  })

  test("tracking provider records all calls", async () => {
    const { provider, getCalls, clearCalls } = createTrackingMockProvider({
      defaultResponse: { text: "Response 1" },
    })

    await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "First call" }] }],
    })

    await provider.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Second call" }] }],
    })

    const calls = getCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].method).toBe("doGenerate")
    expect(calls[1].method).toBe("doStream")

    clearCalls()
    expect(getCalls()).toHaveLength(0)
  })
})

describe("Error Handling and Recovery", () => {
  test("provider throws on configured error rate", async () => {
    const provider = createMockProvider({
      errorRate: 1.0, // Always error
      errorType: "network",
    })

    await expect(
      provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      }),
    ).rejects.toThrow("Network error")
  })

  test("handles auth errors", async () => {
    const provider = createMockProvider({
      errorRate: 1.0,
      errorType: "auth",
    })

    await expect(
      provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      }),
    ).rejects.toThrow("Authentication failed")
  })

  test("handles rate limit errors", async () => {
    const provider = createMockProvider({
      errorRate: 1.0,
      errorType: "rate-limit",
    })

    await expect(
      provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      }),
    ).rejects.toThrow("Rate limit exceeded")
  })

  test("handles server errors", async () => {
    const provider = createMockProvider({
      errorRate: 1.0,
      errorType: "server",
    })

    await expect(
      provider.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      }),
    ).rejects.toThrow("Server error")
  })

  test("stream error propagates to reader", async () => {
    const provider = createMockProvider({
      errorRate: 1.0,
      errorType: "network",
    })

    await expect(
      provider.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      }),
    ).rejects.toThrow("Network error")
  })
})

describe("Response Matching", () => {
  test("matches response by prompt substring", async () => {
    const provider = createMockProvider({
      responses: new Map([
        ["hello", { text: "Hello back!" }],
        ["goodbye", { text: "Goodbye!" }],
        ["help", { text: "How can I help?" }],
      ]),
      defaultResponse: { text: "Default response" },
    })

    const r1 = await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "say hello to me" }] }],
    })
    expect(r1.text).toBe("Hello back!")

    const r2 = await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "I need help with something" }] }],
    })
    expect(r2.text).toBe("How can I help?")

    const r3 = await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "random message" }] }],
    })
    expect(r3.text).toBe("Default response")
  })

  test("first matching response wins", async () => {
    const provider = createMockProvider({
      responses: new Map([
        ["test", { text: "First match" }],
        ["test case", { text: "Second match" }],
      ]),
    })

    const result = await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "this is a test case" }] }],
    })

    expect(result.text).toBe("First match")
  })
})

describe("Usage Tracking", () => {
  test("reports token usage from response", async () => {
    const provider = createMockProvider({
      defaultResponse: {
        text: "Response",
        usage: {
          promptTokens: 150,
          completionTokens: 50,
          totalTokens: 200,
        },
      },
    })

    const result = await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    })

    expect(result.usage.promptTokens).toBe(150)
    expect(result.usage.completionTokens).toBe(50)
  })

  test("streaming reports usage in finish event", async () => {
    const provider = createMockProvider({
      defaultResponse: {
        text: "Streaming response",
        usage: {
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
        },
      },
    })

    const { stream } = await provider.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    })

    let finishEvent: { promptTokens: number; completionTokens: number } | null = null
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === "finish" && value.usage) {
        finishEvent = value.usage
      }
    }

    expect(finishEvent).not.toBeNull()
    expect(finishEvent!.promptTokens).toBe(100)
    expect(finishEvent!.completionTokens).toBe(25)
  })

  test("defaults to standard usage when not specified", async () => {
    const provider = createMockProvider({
      defaultResponse: { text: "Simple response" },
    })

    const result = await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    })

    expect(result.usage.promptTokens).toBe(10)
    expect(result.usage.completionTokens).toBe(20)
  })
})

describe("Provider Delay Simulation", () => {
  test("respects configured delay", async () => {
    const delayMs = 100
    const toleranceMs = 5
    const provider = createMockProvider({
      delay: delayMs,
      defaultResponse: { text: "Delayed response" },
    })

    const start = Date.now()
    await provider.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    })
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(delayMs - toleranceMs)
  })

  test("streaming respects delay before starting", async () => {
    const delayMs = 50
    const toleranceMs = 5
    const provider = createMockProvider({
      delay: delayMs,
      defaultResponse: { text: "Delayed stream" },
    })

    const start = Date.now()
    const { stream } = await provider.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    })

    // Consume stream
    const reader = stream.getReader()
    while (!(await reader.read()).done) {}

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(delayMs - toleranceMs)
  })
})
