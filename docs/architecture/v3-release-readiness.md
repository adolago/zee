# V3 Release Readiness

This document defines the executable v3 gate introduced by `zee v3`.
The consolidated release report now closes `#518`.

## Implemented slices
- Memory unification:
  - `AgentDbMemoryService` wrapper (`packages/zee/src/memory/agentdb-service.ts`)
  - server memory route consumes AgentDB wrapper
- Swarm coordination:
  - hierarchical mesh coordinator with 15-agent capacity target
  - cross-domain link tracking and domain routing hooks
- Agentic-flow integration:
  - decomposition + orchestration bridge (`packages/zee/src/orchestration/agentic-flow-bridge.ts`)
  - plan persistence hook into memory
- CLI modernization:
  - `zee v3 status`
  - `zee v3 plan <objective> [--execute]`
  - `zee v3 release [--strict]`
- Release gate:
  - combines reliability, security, performance, and documentation checks into one report

## Operational usage
- Inspect readiness:
  - `zee v3 status`
- Produce/execute decomposed workflow:
  - `zee v3 plan "objective text" --steps 6 --execute`
- Enforce CI-like strict gate:
  - `zee v3 release --strict`
- Emit the full consolidated report:
  - `zee v3 release --json`

## Runtime parity tie-in
- `zee v3 status` and `zee v3 release` both embed the `inspect runtime-rollout` parity verdict.
- The runtime gate is `runtime.opencode-parity`.
- `zee v3 release` emits the same `runtime.opencode-rollout.inspected` bus telemetry used by the inspect command.
- The gate blocks release when:
  - any tracked surface is still pinned to legacy
  - any `runtime.opencode.route.fallback` traffic appears in the trailing `24h` parity window

## Security tie-in
- v3 release gate consumes deep security audit output.
- Node-client exposure is included in release readiness decisions.
- `zee v3 release` emits the same `security.audit.checked` / `security.audit.finding` telemetry as the deep audit commands.

## Consolidated Report Tie-in
- `zee v3 status` and `zee v3 release` now render the same `v3-release-gate` report.
- The report groups gates into:
  - `reliability`
  - `security`
  - `performance`
  - `docs`
- `zee v3 release` emits `release.v3.report` telemetry with failure counts and performance/doc metrics.
