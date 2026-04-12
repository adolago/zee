import { describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import {
  buildOpenCodeRuntimeReleaseGate,
  buildOpenCodeRuntimeRolloutReport,
  recordOpenCodeRuntimeRoute,
  resolveOpenCodeRuntimeRoute,
  resolveOpenCodeRuntimeSurface,
  type OpenCodeRuntimeRouteEvent,
} from "../../src/runtime/opencode-rollout"

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

async function withRolloutEnv<T>(
  env: Partial<
    Record<
      | "ZEE_RUNTIME_OPENCODE_SURFACES"
      | "ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES"
      | "ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK",
      string | undefined
    >
  >,
  fn: () => Promise<T> | T,
): Promise<T> {
  const originalEnable = process.env.ZEE_RUNTIME_OPENCODE_SURFACES
  const originalLegacy = process.env.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES
  const originalFallback = process.env.ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK

  if ("ZEE_RUNTIME_OPENCODE_SURFACES" in env) setEnv("ZEE_RUNTIME_OPENCODE_SURFACES", env.ZEE_RUNTIME_OPENCODE_SURFACES)
  if ("ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES" in env) {
    setEnv("ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES", env.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES)
  }
  if ("ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK" in env) {
    setEnv("ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK", env.ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK)
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

describe("OpenCode runtime rollout", () => {
  test("resolveOpenCodeRuntimeRoute defaults to the OpenCode primary path", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_SURFACES: undefined,
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: undefined,
      },
      () => {
        const selection = resolveOpenCodeRuntimeRoute("cli")
        expect(selection.route).toBe("opencode_primary")
        expect(selection.reason).toBe("default_primary")
        expect(selection.enabledSurfaces).toEqual(["cli", "orchestration", "gateway"])
      },
    )
  })

  test("resolveOpenCodeRuntimeRoute respects forced legacy surfaces", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: "orchestration",
        ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK: "false",
      },
      () => {
        const selection = resolveOpenCodeRuntimeRoute("orchestration")
        expect(selection.route).toBe("legacy_fallback")
        expect(selection.reason).toBe("forced_legacy")
        expect(selection.allowLegacyFallback).toBe(false)
      },
    )
  })

  test("resolveOpenCodeRuntimeSurface maps daemon and messaging contexts to rollout surfaces", () => {
    expect(resolveOpenCodeRuntimeSurface({ client: "daemon" })).toBe("orchestration")
    expect(resolveOpenCodeRuntimeSurface({ sessionSurface: "whatsapp" })).toBe("gateway")
    expect(resolveOpenCodeRuntimeSurface({ client: "cli", sessionSurface: "api" })).toBe("cli")
  })

  test("recordOpenCodeRuntimeRoute returns selected and fallback decisions", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: "gateway",
      },
      () => {
        const selected = recordOpenCodeRuntimeRoute({
          surface: "cli",
          sessionID: "session_cli",
          messageID: "message_cli",
        })
        const fallback = recordOpenCodeRuntimeRoute({
          surface: "gateway",
          sessionID: "session_gateway",
          messageID: "message_gateway",
        })

        expect(selected.route).toBe("opencode_primary")
        expect(fallback.route).toBe("legacy_fallback")
      },
    )
  })

  test("buildOpenCodeRuntimeRolloutReport computes parity counters and breach details from route events", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_SURFACES: undefined,
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: undefined,
      },
      () => {
        const report = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-15T12:00:00.000Z"), {
          routeEvents: [
            makeRouteEvent({
              timestamp: "2026-03-15T11:00:00.000Z",
              surface: "cli",
              kind: "runtime.opencode.route.selected",
            }),
            makeRouteEvent({
              timestamp: "2026-03-15T11:05:00.000Z",
              surface: "gateway",
              kind: "runtime.opencode.route.fallback",
            }),
          ],
        })

        expect(report.parity.routeEvents).toBe(2)
        expect(report.parity.selectedEvents).toBe(1)
        expect(report.parity.fallbackEvents).toBe(1)
        expect(report.parity.breaches).toHaveLength(1)
        expect(report.parity.breaches[0]).toMatchObject({
          surface: "gateway",
          fallbackEvents: 1,
          maxFallbackEvents: 0,
        })
        expect(report.rollback.recommended).toBe(true)
        expect(report.metrics.breachCount).toBe(1)
      },
    )
  })

  test("buildOpenCodeRuntimeReleaseGate passes only when parity is clean", () => {
    const cleanReport = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-15T12:00:00.000Z"), {
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
    const cleanGate = buildOpenCodeRuntimeReleaseGate(cleanReport)
    expect(cleanGate.ok).toBe(true)
    expect(cleanGate.breachCount).toBe(0)

    const breachReport = buildOpenCodeRuntimeRolloutReport(new Date("2026-03-15T12:00:00.000Z"), {
      routeEvents: [
        makeRouteEvent({
          timestamp: "2026-03-15T11:05:00.000Z",
          surface: "gateway",
          kind: "runtime.opencode.route.fallback",
        }),
      ],
    })
    const breachGate = buildOpenCodeRuntimeReleaseGate(breachReport)
    expect(breachGate.ok).toBe(false)
    expect(breachGate.details).toContain("fallback=1")
    expect(breachGate.details).toContain("breaches=1")
  })
})
