# OpenCode Runtime Inventory and Adapter Contract

This document closes the operator-facing documentation requirement for `adolago/zee#485`.

Source of truth:

```bash
cd packages/zee
bun run --conditions=browser ./src/index.ts inspect runtime-contract --json
```

The checked-in CLI contract lives in:

- `packages/zee/src/runtime/opencode-contract.ts`
- `packages/zee/src/cli/cmd/inspect.ts`

## Contract Summary

- Contract ID: `opencode-runtime-core`
- Contract version: `1`
- Upstream target: `sst/opencode`
- Rollout phase: `inventory`
- Default runtime mode: Zee-owned execution surfaces with an OpenCode-primary target runtime

The contract intentionally locks three runtime surfaces before rollout work starts:

1. CLI
2. Orchestration
3. Gateway

## CLI Surface

Objective:
Preserve Zee CLI session semantics while moving primary execution toward an OpenCode-aligned runtime.

Entry points:

- `packages/zee/src/index.ts` (`loadDaemonEnv`, `cli.parse`) for CLI bootstrap and command dispatch
- `packages/zee/src/cli/cmd/run.ts` (`RunCommand`) for `zee run`
- `packages/zee/src/cli/cmd/tui/attach.ts` (`AttachCommand`) and `packages/zee/src/cli/cmd/client.ts` (`ClientCommand`) for attached client/TUI flows
- `packages/zee/src/cli/cmd/serve.ts` (`ServeCommand`) and `packages/zee/src/server/server.ts` (`Server.listen`) for the HTTP runtime surface

Locked invariants:

- Workspace/config discovery stays Zee-native (`.zee/`, XDG paths, persona routing)
- Session and message identity remain Zee-owned
- Provider/model resolution remains Zee-owned
- CLI/TUI output and event stream shape remain Zee-compatible

Adapter responsibilities:

- Dispatch Zee commands into the OpenCode-backed runtime without renaming commands or flags
- Carry Zee session/message context across the adapter boundary
- Enforce Zee permission/tool policy before execution
- Normalize runtime output back into Zee rendering conventions

## Orchestration Surface

Objective:
Keep daemon orchestration stable while defining the adapter boundary for OpenCode-backed worker execution.

Entry points:

- `packages/zee/src/orchestration/daemon-ipc.ts` (`requestOrchestration`, `runTaskViaDaemon`) for the IPC client
- `src/daemon/ipc-server.ts` (`DaemonServer`) for the daemon IPC control plane
- `src/swarm/orchestrator.ts` (`Orchestrator`) and `src/swarm/queen.ts` (`Queen`) for worker/task lifecycle

Locked invariants:

- Socket protocol stays newline-delimited JSON
- Parent session/message IDs, task IDs, priority, and timeout remain explicit
- Event cursor ordering and event semantics remain stable
- Shutdown/draining remains Zee-owned

Adapter responsibilities:

- Translate Zee daemon requests into OpenCode-backed worker execution
- Preserve Zee worker/task lifecycle states
- Keep retry, interrupt, and timeout semantics visible in orchestration events
- Keep queue depth/worker/task snapshot APIs stable

## Gateway Surface

Objective:
Keep gateway-triggered execution and embedded runtime supervision stable while defining the OpenCode adapter seam.

Entry points:

- `packages/zee/src/cli/cmd/daemon.ts` (`GatewaySupervisor`) and `packages/zee/src/cli/cmd/always-on.ts` for gateway supervision
- `packages/zee/src/gateway/embedded-gateway.ts` (`startEmbeddedGateway`, `resolveGatewayRuntime`) for the embedded gateway runtime
- `packages/zee/src/gateway/ws-client.ts` (`GatewayWsClient`) for request/response WebSocket calls
- `packages/zee/src/server/route/gateway.ts` (`GatewayRoute`) for the HTTP bridge layer

Locked invariants:

- Embedded server and in-process client keep one resolved auth token source
- Daemon URL propagation stays explicit
- Missing gateway runtime degrades cleanly
- HTTP bridge and WS request mapping keep Zee session semantics

Adapter responsibilities:

- Supervise an OpenCode-backed execution path without moving lifecycle ownership out of Zee
- Route gateway-triggered execution through the adapter while keeping Zee method names stable
- Keep config snapshot/health inspection anchored in Zee-owned readers
- Preserve Zee session handoff when gateway traffic enters the assistant runtime

## Telemetry

Inspecting the contract emits the bus event:

- `runtime.opencode-contract.inspected`

Emitted metrics:

- `surfaceCount`
- `entryPointCount`
- `invariantCount`
- `capabilityCount`
- `transportCount`
- `gatewayPresent`
- `orchestrationPresent`

This telemetry is intended to make the inventory slice observable before `#486` switches the primary execution path.
