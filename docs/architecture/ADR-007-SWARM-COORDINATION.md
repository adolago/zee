# ADR-007: Swarm Coordination Mesh

## Status

Accepted (Implemented)

## Context

`agent-core` coordinates multiple agents/personas and background workers (drones). Coordination requires:

- a consistent topology (queen/worker)
- message routing and task assignment
- isolation boundaries between domains/personas

## Decision

Implement swarm coordination as a hierarchical queen/worker mesh:

1. **Queen** is the orchestrator: scheduling, routing, high-level planning.
2. **Workers** are specialized executors: tool execution, background jobs, or persona-specific sub-agents.
3. **Shared types** define message envelopes, tasks, and topology constraints.

## Consequences

### Positive

- Provides an explicit place to evolve multi-agent orchestration without leaking complexity into the session loop.
- Enables background work without blocking interactive surfaces.

### Negative

- Requires careful observability and failure handling to avoid “silent stalls”.
- Coordination bugs can look like model/tool bugs; tests and tracing are essential.

## Implemented By (Evidence)

- Swarm system: `src/swarm/` (queen, worker, planner, SPARC)
- Orchestration integration: `packages/agent-core/src/orchestration/`
- Tests: `src/swarm/**/*.test.ts` (where present), `packages/agent-core/test/integration/` (coordination flows)

