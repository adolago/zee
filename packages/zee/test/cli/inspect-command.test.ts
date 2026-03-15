import { describe, expect, test } from "bun:test"
import { buildInspectUsageSnapshot, resolveInspectUsagePeriod, resolveInspectUsageTop } from "../../src/cli/cmd/inspect"
import {
  buildOpenCodeRuntimeContractReport,
  summarizeOpenCodeRuntimeContract,
} from "../../src/runtime/opencode-contract"
import { buildPiMonoCompatReport, summarizePiMonoCompatReport } from "../../src/runtime/pimono-compat"
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

  test("OpenCode runtime contract report inventories CLI, orchestration, and gateway surfaces", () => {
    const report = buildOpenCodeRuntimeContractReport(new Date("2026-03-14T12:00:00.000Z"))

    expect(report.contractId).toBe("opencode-runtime-core")
    expect(report.contractVersion).toBe(1)
    expect(report.generatedAt).toBe("2026-03-14T12:00:00.000Z")
    expect(report.surfaces.map((surface) => surface.surface)).toEqual(["cli", "orchestration", "gateway"])
    expect(report.telemetry.eventType).toBe("runtime.opencode-contract.inspected")
    expect(report.telemetry.metrics.surfaceCount).toBe(3)
    expect(report.telemetry.metrics.entryPointCount).toBe(11)
    expect(report.telemetry.metrics.transportCount).toBe(5)
    expect(report.telemetry.metrics.gatewayPresent).toBe(true)
    expect(report.telemetry.metrics.orchestrationPresent).toBe(true)
  })

  test("OpenCode runtime contract summary mentions all surfaces and telemetry", () => {
    const summary = summarizeOpenCodeRuntimeContract(
      buildOpenCodeRuntimeContractReport(new Date("2026-03-14T12:00:00.000Z")),
    )

    expect(summary).toContain("OpenCode runtime contract v1")
    expect(summary).toContain("- cli:")
    expect(summary).toContain("- orchestration:")
    expect(summary).toContain("- gateway:")
    expect(summary).toContain("runtime.opencode-contract.inspected")
  })

  test("pi-mono compatibility report inventories explicit shim boundaries and statuses", () => {
    const report = buildPiMonoCompatReport(new Date("2026-03-14T12:30:00.000Z"))

    expect(report.reportId).toBe("pimono-compat-shim-boundaries")
    expect(report.reportVersion).toBe(1)
    expect(report.generatedAt).toBe("2026-03-14T12:30:00.000Z")
    expect(report.roadmapIssue).toBe(474)
    expect(report.rolloutPhase).toBe("removal_gated")
    expect(report.policy.hardStopDate).toBe("2026-04-30")
    expect(report.policy.removalChecklist.approvedAt).toBe("2026-03-15")
    expect(report.policy.removalChecklist.items).toHaveLength(5)
    expect(report.boundaries.map((boundary) => boundary.id)).toEqual([
      "server.llm.pi-ai-bridge",
      "server.auth.api-key-payload",
      "agent.config.tools-alias",
      "orchestration.pi-agent-event-schema",
      "agent.persona-ids",
      "server.personas-endpoint",
    ])
    expect(report.telemetry.eventType).toBe("runtime.pimono-compat.inspected")
    expect(report.telemetry.metrics.boundaryCount).toBe(6)
    expect(report.telemetry.metrics.activeTemporaryCount).toBe(2)
    expect(report.telemetry.metrics.deprecatedLiveCount).toBe(2)
    expect(report.telemetry.metrics.retiredBlockedCount).toBe(2)
    expect(report.telemetry.metrics.telemetryBackedCount).toBe(4)
    expect(report.telemetry.metrics.missingTelemetryCount).toBe(0)
  })

  test("pi-mono compatibility summary includes statuses and telemetry event", () => {
    const summary = summarizePiMonoCompatReport(buildPiMonoCompatReport(new Date("2026-03-14T12:30:00.000Z")))

    expect(summary).toContain("pi-mono compatibility shim inventory v1")
    expect(summary).toContain("hard-stop=2026-04-30")
    expect(summary).toContain("checklist: approved=2026-03-15 completed=5/5")
    expect(summary).toContain("server.llm.pi-ai-bridge [active_temporary]")
    expect(summary).toContain("agent.config.tools-alias [deprecated_live]")
    expect(summary).toContain("server.personas-endpoint [retired_blocked]")
    expect(summary).toContain("runtime.pimono-compat.inspected")
  })
})
