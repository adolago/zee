# ADR-003: Tool System

## Status

Accepted (Implemented)

## Context

`agent-core` exposes a privileged tool surface (file I/O, bash, MCP, gateway calls, etc.). Tools must:

- Be discoverable and type-safe (schemas)
- Enforce permission checks consistently
- Produce structured results and audit-friendly traces
- Support streaming and batching depending on the active surface

## Decision

Implement a structured tool system with:

1. **Declarative tool definitions** with schemas and stable IDs.
2. **Central registry** that resolves tool IDs to implementations.
3. **Unified execution pipeline** that:
   - validates inputs
   - evaluates permissions
   - executes the tool
   - records tool start/end events for surfaces

Two tool surfaces exist by design:

- **Engine tools** (`packages/agent-core/src/tool/`): used by the CLI/TUI/daemon runtime.
- **MCP tools** (`src/mcp/`): MCP server tool definitions with sandbox-aware path validation.

## Consequences

### Positive

- Tools can be tested in isolation and audited (schemas + deterministic behavior).
- Permission evaluation is consistent and not re-implemented per tool.
- Surfaces can choose how much tool detail to render.

### Negative

- Some tools require special-case sandbox/path rules (file and glob tools).
- Dual tool surfaces (engine + MCP) require keeping IDs and semantics aligned.

## Implemented By (Evidence)

- Engine tool definitions + registry: `packages/agent-core/src/tool/`, `packages/agent-core/src/tool/registry.ts`
- Tool definition helper: `packages/agent-core/src/tool/tool.ts`
- MCP tool definitions: `src/mcp/builtin/`, `src/mcp/domain/`
- Tool tests: `packages/agent-core/test/tool/`

