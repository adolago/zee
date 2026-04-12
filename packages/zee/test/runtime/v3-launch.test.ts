import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  buildOpenCodeRuntimeReleaseGate,
  buildOpenCodeRuntimeRolloutReport,
  type OpenCodeRuntimeRouteEvent,
} from "../../src/runtime/opencode-rollout"
import { applyV3RolloutStage } from "../../src/runtime/v3-rollout"
import { buildV3ReleaseReport, type V3ReleaseDocCheck } from "../../src/runtime/v3-release"
import { goLiveV3Launch, recordV3LaunchSignoff } from "../../src/runtime/v3-launch"
import type { SecurityAuditReport } from "../../src/security"

function makeRouteEvent(params: {
  timestamp: string
  surface: "cli" | "orchestration" | "gateway"
  kind: "runtime.opencode.route.selected" | "runtime.opencode.route.fallback"
}): OpenCodeRuntimeRouteEvent {
  return {
    timestamp: new Date(params.timestamp).getTime(),
    kind: params.kind,
    metadata: {
      surface: params.surface,
      route: params.kind === "runtime.opencode.route.selected" ? "opencode_primary" : "legacy_fallback",
      reason: params.kind === "runtime.opencode.route.selected" ? "default_primary" : "forced_legacy",
    },
  }
}

function makeSecurityReport(): SecurityAuditReport {
  return {
    ok: true,
    errors: 0,
    warnings: 0,
    checked: ["gateway.controlUi.auth.required"],
    findings: [],
    alerts: [],
    metrics: {
      checkedCount: 1,
      findingCount: 0,
      alertCount: 0,
    },
  }
}

function makeDocs(): V3ReleaseDocCheck[] {
  return [
    { id: "runtime-rollout", label: "OpenCode runtime rollout", path: "docs/architecture/opencode-runtime-rollout.md", exists: true },
    { id: "v3-release-readiness", label: "V3 release readiness", path: "docs/architecture/v3-release-readiness.md", exists: true },
    { id: "investing-eval-gates", label: "Investing eval gates", path: "docs/architecture/investing-eval-gates.md", exists: true },
    { id: "v3-rollout-plan", label: "V3 rollout plan", path: "docs/architecture/v3-rollout-plan.md", exists: true },
    { id: "v3-launch-playbook", label: "V3 launch playbook", path: "docs/architecture/v3-launch-playbook.md", exists: true },
  ]
}

function makeReleaseReport() {
  const runtimeRollout = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-15T12:00:00.000Z"), {
    routeEvents: [
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
    security: makeSecurityReport(),
    nodePolicy: { enabled: false, securityMode: "deny" },
    nodeStats: { active: 0, revoked: 0, total: 0 },
    docs: makeDocs(),
  })
}

async function withLaunchEnv<T>(fn: () => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalRolloutState = process.env.ZEE_V3_ROLLOUT_STATE_FILE
  const originalRolloutEnv = process.env.ZEE_V3_ROLLOUT_ENV_FILE
  const originalLaunchState = process.env.ZEE_V3_LAUNCH_STATE_FILE
  process.env.ZEE_V3_ROLLOUT_STATE_FILE = path.join(dir.path, "v3-rollout.json")
  process.env.ZEE_V3_ROLLOUT_ENV_FILE = path.join(dir.path, "daemon.env")
  process.env.ZEE_V3_LAUNCH_STATE_FILE = path.join(dir.path, "v3-launch.json")

  try {
    return await fn()
  } finally {
    if (originalRolloutState === undefined) delete process.env.ZEE_V3_ROLLOUT_STATE_FILE
    else process.env.ZEE_V3_ROLLOUT_STATE_FILE = originalRolloutState

    if (originalRolloutEnv === undefined) delete process.env.ZEE_V3_ROLLOUT_ENV_FILE
    else process.env.ZEE_V3_ROLLOUT_ENV_FILE = originalRolloutEnv

    if (originalLaunchState === undefined) delete process.env.ZEE_V3_LAUNCH_STATE_FILE
    else process.env.ZEE_V3_LAUNCH_STATE_FILE = originalLaunchState
  }
}

async function promoteToGeneral() {
  const releaseReport = makeReleaseReport()
  await applyV3RolloutStage({ stage: "canary", actor: "release-manager", reason: "canary", releaseReport })
  await applyV3RolloutStage({ stage: "internal", actor: "release-manager", reason: "internal", releaseReport })
  await applyV3RolloutStage({ stage: "broad", actor: "release-manager", reason: "broad", releaseReport })
  return applyV3RolloutStage({ stage: "general", actor: "release-manager", reason: "general", releaseReport })
}

describe("v3 launch checklist", () => {
  test("recordV3LaunchSignoff tracks owner approvals", async () => {
    await withLaunchEnv(async () => {
      const releaseReport = makeReleaseReport()
      const rolloutReport = await promoteToGeneral()

      const report = await recordV3LaunchSignoff({
        owner: "release-manager",
        actor: "artur",
        note: "Release report is green.",
        releaseReport,
        rolloutReport,
      })

      expect(report.signoffs).toHaveLength(1)
      expect(report.readyForLaunch).toBe(false)
      expect(report.checklist.find((item) => item.id === "signoff.release-manager")?.ok).toBe(true)
      expect(report.checklist.find((item) => item.id === "signoff.sre-owner")?.ok).toBe(false)
    })
  })

  test("goLiveV3Launch blocks when checklist is incomplete", async () => {
    await withLaunchEnv(async () => {
      const releaseReport = makeReleaseReport()
      const rolloutReport = await promoteToGeneral()

      await expect(
        goLiveV3Launch({
          actor: "program-lead",
          reason: "Should be blocked.",
          releaseReport,
          rolloutReport,
        }),
      ).rejects.toThrow("incomplete")
    })
  })

  test("goLiveV3Launch succeeds after rollout is general and all owners approve", async () => {
    await withLaunchEnv(async () => {
      const releaseReport = makeReleaseReport()
      const rolloutReport = await promoteToGeneral()

      await recordV3LaunchSignoff({
        owner: "release-manager",
        actor: "artur",
        note: "Release report is green.",
        releaseReport,
        rolloutReport,
      })
      await recordV3LaunchSignoff({
        owner: "sre-owner",
        actor: "artur",
        note: "Rollback path is ready.",
        releaseReport,
        rolloutReport,
      })
      await recordV3LaunchSignoff({
        owner: "program-lead",
        actor: "artur",
        note: "Go-live approved.",
        releaseReport,
        rolloutReport,
      })

      const report = await goLiveV3Launch({
        actor: "artur",
        reason: "Final launch approval.",
        releaseReport,
        rolloutReport,
      })

      expect(report.readyForLaunch).toBe(true)
      expect(report.launched).toBe(true)
      expect(report.state.launchedAt).toBeTruthy()
      expect(report.goLive.allowed).toBe(true)
      expect(report.checklist.every((item) => item.ok)).toBe(true)
    })
  })
})
