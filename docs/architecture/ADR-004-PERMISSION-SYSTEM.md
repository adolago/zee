# ADR-004: Permission System

## Status

Accepted (Implemented)

## Context

`agent-core` has tools that can:

- read/write files
- run shell commands
- invoke MCP servers
- schedule cron executions
- control gateway/messaging surfaces

These operations must be gated to prevent accidental or remote misuse, while still enabling fast local workflows.

## Decision

Adopt a permission model with:

1. **Mode-based defaults**:
   - `HOLD`: safe-by-default; prompts (or denies) on high-risk actions depending on surface capabilities.
   - `RELEASE`: trusted operator mode; auto-approves permission prompts (intentionally dangerous).
2. **Surface-aware permission resolution**:
   - interactive surfaces can prompt (CLI/GUI)
   - non-interactive messaging surfaces must rely on explicit configuration and allowlists
3. **Daemon HTTP authorization** when binding beyond loopback:
   - require HTTP auth for non-loopback binds
   - enforce scope-based authorization for privileged routes
4. **Allowlist-first policies** for the most powerful automation surfaces:
   - cron `toolInvoke` allowlist
   - server allowed directories for request-scoped directory overrides

## Consequences

### Positive

- Prevents common operator footguns for daemon deployments.
- Makes dangerous capabilities explicit and auditable.
- Supports messaging surfaces without interactive prompts (configuration-driven).

### Negative

- RELEASE mode remains root-equivalent: enabling it expands the trust boundary significantly.
- Adds configuration complexity (scopes, allowlists, surface rules).

## Implemented By (Evidence)

- Permission evaluation core: `packages/agent-core/src/permission/`
- HOLD/RELEASE handling: `packages/agent-core/src/session/`, `packages/agent-core/src/tool/plan.ts`
- Daemon auth + scope map: `packages/agent-core/src/server/auth.ts`, `packages/agent-core/src/server/server.ts`
- Cron allowlist policy: `packages/agent-core/src/cron/policy.ts`
- Tests:
  - `packages/agent-core/test/permission/`
  - `packages/agent-core/test/server/auth-scope.test.ts`
  - `packages/agent-core/test/server/directory-override.test.ts`

