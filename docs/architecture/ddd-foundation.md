# DDD Foundation (v3 Phase 1)

Tracks issue: `adolago/zee#200`

This document defines the Phase 1 architectural boundaries for zee and how they are enforced.

## Bounded Contexts

### Core Kernel (`packages/zee/`)
The engine: CLI/TUI, daemon/server, sessions, tools, surfaces, and runtime plugin loading.

### Shared Runtime (`src/`)
Shared modules consumed by the kernel and bundled into the distributable when required:

- `src/awareness/`: dynamic system prompt helpers
- `src/config/`: shared config defaults and helpers
- `src/domain/`: Zee domain tools
- `src/mcp/`: MCP layer (servers, registry, permission helpers)
- `src/memory/`: unified memory layer
- `src/swarm/`: swarm coordination (queen/workers/SPARC)
- `src/theme/`: shared theme system

## Boundary Rules

Boundaries are enforced with `dependency-cruiser` via:

```bash
bun run boundaries:check
```

### Enforced Today

1. Cycles are tolerated for now within the kernel+shared-runtime boundary (tight coupling exists today), but cross-package imports are restricted.

### Intent (Follow-Up Work)

1. Reduce coupling between `packages/zee/src` and `src/` by introducing narrower public entrypoints in `src/*/index.ts` and migrating callers to `@root/*`.
2. Introduce a cycle-free "core services" layer (logging/config/bus) to break the largest dependency knots.

