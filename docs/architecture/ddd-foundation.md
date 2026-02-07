# DDD Foundation (v3 Phase 1)

Tracks issue: `adolago/agent-core#200`

This document defines the Phase 1 architectural boundaries for agent-core and how they are enforced.

## Bounded Contexts

### Core Kernel (`packages/agent-core/`)
The engine: CLI/TUI, daemon/server, sessions, tools, surfaces, and runtime plugin loading.

### Shared Runtime (`src/`)
Shared modules consumed by the kernel and bundled into the distributable when required:

- `src/awareness/`: dynamic system prompt helpers
- `src/config/`: shared config defaults and helpers
- `src/domain/`: persona domain tools (Zee/Stanley/Johny)
- `src/mcp/`: MCP layer (servers, registry, permission helpers)
- `src/memory/`: unified memory layer
- `src/personas/`: persona orchestration/types
- `src/swarm/`: swarm coordination (queen/workers/SPARC)
- `src/theme/`: shared theme system

### Gateways / Transports (`packages/personas/*`)
Persona-specific gateways (e.g., Zee messaging transport). These should integrate via stable/public interfaces and avoid reaching into kernel internals.

## Boundary Rules

Boundaries are enforced with `dependency-cruiser` via:

```bash
bun run boundaries:check
```

### Enforced Today

1. `packages/agent-core/src/**` must not import from `packages/personas/**`.
2. Cycles are tolerated for now within the kernel+shared-runtime boundary (tight coupling exists today), but cross-package imports are restricted.

### Intent (Follow-Up Work)

1. Reduce coupling between `packages/agent-core/src` and `src/` by introducing narrower public entrypoints in `src/*/index.ts` and migrating callers to `@root/*`.
2. Introduce a cycle-free "core services" layer (logging/config/bus) to break the largest dependency knots.

