# V3 Release Readiness

This document defines the executable v3 gate introduced by `zee v3`.

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
  - combines memory, swarm mesh, agentic-flow, and deep security audit checks

## Operational usage
- Inspect readiness:
  - `zee v3 status`
- Produce/execute decomposed workflow:
  - `zee v3 plan "objective text" --steps 6 --execute`
- Enforce CI-like strict gate:
  - `zee v3 release --strict`

## Security tie-in
- v3 release gate consumes deep security audit output.
- Node-client exposure is included in release readiness decisions.
