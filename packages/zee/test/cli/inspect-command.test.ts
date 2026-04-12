import { describe, expect, test } from "bun:test"
import {
  buildOpenCodeRuntimeContractReport,
  summarizeOpenCodeRuntimeContract,
} from "../../src/runtime/opencode-contract"
import {
  buildOpenCodeRuntimeRolloutReport,
  buildOpenCodeRuntimeReleaseGate,
  summarizeOpenCodeRuntimeRollout,
  type OpenCodeRuntimeRouteEvent,
} from "../../src/runtime/opencode-rollout"
import { buildPiMonoCompatReport, summarizePiMonoCompatReport } from "../../src/runtime/pimono-compat"
import { reloadFlags } from "../../src/flag/flag"

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

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

async function withRolloutEnv<T>(
  env: Partial<Record<"ZEE_RUNTIME_OPENCODE_SURFACES" | "ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES", string | undefined>>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const originalEnable = process.env.ZEE_RUNTIME_OPENCODE_SURFACES
  const originalLegacy = process.env.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES
  const originalFallback = process.env.ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK

  if ("ZEE_RUNTIME_OPENCODE_SURFACES" in env) setEnv("ZEE_RUNTIME_OPENCODE_SURFACES", env.ZEE_RUNTIME_OPENCODE_SURFACES)
  if ("ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES" in env) {
    setEnv("ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES", env.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES)
  }
  reloadFlags()

  try {
    return await fn()
  } finally {
    setEnv("ZEE_RUNTIME_OPENCODE_SURFACES", originalEnable)
    setEnv("ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES", originalLegacy)
    setEnv("ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK", originalFallback)
    reloadFlags()
  }
}

describe("inspect command helpers", () => {
  test("OpenCode runtime contract report inventories CLI, orchestration, and gateway surfaces", () => {
    const report = buildOpenCodeRuntimeContractReport(new Date("2026-03-14T12:00:00.000Z"))

    expect(report.contractId).toBe("opencode-runtime-core")
    expect(report.contractVersion).toBe(1)
    expect(report.generatedAt).toBe("2026-03-14T12:00:00.000Z")
    expect(report.surfaces.map((surface) => surface.surface)).toEqual(["cli", "orchestration", "gateway"])
    expect(report.metrics.surfaceCount).toBe(3)
    expect(report.metrics.entryPointCount).toBe(11)
    expect(report.metrics.transportCount).toBe(5)
    expect(report.metrics.gatewayPresent).toBe(true)
    expect(report.metrics.orchestrationPresent).toBe(true)
  })

  test("OpenCode runtime contract summary mentions all surfaces and metrics", () => {
    const summary = summarizeOpenCodeRuntimeContract(
      buildOpenCodeRuntimeContractReport(new Date("2026-03-14T12:00:00.000Z")),
    )

    expect(summary).toContain("OpenCode runtime contract v1")
    expect(summary).toContain("- cli:")
    expect(summary).toContain("- orchestration:")
    expect(summary).toContain("- gateway:")
    expect(summary).toContain("metrics entryPoints=11 transports=5")
  })

  test("OpenCode runtime rollout report defaults all contract surfaces to the primary route", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_SURFACES: undefined,
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: undefined,
      },
      () => {
        const report = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-14T12:15:00.000Z"), {
          routeEvents: [],
        })

        expect(report.reportId).toBe("opencode-runtime-rollout")
        expect(report.roadmapIssue).toBe(487)
        expect(report.defaultRoute).toBe("opencode_primary")
        expect(report.surfaces.map((surface) => surface.route)).toEqual([
          "opencode_primary",
          "opencode_primary",
          "opencode_primary",
        ])
        expect(report.parityWindow.hours).toBe(24)
        expect(report.parity.routeEvents).toBe(0)
        expect(report.parity.breaches).toHaveLength(0)
        expect(report.parity.releaseReady).toBe(true)
        expect(report.metrics.primarySurfaceCount).toBe(3)
        expect(report.metrics.legacySurfaceCount).toBe(0)
        expect(report.metrics.routeEventCount).toBe(0)
        expect(report.metrics.breachCount).toBe(0)
      },
    )
  })

  test("OpenCode runtime rollout summary reflects parity breaches and rollback guidance", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: undefined,
      },
      () => {
        const summary = summarizeOpenCodeRuntimeRollout(
          buildOpenCodeRuntimeRolloutReport(new Date("2026-03-14T12:20:00.000Z"), {
            routeEvents: [
              makeRouteEvent({
                timestamp: "2026-03-14T11:45:00.000Z",
                surface: "cli",
                kind: "runtime.opencode.route.selected",
              }),
              makeRouteEvent({
                timestamp: "2026-03-14T11:50:00.000Z",
                surface: "gateway",
                kind: "runtime.opencode.route.fallback",
              }),
            ],
          }),
        )

        expect(summary).toContain("OpenCode runtime rollout v1")
        expect(summary).toContain("parity: window=24h route-events=2 fallback=1")
        expect(summary).toContain("gateway: opencode_primary (default_primary) selected=0 fallback=1")
        expect(summary).toContain("status=breach")
        expect(summary).toContain("rollback: recommended")
      },
    )
  })

  test("OpenCode runtime release gate blocks when parity breaches are present", () => {
    const report = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-14T12:20:00.000Z"), {
      routeEvents: [
        makeRouteEvent({
          timestamp: "2026-03-14T11:45:00.000Z",
          surface: "cli",
          kind: "runtime.opencode.route.selected",
        }),
        makeRouteEvent({
          timestamp: "2026-03-14T11:50:00.000Z",
          surface: "gateway",
          kind: "runtime.opencode.route.fallback",
        }),
      ],
    })
    const gate = buildOpenCodeRuntimeReleaseGate(report)

    expect(gate.id).toBe("runtime.opencode-parity")
    expect(gate.ok).toBe(false)
    expect(gate.breachCount).toBe(1)
    expect(gate.details).toContain("breaches=1")
    expect(gate.details).toContain("forced-legacy=0")
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
    expect(report.policy.removalChecklist.items).toHaveLength(4)
    expect(report.boundaries.map((boundary) => boundary.id)).toEqual([
      "server.llm.pi-ai-bridge",
      "server.auth.api-key-payload",
      "agent.config.tools-alias",
      "orchestration.pi-agent-event-schema",
    ])
    expect(report.metrics.boundaryCount).toBe(4)
    expect(report.metrics.activeTemporaryCount).toBe(2)
    expect(report.metrics.deprecatedLiveCount).toBe(2)
    expect(report.metrics.retiredBlockedCount).toBe(0)
  })

  test("pi-mono compatibility summary includes statuses and exit paths", () => {
    const summary = summarizePiMonoCompatReport(buildPiMonoCompatReport(new Date("2026-03-14T12:30:00.000Z")))

    expect(summary).toContain("pi-mono compatibility shim inventory v1")
    expect(summary).toContain("hard-stop=2026-04-30")
    expect(summary).toContain("checklist: approved=2026-03-15 completed=4/4")
    expect(summary).toContain("server.llm.pi-ai-bridge [active_temporary] exit=")
    expect(summary).toContain("agent.config.tools-alias [deprecated_live] exit=")
  })
})
