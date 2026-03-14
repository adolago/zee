# pi-mono Compatibility Shim Inventory

Issue: `#474` (`#488`, `#489`, `#490`)

This inventory is the source of truth for the remaining pi-mono-shaped compatibility boundaries that still exist in Zee while the runtime migrates toward OpenCode.

## Deprecation Policy

- No new pi-mono-shaped runtime surfaces may land after `2026-03-15` unless they are registered in this inventory with telemetry and a dated removal plan.
- Roadmap window `M1 architecture lock`: `2026-03-08` through `2026-03-22`.
- Roadmap window `M2 compatibility layer`: `2026-03-23` through `2026-04-30`.
- Hard stop date: `2026-04-30`.
  By that date, every remaining `active_temporary` or `deprecated_live` boundary must either be removed or moved behind a Zee-owned versioned adapter.

## Approved Removal Checklist

- [x] `#488` published a single inventory of live pi-mono runtime boundaries.
- [x] `#489` added emitted telemetry for each live compatibility shim.
- [x] `#490` kept retired surfaces explicitly blocked instead of silently aliasing them forward.
- [x] `#490` established the no-new-legacy gate starting on `2026-03-15`.
- [x] `#474` records the roadmap windows and the `2026-04-30` hard stop in the inspectable runtime contract.

## Inspection Command

```bash
cd packages/zee
bun run --conditions=browser ./src/index.ts inspect shim-boundaries --json
```

Use `--no-json` for a compact operator summary.

## Warning And Telemetry Contract

- Live shim call sites emit a deprecation warning once per process when they are exercised.
- Shim usage is recorded in flux as `compat.shim.used` with `boundaryID`, `surface`, `boundaryKind`, and `boundaryStatus` metadata.
- The legacy auth payload and pi-ai bridge still emit their route-specific events in addition to the shared shim usage marker.

## Status Vocabulary

- `active_temporary`: live shim boundary that still carries legacy request/event semantics and must be removed or hidden behind the OpenCode adapter.
- `deprecated_live`: live compatibility alias still accepted for migration safety and scheduled for removal after client/config migration.
- `retired_blocked`: legacy surface is intentionally rejected or absent and should not be reintroduced as an implicit alias.

## Boundary Inventory

### 1. pi-ai LLM bridge

- Boundary id: `server.llm.pi-ai-bridge`
- Status: `active_temporary`
- Surface: `server`
- Kind: `http_bridge`
- Current boundary:
  `/v1/llm/stream` still accepts pi-ai/OpenClaw-shaped request payloads and emits pi-style `AssistantMessageEvent` SSE frames while normalizing execution through Zee's provider and AI SDK stack.
- Telemetry:
  `llm.bridge.stream.start`, `llm.bridge.stream.done`, `llm.bridge.stream.error`, `compat.shim.used`
- Exit path:
  Replace this route-level bridge once the OpenCode primary execution path lands and downstream callers stop depending on pi-ai event shapes.

### 2. Legacy auth wire payload

- Boundary id: `server.auth.api-key-payload`
- Status: `deprecated_live`
- Surface: `server`
- Kind: `payload_alias`
- Current boundary:
  The auth route still accepts `{ "api_key": "..." }` and rewrites it into Zee's `Auth.Info` model; SDK-generated client types preserve that shape for compatibility.
- Telemetry:
  `auth.legacy_payload.accepted`, `compat.shim.used`
- Exit path:
  Remove the alias once operator and SDK clients are migrated to `Auth.Info`.

### 3. Agent tools config alias

- Boundary id: `agent.config.tools-alias`
- Status: `deprecated_live`
- Surface: `agent`
- Kind: `config_alias`
- Current boundary:
  `agent.<name>.tools` booleans still translate into `PermissionNext` rules so pre-permission config continues to run during migration.
- Telemetry:
  `agent.legacy_tools_alias.used`, `compat.shim.used`
- Exit path:
  Delete the alias after operators migrate to permission-native agent config.

### 4. pi-agent orchestration event schema

- Boundary id: `orchestration.pi-agent-event-schema`
- Status: `active_temporary`
- Surface: `orchestration`
- Kind: `event_schema`
- Current boundary:
  daemon IPC and orchestration visuals still expose lifecycle event names inherited from the old pi-agent vocabulary.
- Telemetry:
  `orchestration.pi_agent_event_schema.used`, `compat.shim.used`
- Exit path:
  Keep the schema stable until OpenCode is primary, then either version it as a Zee-owned contract or translate it behind an adapter.

### 5. Retired persona ids

- Boundary id: `agent.persona-ids`
- Status: `retired_blocked`
- Surface: `agent`
- Kind: `retired_surface`
- Current boundary:
  legacy persona ids like `stanley` and `johny` no longer resolve as agents or valid `default_agent` values.
- Telemetry:
  not applicable; the stance is explicit rejection.
- Exit path:
  keep blocked.

### 6. Retired `/personas` endpoint

- Boundary id: `server.personas-endpoint`
- Status: `retired_blocked`
- Surface: `server`
- Kind: `retired_surface`
- Current boundary:
  `/personas` is intentionally absent from the public server contract and guarded by a public-contract test.
- Telemetry:
  not applicable; the stance is explicit rejection.
- Exit path:
  keep blocked.

## Scope Notes

- This inventory is intentionally limited to runtime-facing pi-mono migration boundaries and adjacent explicitly retired legacy surfaces.
- Other compatibility holdovers in the repo, such as heartbeat-path fallbacks or model env aliases, are not treated as pi-mono shim boundaries for `#488`.
