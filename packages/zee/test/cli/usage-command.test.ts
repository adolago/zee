import { describe, expect, test } from "bun:test"
import {
  buildUsageBreakdown,
  renderUsageDashboardLines,
  sortUsageBreakdown,
  type UsageBreakdownRow,
} from "../../src/cli/cmd/usage"
import type { UsageStats, UsageSummary } from "../../src/usage/types"

function makeSummary(): UsageSummary {
  return {
    period: "day",
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_086_400,
    totalRequests: 30,
    totalInputTokens: 120_000,
    totalOutputTokens: 80_000,
    totalCost: 2.75,
    byProvider: {
      openai: {
        providerId: "openai",
        requests: 20,
        inputTokens: 90_000,
        outputTokens: 60_000,
        cost: 2.0,
        models: ["gpt-4o", "gpt-4o-mini"],
      },
      anthropic: {
        providerId: "anthropic",
        requests: 10,
        inputTokens: 30_000,
        outputTokens: 20_000,
        cost: 0.75,
        models: ["claude-sonnet-4-5"],
      },
    },
    byModel: {
      "gpt-4o": {
        modelId: "gpt-4o",
        modelName: "GPT-4o",
        providerId: "openai",
        requests: 8,
        inputTokens: 45_000,
        outputTokens: 30_000,
        cost: 1.2,
        avgLatencyMs: 700,
      },
      "gpt-4o-mini": {
        modelId: "gpt-4o-mini",
        providerId: "openai",
        requests: 12,
        inputTokens: 45_000,
        outputTokens: 30_000,
        cost: 0.8,
        avgLatencyMs: 420,
      },
      "claude-sonnet-4-5": {
        modelId: "claude-sonnet-4-5",
        providerId: "anthropic",
        requests: 10,
        inputTokens: 30_000,
        outputTokens: 20_000,
        cost: 0.75,
        avgLatencyMs: 950,
      },
    },
    avgLatencyMs: 650,
    errorCount: 1,
    errorRate: 1 / 30,
    cacheHitRate: 0.2,
  }
}

function makeStats(): UsageStats {
  return {
    todayRequests: 30,
    todayCost: 2.75,
    todayTokens: 200_000,
    weekRequests: 150,
    weekCost: 11.2,
    monthRequests: 510,
    monthCost: 38.4,
    topModel: { modelId: "gpt-4o", cost: 18.5 },
    topProvider: { providerId: "openai", cost: 24.0 },
    lastRequestAt: 1_700_000_086_400,
  }
}

describe("usage command helpers", () => {
  test("buildUsageBreakdown returns provider rows", () => {
    const rows = buildUsageBreakdown(makeSummary(), "provider")
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === "openai")).toEqual({
      id: "openai",
      requests: 20,
      tokens: 150000,
      cost: 2,
    })
  })

  test("sortUsageBreakdown sorts by cost then requests then id", () => {
    const rows: UsageBreakdownRow[] = [
      { id: "c", requests: 1, tokens: 100, cost: 1 },
      { id: "a", requests: 3, tokens: 50, cost: 1 },
      { id: "b", requests: 2, tokens: 200, cost: 2 },
    ]
    const sorted = sortUsageBreakdown(rows, "cost")
    expect(sorted.map((row) => row.id)).toEqual(["b", "a", "c"])
  })

  test("renderUsageDashboardLines includes expected sections", () => {
    const summary = makeSummary()
    const stats = makeStats()
    const topProviders = sortUsageBreakdown(buildUsageBreakdown(summary, "provider"), "cost").slice(0, 2)
    const topModels = sortUsageBreakdown(buildUsageBreakdown(summary, "model"), "cost").slice(0, 2)

    const lines = renderUsageDashboardLines({
      period: "day",
      summary,
      stats,
      topProviders,
      topModels,
    })

    const text = lines.join("\n")
    expect(text).toContain("Usage dashboard (period=day)")
    expect(text).toContain("Quick window snapshot:")
    expect(text).toContain("Top providers:")
    expect(text).toContain("Top models:")
  })
})
