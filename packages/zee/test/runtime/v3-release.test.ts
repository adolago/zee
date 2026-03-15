import { describe, expect, test } from "bun:test"
import type { SecurityAuditReport } from "../../src/security"
import {
  buildOpenCodeRuntimeReleaseGate,
  buildOpenCodeRuntimeRolloutReport,
  type OpenCodeRuntimeRolloutReport,
} from "../../src/runtime/opencode-rollout"
import { buildV3ReleaseReport, summarizeV3ReleaseReport, type V3ReleaseDocCheck } from "../../src/runtime/v3-release"
import type { UsageSummary } from "../../src/usage/types"
import type { FluxEvent } from "../../src/flux"

function makeRouteEvent(params: {
  timestamp: string
  surface: "cli" | "orchestration" | "gateway"
  kind: "runtime.opencode.route.selected" | "runtime.opencode.route.fallback"
  reason?: "default_primary" | "surface_disabled" | "forced_legacy"
}): FluxEvent {
  return {
    id: `${params.surface}-${params.kind}-${params.timestamp}`,
    timestamp: new Date(params.timestamp).getTime(),
    traceID: `trace-${params.surface}-${params.kind}-${params.timestamp}`,
    direction: "internal",
    domain: "runtime",
    kind: params.kind,
    status: "ok",
    metadata: {
      surface: params.surface,
      route: params.kind === "runtime.opencode.route.selected" ? "opencode_primary" : "legacy_fallback",
      reason: params.reason ?? (params.kind === "runtime.opencode.route.selected" ? "default_primary" : "forced_legacy"),
    },
  }
}

function makeSecurityReport(ok: boolean): SecurityAuditReport {
  return {
    ok,
    errors: ok ? 0 : 1,
    warnings: 0,
    checked: ["gateway.controlUi.auth.required"],
    findings: ok
      ? []
      : [
          {
            severity: "error",
            code: "control-ui-auth-disabled",
            message: "Control UI auth is disabled.",
            remediation: "Enable token auth.",
          },
        ],
    alerts: [],
    metrics: {
      checkedCount: 1,
      findingCount: ok ? 0 : 1,
      alertCount: 0,
    },
  }
}

function makeUsageSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    period: "day",
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_086_400,
    totalRequests: 14,
    totalInputTokens: 48_000,
    totalOutputTokens: 22_000,
    totalCost: 1.45,
    byProvider: {},
    byModel: {},
    avgLatencyMs: 800,
    errorCount: 0,
    errorRate: 0,
    cacheHitRate: 0.3,
    ...overrides,
  }
}

function makeDocs(overrides: Array<Partial<V3ReleaseDocCheck>> = []): V3ReleaseDocCheck[] {
  const base: V3ReleaseDocCheck[] = [
    {
      id: "runtime-rollout",
      label: "OpenCode runtime rollout",
      path: "docs/architecture/opencode-runtime-rollout.md",
      exists: true,
    },
    {
      id: "v3-release-readiness",
      label: "V3 release readiness",
      path: "docs/architecture/v3-release-readiness.md",
      exists: true,
    },
    {
      id: "investing-eval-gates",
      label: "Investing eval gates",
      path: "docs/architecture/investing-eval-gates.md",
      exists: true,
    },
  ]

  return base.map((doc, index) => ({
    ...doc,
    ...(overrides[index] ?? {}),
  }))
}

function makeRuntimeReport(routeEvents: FluxEvent[]): OpenCodeRuntimeRolloutReport {
  return buildOpenCodeRuntimeRolloutReport(new Date("2026-03-15T12:00:00.000Z"), {
    routeEvents,
  })
}

describe("v3 release report", () => {
  test("buildV3ReleaseReport consolidates gates across categories", () => {
    const runtimeReport = makeRuntimeReport([
      makeRouteEvent({
        timestamp: "2026-03-15T11:00:00.000Z",
        surface: "cli",
        kind: "runtime.opencode.route.selected",
      }),
      makeRouteEvent({
        timestamp: "2026-03-15T11:01:00.000Z",
        surface: "orchestration",
        kind: "runtime.opencode.route.selected",
      }),
      makeRouteEvent({
        timestamp: "2026-03-15T11:02:00.000Z",
        surface: "gateway",
        kind: "runtime.opencode.route.selected",
      }),
    ])

    const report = buildV3ReleaseReport({
      generatedAt: new Date("2026-03-15T12:30:00.000Z"),
      memoryStats: { namespace: "zee" },
      mesh: {
        totalAgents: 9,
        maxAgents: 15,
        crossDomainLinks: 4,
        withinCapacity: true,
      },
      samplePlanSteps: 3,
      runtimeRollout: runtimeReport,
      runtimeGate: buildOpenCodeRuntimeReleaseGate(runtimeReport),
      security: makeSecurityReport(true),
      nodePolicy: { enabled: false, securityMode: "deny" },
      nodeStats: { active: 0, revoked: 0, total: 0 },
      usageSummary: makeUsageSummary(),
      docs: makeDocs(),
    })

    expect(report.readyForRelease).toBe(true)
    expect(report.categories.map((category) => category.id)).toEqual(["reliability", "security", "performance", "docs"])
    expect(report.docs.missingCount).toBe(0)
    expect(report.telemetry.kind).toBe("release.v3.report")
    expect(report.gates.some((gate) => gate.id === "performance.usage-latency")).toBe(true)
    expect(report.gates.some((gate) => gate.id === "docs.architecture.required")).toBe(true)
  })

  test("buildV3ReleaseReport blocks on runtime, performance, and docs failures", () => {
    const runtimeReport = makeRuntimeReport([
      makeRouteEvent({
        timestamp: "2026-03-15T11:05:00.000Z",
        surface: "gateway",
        kind: "runtime.opencode.route.fallback",
      }),
    ])

    const report = buildV3ReleaseReport({
      generatedAt: new Date("2026-03-15T12:30:00.000Z"),
      memoryStats: {},
      mesh: {
        totalAgents: 16,
        maxAgents: 15,
        crossDomainLinks: 4,
        withinCapacity: false,
      },
      samplePlanSteps: 0,
      runtimeRollout: runtimeReport,
      runtimeGate: buildOpenCodeRuntimeReleaseGate(runtimeReport),
      security: makeSecurityReport(true),
      nodePolicy: { enabled: true, securityMode: "full" },
      nodeStats: { active: 2, revoked: 0, total: 2 },
      usageSummary: makeUsageSummary({
        totalRequests: 9,
        avgLatencyMs: 8200,
        errorCount: 2,
        errorRate: 2 / 9,
      }),
      docs: makeDocs([{ exists: false }]),
    })

    const summary = summarizeV3ReleaseReport(report)

    expect(report.readyForRelease).toBe(false)
    expect(report.telemetry.metrics.failureCount).toBeGreaterThan(0)
    expect(report.docs.missingCount).toBe(1)
    expect(summary).toContain("ready=no")
    expect(summary).toContain("[performance] performance.usage-latency")
    expect(summary).toContain("[docs] docs.architecture.required")
    expect(summary).toContain("runtime.opencode-parity")
  })
})
