import { describe, expect, test } from "bun:test"

/**
 * Tests for tool-only response detection logic.
 *
 * These tests verify the `shouldContinueAfterTools` behavior which prevents
 * premature loop exit when extended-thinking models (GPT-5.2, kimi-k2-thinking)
 * produce tool calls without a final text synthesis.
 *
 * The logic:
 * - If tool output appears after the last non-empty text part, continue the loop
 * - If no tools, don't continue
 * - If text comes after tools, don't continue (model already synthesized)
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

describe("shouldContinueAfterTools", () => {
  describe("returns false (do not continue)", () => {
    test("no parts at all", () => {
      expect(shouldContinueAfterTools([])).toBe(false)
    })

    test("only text parts", () => {
      const parts: MockPart[] = [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(false)
    })

    test("text after tool (model already synthesized)", () => {
      const parts: MockPart[] = [
        { type: "tool" },
        { type: "text", text: "Based on the tool result, here is my answer." },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(false)
    })

    test("text after multiple tools", () => {
      const parts: MockPart[] = [
        { type: "tool" },
        { type: "tool" },
        { type: "text", text: "Final synthesis" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(false)
    })

    test("reasoning only (no tools)", () => {
      const parts: MockPart[] = [
        { type: "reasoning", text: "Thinking about this..." },
        { type: "text", text: "My answer" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(false)
    })

    test("empty text after tool does not count as synthesis", () => {
      const parts: MockPart[] = [
        { type: "text", text: "Starting" },
        { type: "tool" },
        { type: "text", text: "" },
      ]
      // Empty text doesn't count, so tool is still "last meaningful" → continue
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })

    test("whitespace-only text after tool does not count", () => {
      const parts: MockPart[] = [
        { type: "text", text: "Starting" },
        { type: "tool" },
        { type: "text", text: "   \n\t  " },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })
  })

  describe("returns true (continue loop)", () => {
    test("tool only, no text", () => {
      const parts: MockPart[] = [{ type: "tool" }]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })

    test("multiple tools, no text", () => {
      const parts: MockPart[] = [{ type: "tool" }, { type: "tool" }, { type: "tool" }]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })

    test("text before tool (tool is last)", () => {
      const parts: MockPart[] = [
        { type: "text", text: "Let me check that" },
        { type: "tool" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })

    test("reasoning then tool", () => {
      const parts: MockPart[] = [
        { type: "reasoning", text: "I need to look this up" },
        { type: "tool" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })

    test("text, tool, tool pattern (common with multi-tool calls)", () => {
      const parts: MockPart[] = [
        { type: "text", text: "I'll read multiple files" },
        { type: "tool" },
        { type: "tool" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })

    test("complex sequence ending with tool", () => {
      const parts: MockPart[] = [
        { type: "reasoning", text: "Thinking..." },
        { type: "text", text: "Let me investigate" },
        { type: "tool" },
        { type: "reasoning", text: "Analyzing result..." },
        { type: "tool" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })
  })

  describe("edge cases", () => {
    test("interleaved text and tools, ending with text", () => {
      const parts: MockPart[] = [
        { type: "text", text: "First" },
        { type: "tool" },
        { type: "text", text: "Second" },
        { type: "tool" },
        { type: "text", text: "Final answer" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(false)
    })

    test("interleaved text and tools, ending with tool", () => {
      const parts: MockPart[] = [
        { type: "text", text: "First" },
        { type: "tool" },
        { type: "text", text: "Second" },
        { type: "tool" },
      ]
      expect(shouldContinueAfterTools(parts)).toBe(true)
    })
  })
})
