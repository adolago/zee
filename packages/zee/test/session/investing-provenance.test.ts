import { describe, expect, test } from "bun:test"
import {
  appendInvestingProvenance,
  extractTextFromParts,
  isValuationMetricQuery,
  summarizeInvestingProvenance,
} from "../../src/session/investing-provenance"

describe("session.investing-provenance", () => {
  test("detects valuation metric queries", () => {
    expect(isValuationMetricQuery("What is the forward PE ratio of ALPA4?")).toBe(true)
    expect(isValuationMetricQuery("show EV/EBITDA for AAPL")).toBe(true)
    expect(isValuationMetricQuery("what happened yesterday?")).toBe(false)
  })

  test("extracts user text from message parts", () => {
    const parts = [
      { type: "text", text: "What is the" },
      { type: "tool", tool: "zee_invest_research" },
      { type: "text", text: "forward PE?" },
    ] as any

    expect(extractTextFromParts(parts)).toBe("What is the\nforward PE?")
  })

  test("summarizes investing-first with web fallback", () => {
    const summary = summarizeInvestingProvenance([
      { tool: "zee_invest_market", status: "completed" },
      { tool: "zee_invest_research", status: "completed" },
      { tool: "websearch", status: "completed" },
      { tool: "webfetch", status: "completed" },
    ])
    expect(summary).toBeDefined()
    if (!summary) throw new Error("summary should be defined")

    expect(summary.primarySource).toBe("zee_invest_research")
    expect(summary.fallbackUsed).toBe(true)
    expect(summary.fallbackSources).toEqual(["websearch", "webfetch"])
    expect(summary.fallbackReason).toContain("fallback")
    expect(summary.toolCalls).toEqual(["zee_invest_market", "zee_invest_research", "websearch", "webfetch"])
  })

  test("summarizes web fallback when investing fails", () => {
    const summary = summarizeInvestingProvenance([
      { tool: "zee_invest_research", status: "error", error: "connection refused" },
      { tool: "websearch", status: "completed" },
    ])
    expect(summary).toBeDefined()
    if (!summary) throw new Error("summary should be defined")

    expect(summary.primarySource).toBe("websearch")
    expect(summary.fallbackUsed).toBe(true)
    expect(summary.fallbackReason).toContain("Investing")
  })

  test("appends provenance block idempotently", () => {
    const summary = summarizeInvestingProvenance([
      { tool: "zee_invest_research", status: "completed" },
      { tool: "websearch", status: "completed" },
    ])
    expect(summary).toBeDefined()
    if (!summary) throw new Error("summary should be defined")

    const first = appendInvestingProvenance("Forward P/E is 11.98x.", summary)
    expect(first).toContain("Source Used:")
    expect(first).toContain("Primary source: zee_invest_research")

    const second = appendInvestingProvenance(first, summary)
    expect(second).toBe(first)
  })
})
