# ADR-002: Agent-Core Architecture

## Status

Accepted (Implemented)

## Context

`agent-core` is a monorepo that combines:

- A privileged local CLI/TUI + daemon runtime (the engine)
- A Personas system (Zee, Stanley, Johny)
- Memory (Qdrant + local fallbacks)
- A messaging gateway (Zee)
- A Rust subsystem for Stanley (`packages/stanley-core/`)

The core architectural requirement is to keep the engine stable and testable while allowing domain/persona-specific features to evolve without turning the core into a monolith.

## Decision

Adopt a modular, microkernel-style architecture with explicit boundaries:

1. **Engine package** (`packages/agent-core/`): core runtime, server, session management, tools, permissions, plugins, and SDK generation.
2. **Domain/persona modules** (repo root `src/` and `packages/personas/*`): persona-specific features and gateway integrations.
3. **Extension points**:
   - Plugin system (hooks/tools/auth providers)
   - Surface abstraction (CLI/GUI/messaging capability adaptation)

### Boundary Rules (Pragmatic)

- `packages/agent-core/src/**` must not depend on `packages/personas/**` at runtime, except via build-time bundling boundaries (dist packaging).
- Cross-cutting shared logic must live in the engine (`packages/agent-core/src/**`) or in explicit shared packages under `packages/*`.
- Persona/gateway code remains under `packages/personas/zee/` and is bundled into dist as an asset dependency (not as a runtime import graph).

## Consequences

### Positive

- Keeps the engine testable (`packages/agent-core/test/**`) without requiring messaging gateways or external services.
- Enables separate release cadence for persona packages while retaining a single installable CLI.
- Makes “power surfaces” (PTY/MCP/tools) auditable and easier to harden.

### Negative

- Some features require careful bundling and path resolution in dist builds.
- Boundary enforcement requires explicit tests/automation (it will drift otherwise).

## Implemented By (Evidence)

- Engine: `packages/agent-core/src/`
- SDK surface used by UI: `packages/agent-core/src/pkg/sdk/`
- Personas/gateway: `packages/personas/zee/`
- Domain modules + memory: `src/domain/`, `src/memory/`, `src/swarm/`
- Tests: `packages/agent-core/test/`, `packages/personas/zee/src/**.test.ts`

