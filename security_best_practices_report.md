# agent-core Security Best Practices Report (2026-02-06, refreshed)

Baseline:
- Repo: `agent-core` (branch `dev`, commit `c5b4cfb2c489ae4b211a1cf4b12c61c867c6ec97`)
- Note: analysis reflects the working tree state on 2026-02-06 (repo not clean).
- In-scope: `packages/agent-core/`, repo root `src/` (memory), `packages/personas/zee/` (gateway)

## Executive summary

The highest-impact remote exposure risks from the daemon HTTP API have been significantly reduced:
- Non-loopback binds are refused unless HTTP Basic Auth is enabled and configured, with an explicit opt-in for intentionally insecure deployments.
- Scope-based authorization is enforced in HTTP middleware.
- Request-scoped directory overrides are gated with an allowlist for non-loopback binds; filesystem root is rejected by default; project boundary checks are realpath-resolved.
- Streaming endpoints are bounded (finite idle timeout, SSE connection limits).

Remaining high-leverage risks are mostly expected-by-design power and operator footguns:
- Explicitly opting into insecure server mode can still expose RCE-grade endpoints.
- RELEASE mode auto-approves permissions; switching to RELEASE is now restricted on messaging surfaces and can require `operator.admin` when HTTP auth is enabled, but it remains a high-trust operator feature.
- Admin-scoped endpoints (PTY, MCP, cron toolInvoke) remain extremely powerful; treat credentials as root-equivalent.

## Findings

### SEC-001: Non-loopback bind requires HTTP auth (Status: addressed)

Severity: High (operator footgun if bypassed)

What is implemented:
- `agent-core` refuses to bind to non-loopback hostnames unless server auth is enabled and `AGENT_CORE_SERVER_PASSWORD` is set.
- Explicit insecure override requires both `AGENT_CORE_DISABLE_SERVER_AUTH=1` and `AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH=1`.

Evidence:
- Guardrail: `packages/agent-core/src/server/auth.ts` (`assertSafeServerBind`)
- Call sites: `packages/agent-core/src/cli/network.ts`, `packages/agent-core/src/server/server.ts`
- Documentation: `SECURITY.md`

Residual risk:
- If the insecure override is enabled, remote clients can reach privileged routes (PTY, MCP, cron, etc.).

Recommendation:
- Keep non-loopback binds behind auth and a host firewall. Treat enabling the insecure override as equivalent to disabling all security.

### SEC-002: PTY API is an RCE-grade surface (Status: mitigated)

Severity: High

What is implemented:
- PTY endpoints require `operator.admin` scope when HTTP auth is enabled (enforced via middleware + route scope map).
- PTY `command` override from HTTP callers is disabled by default, unless `AGENT_CORE_PTY_ALLOW_COMMAND_OVERRIDE=1`.

Evidence:
- Route sanitization: `packages/agent-core/src/server/route/pty.ts`
- PTY spawn surface: `packages/agent-core/src/pty/index.ts`
- Scope map: `packages/agent-core/src/server/auth.ts`

Residual risk:
- Even with `command` override disabled, caller-controlled `args` can still turn the default shell into arbitrary command execution. This is acceptable for trusted local/admin usage, but it reinforces that PTY is not a safe remote surface.

Recommendation:
- Keep PTY behind `operator.admin` and avoid exposing it beyond loopback.
- If you need a safer remote surface, consider also gating or sanitizing `args` by default and requiring an explicit opt-in for arbitrary args.

### SEC-003: Request-scoped directory overrides expand the trust boundary (Status: addressed)

Severity: Medium (local) / High (if misconfigured for remote)

What is implemented:
- Filesystem root (`/`) is refused as an instance directory by default, unless explicitly allowed.
- For non-loopback binds, request-scoped directory overrides are constrained to an allowlist (`AGENT_CORE_SERVER_ALLOWED_DIRECTORIES` or `config.server.allowedDirectories`).
- When HTTP auth is enabled, changing the instance directory away from the daemon base directory requires `operator.admin`.
- Project boundary checks use realpath-resolved containment and avoid the non-git worktree=`/` bypass.

Evidence:
- Directory resolver + allowlist: `packages/agent-core/src/server/server.ts`
- Boundary check: `packages/agent-core/src/project/instance.ts`
- External directory permission gate: `packages/agent-core/src/tool/external-directory.ts`

Residual risk:
- On loopback with auth disabled (local personal use), any local client can still use request-scoped directory overrides; this is not a security boundary.

Recommendation:
- If you run on multi-user hosts, enable HTTP auth even on loopback, or disable request-scoped directory overrides entirely.

### SEC-004: Scope authorization enforcement (Status: addressed)

Severity: Medium

What is implemented:
- When HTTP auth is enabled, requests must authenticate and satisfy `resolveRequiredScope(method, path)`.
- Privileged instance-management endpoints (`GET /global/instances`, `POST /global/dispose*`, `POST /instance/dispose`) are explicitly mapped to `operator.admin`.
- When auth is enabled, denied requests (401/403) emit audit logs including request IP (when available), method/path, and required scope.

Evidence:
- Enforcement middleware: `packages/agent-core/src/server/server.ts`
- Scope map + resolution: `packages/agent-core/src/server/auth.ts`
- Coverage: `packages/agent-core/test/server/auth-scope.test.ts`

Residual risk:
- Routes not covered by the explicit map rely on the default rule (GET/HEAD = read, everything else = write). Review the map when adding new privileged routes.

