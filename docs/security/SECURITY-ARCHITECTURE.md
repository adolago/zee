# Security Architecture

This document summarizes the security architecture of `agent-core` (daemon + CLI/TUI) and the Zee gateway integration.

For a repo-grounded threat model, see `docs/security/THREAT-MODEL.md`.

## Trust Boundaries

- Local operator terminal running `agent-core` (trusted operator surface)
- Daemon HTTP API (trusted-by-default when bound to loopback; can be remote-exposed if configured)
- Messaging surfaces (WhatsApp/Matrix) are untrusted input by default
- External services:
  - LLM providers
  - Qdrant (memory backend)
  - Zee gateway (local WebSocket RPC by default)

## Daemon HTTP Security

### Non-loopback binds require authentication

`agent-core` refuses to bind to non-loopback addresses unless HTTP Basic Auth is enabled and a password is configured.

Evidence:
- Guardrail: `packages/agent-core/src/server/auth.ts` (`assertSafeServerBind`)
- Server wiring: `packages/agent-core/src/server/server.ts`

### Scope-based authorization

When auth is enabled, routes are mapped to required scopes (admin/read/write/approvals/pairing).

Evidence:
- Scope map + resolver: `packages/agent-core/src/server/auth.ts`
- Middleware enforcement: `packages/agent-core/src/server/server.ts`
- Tests: `packages/agent-core/test/server/auth-scope.test.ts`

## Permission System (HOLD/RELEASE)

`agent-core` is not a sandbox. The permission system is a UX and operator-safety mechanism.

- `HOLD` mode is the default (safe-by-default).
- `RELEASE` mode auto-approves permission prompts and should be treated as root-equivalent.

Messaging surfaces cannot do interactive prompting, so `RELEASE` is blocked by default unless explicitly enabled.

Evidence:
- Permission core: `packages/agent-core/src/permission/`
- HOLD/RELEASE tools: `packages/agent-core/src/tool/plan.ts`

## Filesystem Safety

High-risk controls focus on avoiding path traversal and accidental broad trust expansion:

- Request-scoped directory overrides are gated by allowlists for non-loopback binds.
- Filesystem root (`/`) is refused as an instance directory by default.
- Project boundary checks use realpath-resolved containment.

Evidence:
- Directory override middleware: `packages/agent-core/src/server/server.ts`
- Project boundary checks: `packages/agent-core/src/project/instance.ts`
- Tests: `packages/agent-core/test/server/directory-override.test.ts`

## Zee Gateway Integration

`agent-core` can authenticate to Zee gateway via:

- `ZEE_GATEWAY_TOKEN` (env)
- `ZEE_GATEWAY_TOKEN_FILE` (token file path)
- default: `~/.local/state/agent-core/zee_gateway_token`

Token files are rejected if they are symlinks, not owned by the current user, or have unsafe permissions.

Evidence:
- Token file handling: `packages/agent-core/src/gateway/token.ts`

## Availability / DoS Guardrails

Long-lived streaming endpoints have explicit resource bounds:

- finite idle timeout
- global and per-client SSE connection limits
- shared keepalive scheduling

Evidence:
- SSE limiter: `packages/agent-core/src/server/sse-limit.ts`
- SSE keepalive: `packages/agent-core/src/server/sse-keepalive.ts`

## Security Gates (Release)

- Dependency audit: `bash scripts/bun-audit-ci.sh`
- Engine security tests: `cd packages/agent-core && bun test test/security`
- Security gate wrapper: `bash scripts/security-gate.sh`
- Security score rubric: `docs/security/SECURITY-SCORE.md` + `bun scripts/security-score.ts`

