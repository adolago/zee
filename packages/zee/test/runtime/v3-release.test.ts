import { describe, expect, test } from "bun:test"
import type { SecurityAuditReport } from "../../src/security"
import {
  buildOpenCodeRuntimeReleaseGate,
  buildOpenCodeRuntimeRolloutReport,
  type OpenCodeRuntimeRouteEvent,
  type OpenCodeRuntimeRolloutReport,
} from "../../src/runtime/opencode-rollout"
import { buildV3ReleaseReport, summarizeV3ReleaseReport, type V3ReleaseDocCheck } from "../../src/runtime/v3-release"

function makeRouteEvent(params: {
  timestamp: string
  surface: "cli" | "orchestration" | "gateway"
  kind: "runtime.opencode.route.selected" | "runtime.opencode.route.fallback"
  reason?: "default_primary" | "surface_disabled" | "forced_legacy"
}): OpenCodeRuntimeRouteEvent {
  return {
    timestamp: new Date(params.timestamp).getTime(),
    kind: params.kind,
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
    {
      id: "v3-rollout-plan",
      label: "V3 rollout plan",
      path: "docs/architecture/v3-rollout-plan.md",
      exists: true,
    },
    {
      id: "v3-launch-playbook",
      label: "V3 launch playbook",
      path: "docs/architecture/v3-launch-playbook.md",
      exists: true,
    },
  ]

  return base.map((doc, index) => ({
    ...doc,
    ...(overrides[index] ?? {}),
  }))
}

function makeRuntimeReport(routeEvents: OpenCodeRuntimeRouteEvent[]): OpenCodeRuntimeRolloutReport {
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
      docs: makeDocs(),
    })

    expect(report.readyForRelease).toBe(true)
    expect(report.categories.map((category) => category.id)).toEqual(["reliability", "security", "docs"])
    expect(report.docs.missingCount).toBe(0)
    expect(report.metrics.gateCount).toBe(report.gates.length)
    expect(report.gates.some((gate) => gate.id === "docs.architecture.required")).toBe(true)
  })

  test("buildV3ReleaseReport blocks on runtime and docs failures", () => {
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
      docs: makeDocs([{ exists: false }]),
    })

    const summary = summarizeV3ReleaseReport(report)

    expect(report.readyForRelease).toBe(false)
    expect(report.metrics.failureCount).toBeGreaterThan(0)
    expect(report.docs.missingCount).toBe(1)
    expect(summary).toContain("ready=no")
    expect(summary).toContain("[docs] docs.architecture.required")
    expect(summary).toContain("runtime.opencode-parity")
  })
})
