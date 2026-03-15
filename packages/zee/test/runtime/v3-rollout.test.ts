import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { buildOpenCodeRuntimeReleaseGate, buildOpenCodeRuntimeRolloutReport } from "../../src/runtime/opencode-rollout"
import { applyV3RolloutStage, rollbackV3Rollout } from "../../src/runtime/v3-rollout"
import { buildV3ReleaseReport, type V3ReleaseDocCheck } from "../../src/runtime/v3-release"
import type { SecurityAuditReport } from "../../src/security"
import type { UsageSummary } from "../../src/usage/types"
import type { FluxEvent } from "../../src/flux"

function makeRouteEvent(params: {
  timestamp: string
  surface: "cli" | "orchestration" | "gateway"
  kind: "runtime.opencode.route.selected" | "runtime.opencode.route.fallback"
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
      reason: params.kind === "runtime.opencode.route.selected" ? "default_primary" : "forced_legacy",
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
      : [{ severity: "error", code: "broken", message: "broken", remediation: "fix" }],
    alerts: [],
    metrics: {
      checkedCount: 1,
      findingCount: ok ? 0 : 1,
      alertCount: 0,
    },
  }
}

function makeUsageSummary(): UsageSummary {
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
  }
}

function makeDocs(): V3ReleaseDocCheck[] {
  return [
    { id: "runtime-rollout", label: "OpenCode runtime rollout", path: "docs/architecture/opencode-runtime-rollout.md", exists: true },
    { id: "v3-release-readiness", label: "V3 release readiness", path: "docs/architecture/v3-release-readiness.md", exists: true },
    { id: "investing-eval-gates", label: "Investing eval gates", path: "docs/architecture/investing-eval-gates.md", exists: true },
    { id: "v3-rollout-plan", label: "V3 rollout plan", path: "docs/architecture/v3-rollout-plan.md", exists: true },
  ]
}

function makeReleaseReport(ready: boolean) {
  const runtimeRollout = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-15T12:00:00.000Z"), {
    routeEvents: ready
      ? [
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
        ]
      : [
          makeRouteEvent({
            timestamp: "2026-03-15T11:05:00.000Z",
            surface: "gateway",
            kind: "runtime.opencode.route.fallback",
          }),
        ],
  })

  return buildV3ReleaseReport({
    generatedAt: new Date("2026-03-15T12:30:00.000Z"),
    memoryStats: {},
    mesh: {
      totalAgents: 9,
      maxAgents: 15,
      crossDomainLinks: 4,
      withinCapacity: true,
    },
    samplePlanSteps: 3,
    runtimeRollout,
    runtimeGate: buildOpenCodeRuntimeReleaseGate(runtimeRollout),
    security: makeSecurityReport(ready),
    nodePolicy: { enabled: false, securityMode: "deny" },
    nodeStats: { active: 0, revoked: 0, total: 0 },
    usageSummary: makeUsageSummary(),
    docs: makeDocs(),
  })
}

async function withRolloutEnv<T>(fn: (root: string) => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalState = process.env.ZEE_V3_ROLLOUT_STATE_FILE
  const originalEnv = process.env.ZEE_V3_ROLLOUT_ENV_FILE
  process.env.ZEE_V3_ROLLOUT_STATE_FILE = path.join(dir.path, "v3-rollout.json")
  process.env.ZEE_V3_ROLLOUT_ENV_FILE = path.join(dir.path, "daemon.env")

  try {
    return await fn(dir.path)
  } finally {
    if (originalState === undefined) delete process.env.ZEE_V3_ROLLOUT_STATE_FILE
    else process.env.ZEE_V3_ROLLOUT_STATE_FILE = originalState

    if (originalEnv === undefined) delete process.env.ZEE_V3_ROLLOUT_ENV_FILE
    else process.env.ZEE_V3_ROLLOUT_ENV_FILE = originalEnv
  }
}

describe("v3 rollout plan", () => {
  test("applyV3RolloutStage writes managed daemon flags for canary", async () => {
    await withRolloutEnv(async () => {
      const report = await applyV3RolloutStage({
        stage: "canary",
        actor: "release-manager",
        reason: "Start CLI canary.",
        releaseReport: makeReleaseReport(true),
      })

      const envBody = readFileSync(process.env.ZEE_V3_ROLLOUT_ENV_FILE!, "utf-8")
      expect(report.state.currentStage).toBe("canary")
      expect(report.nextRecommendedStage).toBe("internal")
      expect(report.managedEnv.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES).toBe("orchestration,gateway")
      expect(envBody).toContain("export ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES=orchestration,gateway")
      expect(report.state.history[0]).toMatchObject({
        action: "apply",
        actor: "release-manager",
      })
    })
  })

  test("applyV3RolloutStage blocks promotion when the release report is not ready", async () => {
    await withRolloutEnv(async () => {
      await expect(
        applyV3RolloutStage({
          stage: "canary",
          actor: "release-manager",
          reason: "Should be blocked.",
          releaseReport: makeReleaseReport(false),
        }),
      ).rejects.toThrow("blocked")
    })
  })

  test("rollbackV3Rollout pins all surfaces to legacy", async () => {
    await withRolloutEnv(async () => {
      await applyV3RolloutStage({
        stage: "canary",
        actor: "release-manager",
        reason: "Start CLI canary.",
        releaseReport: makeReleaseReport(true),
      })

      const report = await rollbackV3Rollout({
        actor: "sre-owner",
        reason: "Parity breach on gateway.",
        releaseReport: makeReleaseReport(false),
      })

      const envBody = readFileSync(process.env.ZEE_V3_ROLLOUT_ENV_FILE!, "utf-8")
      expect(report.state.currentStage).toBe("paused")
      expect(report.managedEnv.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES).toBe("cli,orchestration,gateway")
      expect(envBody).toContain("export ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK=true")
      expect(report.state.history[0]).toMatchObject({
        action: "rollback",
        actor: "sre-owner",
      })
    })
  })
})
