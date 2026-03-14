# pi-mono Compatibility Shim Inventory

Issue: `#488`

This inventory is the source of truth for the remaining pi-mono-shaped compatibility boundaries that still exist in Zee while the runtime migrates toward OpenCode.

## Inspection Command

```bash
cd packages/zee
bun run --conditions=browser ./src/index.ts inspect shim-boundaries --json
```

Use `--no-json` for a compact operator summary.

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
  `llm.bridge.stream.start`, `llm.bridge.stream.done`, `llm.bridge.stream.error`
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
  `auth.legacy_payload.accepted`
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
  missing today; `#489` should add shim call-site metrics before removal sequencing starts.
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
  missing today; the schema itself is still a compatibility contract.
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
