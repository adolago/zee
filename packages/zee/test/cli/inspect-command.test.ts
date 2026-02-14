import { describe, expect, test } from "bun:test"
import {
  buildInspectUsageSnapshot,
  resolveInspectUsagePeriod,
  resolveInspectUsageTop,
} from "../../src/cli/cmd/inspect"
import type { UsageStats, UsageSummary } from "../../src/usage/types"

function makeSummary(): UsageSummary {
  return {
    period: "day",
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_086_400,
    totalRequests: 14,
    totalInputTokens: 48_000,
    totalOutputTokens: 22_000,
    totalCost: 1.45,
    byProvider: {
      openai: {
        providerId: "openai",
        requests: 9,
        inputTokens: 28_000,
        outputTokens: 12_000,
        cost: 1.05,
        models: ["gpt-4o"],
      },
      anthropic: {
        providerId: "anthropic",
        requests: 5,
        inputTokens: 20_000,
        outputTokens: 10_000,
        cost: 0.4,
        models: ["claude-sonnet-4-5"],
      },
    },
    byModel: {
      "gpt-4o": {
        modelId: "gpt-4o",
        modelName: "GPT-4o",
        providerId: "openai",
        requests: 9,
        inputTokens: 28_000,
        outputTokens: 12_000,
        cost: 1.05,
        avgLatencyMs: 720,
      },
      "claude-sonnet-4-5": {
        modelId: "claude-sonnet-4-5",
        modelName: "Claude Sonnet 4.5",
        providerId: "anthropic",
        requests: 5,
        inputTokens: 20_000,
        outputTokens: 10_000,
        cost: 0.4,
        avgLatencyMs: 940,
      },
    },
    avgLatencyMs: 800,
    errorCount: 0,
    errorRate: 0,
    cacheHitRate: 0.3,
  }
}

function makeStats(): UsageStats {
  return {
    todayRequests: 14,
    todayCost: 1.45,
    todayTokens: 70_000,
    weekRequests: 53,
    weekCost: 4.9,
    monthRequests: 203,
    monthCost: 16.2,
    topModel: { modelId: "gpt-4o", cost: 8.5 },
    topProvider: { providerId: "openai", cost: 12.2 },
    lastRequestAt: 1_700_000_086_400,
  }
}

describe("inspect command helpers", () => {
  test("resolveInspectUsagePeriod falls back for invalid values", () => {
    expect(resolveInspectUsagePeriod("day", "week")).toBe("day")
    expect(resolveInspectUsagePeriod("invalid", "week")).toBe("week")
    expect(resolveInspectUsagePeriod(undefined, "month")).toBe("month")
  })

  test("resolveInspectUsageTop enforces positive integer", () => {
    expect(resolveInspectUsageTop(7, 5)).toBe(7)
    expect(resolveInspectUsageTop(0, 5)).toBe(1)
    expect(resolveInspectUsageTop(2.9, 5)).toBe(2)
    expect(resolveInspectUsageTop(undefined, 5)).toBe(5)
  })

  test("buildInspectUsageSnapshot includes sorted provider and model leaders", () => {
    const usage = buildInspectUsageSnapshot({
      period: "day",
      summary: makeSummary(),
      stats: makeStats(),
      top: 1,
    })

    expect(usage.topProviders).toHaveLength(1)
    expect(usage.topProviders[0]?.id).toBe("openai")
    expect(usage.topModels).toHaveLength(1)
    expect(usage.topModels[0]?.id).toBe("gpt-4o")
  })
})

