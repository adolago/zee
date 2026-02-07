# Secure Patterns

This document captures secure-by-default patterns used in `agent-core`. Prefer these patterns when adding new features.

## Daemon Exposure

- Do not add new privileged daemon routes without:
  - explicit scope mapping (`operator.admin` when appropriate)
  - tests covering 401/403 behavior when auth is enabled
- Non-loopback binds must remain gated behind HTTP auth.

Evidence:
- Scope map: `packages/agent-core/src/server/auth.ts`
- Server middleware: `packages/agent-core/src/server/server.ts`

## Permission Model

- Default to HOLD mode for sessions unless a trusted operator explicitly opts into RELEASE.
- Avoid enabling RELEASE on messaging surfaces.
- Prefer allowlists for non-interactive automation (cron toolInvoke, directory overrides).

Evidence:
- HOLD/RELEASE tools: `packages/agent-core/src/tool/plan.ts`
- Cron allowlist policy: `packages/agent-core/src/cron/policy.ts`

## Filesystem Access

- Resolve and validate paths before reading/writing.
- Use realpath-resolved containment for “project boundary” checks.
- Avoid interpreting untrusted paths as globs without validation.
- Block reading `.env` files (defense in depth).

Evidence:
- `tool.read` `.env` block and bounded reads: `packages/agent-core/src/tool/read.ts`
- Boundary checks: `packages/agent-core/src/project/instance.ts`

## Streaming / Long-Lived Connections

- Always cap resource usage:
  - finite idle timeouts
  - connection limits
  - shared timers/keepalive scheduling (avoid per-connection intervals)

Evidence:
- SSE limiter: `packages/agent-core/src/server/sse-limit.ts`
- SSE keepalive: `packages/agent-core/src/server/sse-keepalive.ts`

## Secrets on Disk

- When reading secrets from files:
  - reject symlinks
  - require ownership by the current user
  - require safe permissions (POSIX)

Evidence:
- Zee gateway token file reader: `packages/agent-core/src/gateway/token.ts`

## External Content Handling (Messaging / Webhooks)

- Treat all inbound content as untrusted.
- Wrap external content with explicit “untrusted” boundaries and avoid direct interpolation into system prompts.

Evidence:
- `external-content` helper: `packages/agent-core/src/security/external-content.ts`, `packages/personas/zee/src/security/external-content.ts`

