import { describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { FluxRecorder } from "../../src/flux"
import {
  recordOpenCodeRuntimeRoute,
  resolveOpenCodeRuntimeRoute,
  resolveOpenCodeRuntimeSurface,
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

  test("recordOpenCodeRuntimeRoute emits selected and fallback flux events", async () => {
    await withRolloutEnv(
      {
        ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: "gateway",
      },
      () => {
        const selectedBefore = FluxRecorder.list({ kind: "runtime.opencode.route.selected" }).total
        const fallbackBefore = FluxRecorder.list({ kind: "runtime.opencode.route.fallback" }).total

        recordOpenCodeRuntimeRoute({
          surface: "cli",
          sessionID: "session_cli",
          messageID: "message_cli",
        })
        recordOpenCodeRuntimeRoute({
          surface: "gateway",
          sessionID: "session_gateway",
          messageID: "message_gateway",
        })

        expect(FluxRecorder.list({ kind: "runtime.opencode.route.selected" }).total).toBe(selectedBefore + 1)
        expect(FluxRecorder.list({ kind: "runtime.opencode.route.fallback" }).total).toBe(fallbackBefore + 1)
      },
    )
  })
})