### SEC-005: Messaging surfaces default to HOLD mode (Status: addressed)

Severity: High (if RELEASE is used on untrusted surfaces)

What is implemented:
- HOLD mode is now the default when `session.mode` is not explicitly set.
- `/release` is refused on WhatsApp/Matrix unless `AGENT_CORE_ALLOW_MESSAGING_RELEASE=1`.
- When HTTP auth is enabled, switching to RELEASE mode requires scope `operator.admin`.

Evidence:
- Hold mode resolution: `packages/agent-core/src/session/prompt.ts`
- Flag: `packages/agent-core/src/flag/flag.ts`
- Documentation: `SECURITY.md`

Residual risk:
- RELEASE mode still auto-approves all permission prompts (`PermissionNext.ask`), which is dangerous on inbound messaging surfaces unless senders are strongly allowlisted and tools are restricted.

Recommendation:
- Treat RELEASE mode as a deliberate, trusted-operator configuration.
- Keep `AGENT_CORE_ALLOW_MESSAGING_RELEASE` unset unless your messaging sender trust and tool restrictions are strong enough to safely run without interactive permission prompts.
- Consider additional tool-level restrictions for messaging surfaces even when HOLD is used (for example: never allow `bash`, `edit`, `mcp`, `external_directory` unless explicitly allowlisted).

### SEC-006: Cron toolInvoke hardening (Status: mitigated)

Severity: Medium

What is implemented:
- Scheduling `payload.kind="toolInvoke"` requires `operator.admin` when HTTP auth is enabled.
- Cron toolInvoke is allowlisted (`config.cron.toolInvokeAllowlist` or `AGENT_CORE_CRON_TOOL_INVOKE_ALLOWLIST`).
- Cron toolInvoke still cannot request interactive permissions at runtime (explicitly fails fast).

Evidence:
- API checks: `packages/agent-core/src/server/route/cron.ts`
- Allowlist policy: `packages/agent-core/src/cron/policy.ts`
- Execution guardrail: `packages/agent-core/src/cron/service/timer.ts`

Residual risk:
- A tool can change over time and start requesting permissions, causing cron runs to fail.

Recommendation:
- Keep the allowlist small and prefer tools designed for non-interactive execution.

### SEC-007: Zee gateway token file handling (Status: addressed)

Severity: Low

What is implemented:
- `agent-core` can authenticate to Zee gateway using:
- `ZEE_GATEWAY_TOKEN` (env)
- `ZEE_GATEWAY_TOKEN_FILE` (token file path)
- Default token file: `~/.local/state/agent-core/zee_gateway_token`
- Token files are rejected if they are symlinks, not owned by the current user, or have unsafe permissions (POSIX).

Evidence:
- Token file reader: `packages/agent-core/src/gateway/token.ts`

### SEC-008: Streaming endpoint DoS guardrails (Status: addressed)

Severity: Medium

What is implemented:
- Finite server idle timeout (default `AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS=120`).
- SSE connection limiting with per-client quotas (`AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS`, `AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT`).
- Shared keepalive scheduler for SSE (avoids per-connection timers).

Evidence:
- Server listen config: `packages/agent-core/src/server/server.ts`
- SSE limiter: `packages/agent-core/src/server/sse-limit.ts`
- SSE keepalive: `packages/agent-core/src/server/sse-keepalive.ts`

### SEC-009: Zee gateway WebSocket reuse (Status: addressed)

Severity: Low

What is implemented:
- Gateway WebSocket calls reuse a client with an idle close window (reduces connect-per-call overhead).

Evidence:
- WS client: `packages/agent-core/src/gateway/ws-client.ts`
- Server route: `packages/agent-core/src/server/route/gateway.ts`

### SEC-010: Realpath-resolved project boundary checks (Status: addressed)

Severity: Medium

What is implemented:
- Project boundary checks use realpath-resolved containment to reduce symlink escapes.
- Non-git worktree=`/` no longer disables external directory permissions.

Evidence:
- Boundary check: `packages/agent-core/src/project/instance.ts`
- Containment helper: `packages/agent-core/src/util/filesystem.ts`

## Supply chain (bun audit)

As of 2026-02-06 in this workspace, `bun audit --json` reports 0 advisories.

CI also runs `bash scripts/bun-audit-ci.sh` (currently gates on `--audit-level high`), with an optional ignore list at `audit-ignore.txt`.

## Positive security controls observed

- `.env` files are hard-blocked for reads in `tool.read` (defense in depth): `packages/agent-core/src/tool/read.ts`.
- Proxy fallback includes an origin-matching check to reduce SSRF-style origin switching: `packages/agent-core/src/server/server.ts`.
- Zee gateway enforces connect-time auth checks: `packages/personas/zee/src/gateway/auth.ts`.

## Recommended hardening checklist (updated)

1. Keep non-loopback binds behind HTTP auth and a firewall (guardrail exists; do not bypass it).
2. Keep admin credentials tightly controlled (PTY/MCP/cron toolInvoke are admin-grade).
3. Prefer HOLD mode by default (implemented); `/release` is blocked on WhatsApp/Matrix unless `AGENT_CORE_ALLOW_MESSAGING_RELEASE=1`, and switching to RELEASE requires `operator.admin` when HTTP auth is enabled.
4. Keep cron toolInvoke allowlist minimal and stable.
