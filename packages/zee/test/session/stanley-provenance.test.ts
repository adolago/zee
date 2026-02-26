import { describe, expect, test } from "bun:test"
import {
  appendStanleyProvenance,
  extractTextFromParts,
  isValuationMetricQuery,
  summarizeStanleyProvenance,
} from "../../src/session/stanley-provenance"

describe("session.stanley-provenance", () => {
  test("detects valuation metric queries", () => {
    expect(isValuationMetricQuery("What is the forward PE ratio of ALPA4?")).toBe(true)
    expect(isValuationMetricQuery("show EV/EBITDA for AAPL")).toBe(true)
    expect(isValuationMetricQuery("what happened yesterday?")).toBe(false)
  })

  test("extracts user text from message parts", () => {
    const parts = [
      { type: "text", text: "What is the" },
      { type: "tool", tool: "stanley_research" },
      { type: "text", text: "forward PE?" },
    ] as any

    expect(extractTextFromParts(parts)).toBe("What is the\nforward PE?")
  })

  test("summarizes Stanley-first with web fallback", () => {
    const summary = summarizeStanleyProvenance([
      { tool: "stanley_market", status: "completed" },
      { tool: "stanley_research", status: "completed" },
      { tool: "websearch", status: "completed" },
      { tool: "webfetch", status: "completed" },
    ])
    expect(summary).toBeDefined()
    if (!summary) throw new Error("summary should be defined")

    expect(summary.primarySource).toBe("stanley_research")
    expect(summary.fallbackUsed).toBe(true)
    expect(summary.fallbackSources).toEqual(["websearch", "webfetch"])
    expect(summary.fallbackReason).toContain("fallback")
    expect(summary.toolCalls).toEqual(["stanley_market", "stanley_research", "websearch", "webfetch"])
  })

  test("summarizes web fallback when Stanley fails", () => {
    const summary = summarizeStanleyProvenance([
      { tool: "stanley_research", status: "error", error: "connection refused" },
      { tool: "websearch", status: "completed" },
    ])
    expect(summary).toBeDefined()
    if (!summary) throw new Error("summary should be defined")

    expect(summary.primarySource).toBe("websearch")
    expect(summary.fallbackUsed).toBe(true)
    expect(summary.fallbackReason).toContain("Stanley")
  })

  test("appends provenance block idempotently", () => {
    const summary = summarizeStanleyProvenance([
      { tool: "stanley_research", status: "completed" },
      { tool: "websearch", status: "completed" },
    ])
    expect(summary).toBeDefined()
    if (!summary) throw new Error("summary should be defined")

    const first = appendStanleyProvenance("Forward P/E is 11.98x.", summary)
    expect(first).toContain("Source Used:")
    expect(first).toContain("Primary source: stanley_research")

    const second = appendStanleyProvenance(first, summary)
    expect(second).toBe(first)
  })
})
