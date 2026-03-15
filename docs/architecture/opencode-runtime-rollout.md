# OpenCode Runtime Rollout

This document is the operator-facing control surface for issue `#486`: switching Zee's primary execution path to the OpenCode runtime with staged enablement, explicit rollback, and telemetry.

## Source Of Truth

Generate the current rollout report from the packaged CLI:

```bash
cd packages/zee
bun run --conditions=browser ./src/index.ts inspect runtime-rollout --json
```

For a concise human-readable summary:

```bash
cd packages/zee
bun run --conditions=browser ./src/index.ts inspect runtime-rollout --no-json
```

## Control Flags

- `ZEE_RUNTIME_OPENCODE_SURFACES`
  Comma-separated list of surfaces that should use the OpenCode primary route. Defaults to `cli,orchestration,gateway`.
- `ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES`
  Comma-separated list of surfaces pinned to the legacy fallback path even if they appear in the primary list.
- `ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK`
  Boolean gate recorded in telemetry so operators can distinguish staged fallback mode from a hard cutover.

## Surface Mapping

- `zee run` now creates sessions with `surface: "cli"`, so standard CLI prompts report against the CLI runtime surface.
- Daemon workers execute `zee prompt --no-tui` and set `ZEE_CLIENT=daemon`, so orchestration traffic resolves to the orchestration rollout surface.
- Messaging sessions still carry Zee-native session surfaces (`whatsapp`, `telegram`), which resolve to the gateway rollout surface.
- The internal bridge route in `packages/zee/src/server/route/llm.ts` emits gateway rollout telemetry even though it bypasses normal session runtime creation.

## Rollback

To force all tracked surfaces back onto the legacy path:

```bash
export ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES=cli,orchestration,gateway
```

To stage only CLI on the OpenCode primary route while keeping other surfaces on fallback:

```bash
export ZEE_RUNTIME_OPENCODE_SURFACES=cli
export ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES=orchestration,gateway
```

## Telemetry

- Bus event: `runtime.opencode-rollout.inspected`
- Flux kinds:
  - `runtime.opencode.route.selected`
  - `runtime.opencode.route.fallback`
- Report metrics:
  - `surfaceCount`
  - `primarySurfaceCount`
  - `legacySurfaceCount`
  - `forcedLegacySurfaceCount`
  - `allowLegacyFallback`
