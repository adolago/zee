# agent-core Fix Backlog (Security > Reliability > Performance)

Baseline:
- Repo: `agent-core` (branch `dev`, commit `c5b4cfb2c489ae4b211a1cf4b12c61c867c6ec97`)
- Source reports: `docs/security/THREAT-MODEL.md`, `security_best_practices_report.md`, `reliability-report.md`, `performance-report.md`

## P0 (Security)

### SEC-001: Refuse non-loopback bind unless server auth is enabled and configured

Addresses: `security_best_practices_report.md` SEC-001, `docs/security/THREAT-MODEL.md` TM-001

Change:
- Implement a guardrail at daemon startup such that binding to a non-loopback hostname fails unless `AGENT_CORE_ENABLE_SERVER_AUTH=1` and `AGENT_CORE_SERVER_PASSWORD` is set (and non-empty).
- Allow an explicit insecure override only when `AGENT_CORE_DISABLE_SERVER_AUTH=1` and `AGENT_CORE_ALLOW_INSECURE_SERVER_NO_AUTH=1` are both set (new, explicit, noisy).

Implementation details:
- Add a helper `assertSafeServerBind({ hostname })` in `packages/agent-core/src/server/auth.ts` or `packages/agent-core/src/cli/network.ts`.
- Call sites: `packages/agent-core/src/cli/network.ts:68-96` (after resolving hostname/port) and `packages/agent-core/src/server/server.ts:308-346` (backstop).
- Update `SECURITY.md` to describe the new behavior and to remove contradictory claims.

Acceptance criteria:
- Starting `agent-core serve --hostname 0.0.0.0` without auth configured exits non-zero with a clear error.
- Starting with auth configured succeeds.
- Explicit override works but prints a warning on startup (no secrets).

Tests:
- Add unit tests for loopback vs non-loopback detection and guardrail logic.
- Add a small integration test that starts the server in-process with non-loopback hostname and asserts failure without auth.

Rollout notes:
- This is a behavior change for anyone exposing the daemon on a LAN without auth. Provide a one-release grace note and clear migration steps.

### SEC-002: Enforce scope authorization in HTTP middleware

Addresses: `security_best_practices_report.md` SEC-004, `docs/security/THREAT-MODEL.md` TM-002

Change:
- Replace `isAuthorized(...)` middleware with `authorizeRequestScoped(...)`, returning `401` and `WWW-Authenticate` for unauthenticated requests and `403` for authenticated-but-insufficient-scope requests.

Implementation details:
- Update middleware in `packages/agent-core/src/server/server.ts:153-164`.
- Keep `AuthScope` and `ROUTE_SCOPE_MAP` in `packages/agent-core/src/server/auth.ts:13-58` as the single source of truth.
- Ensure high-risk routes have explicit scope mappings (PTY, MCP, auth, cron, config writes).

Acceptance criteria:
- `GET /global/health` is accessible with read scope.
- `PUT /auth/:providerID`, `POST /pty`, `POST /cron/jobs`, and `POST /mcp` require admin/write scopes as defined.

Tests:
- Add route authz tests that exercise method+path combinations against a matrix of granted scopes.

### SEC-003: Remove or strictly gate request-scoped directory switching; fix boundary checks

Addresses: `security_best_practices_report.md` SEC-003, `docs/security/THREAT-MODEL.md` TM-003

Change:
- In server mode, do not accept directory selection from unauthenticated inputs.
- Preferred: remove request directory overrides entirely and always use the daemon's configured base directory.
- If directory switching is required, require admin scope, allow only directories in an allowlist (config `server.allowedDirectories` or env `AGENT_CORE_SERVER_ALLOWED_DIRECTORIES`), canonicalize and validate with `realpath`, and reject `/` unless `AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY=1` is set.
- Update project boundary checks to use realpath-resolved containment.

Implementation details:
- `packages/agent-core/src/server/server.ts:165-180`: replace query/header directory selection with a safe resolver that uses config and allowlist.
- `packages/agent-core/src/project/instance.ts:56-62`: switch to `Filesystem.containsResolvedSync(...)` (or async path) to avoid symlink escapes.
- `packages/agent-core/src/tool/external-directory.ts:12-31`: ensure permission prompting uses resolved containment, not lexical.

Acceptance criteria:
- Requests cannot set directory to `/` unless explicitly allowed.
- A symlink inside the workspace pointing outside triggers `external_directory` permission prompts.

Tests:
- Add tests for directory allowlist enforcement.
- Add a symlink boundary test (create temp project, add symlink, ensure permission is requested).

### SEC-004: Restrict PTY API to reduce RCE blast radius

Addresses: `security_best_practices_report.md` SEC-002, `docs/security/THREAT-MODEL.md` TM-001

Change:
- Require admin scope for all PTY endpoints.
- Disable custom `command` override by default for HTTP callers (only allow the preferred shell).
- Add an explicit opt-in config to allow custom commands if needed.

Implementation details:
- Tighten PTY create input in `packages/agent-core/src/pty/index.ts:38-44` or validate in `packages/agent-core/src/server/route/pty.ts:31-54`.

Acceptance criteria:
- Non-admin callers cannot create PTYs.
- PTY creation without command uses the default shell.
- Custom command is rejected unless opt-in flag is set.

Tests:
- Add route-level tests and unit tests for PTY input validation.

### SEC-005: Make messaging surfaces safe by default (hold mode + no auto-allow of dangerous perms)

Addresses: `security_best_practices_report.md` SEC-005, `docs/security/THREAT-MODEL.md` TM-004

Change:
- Default messaging surfaces (WhatsApp/Matrix) to hold mode.
- Optionally, keep release mode semantics for explicitly configured sessions, but do not auto-approve high-risk permissions without an allowlist.

Implementation details:
- Adjust `packages/agent-core/src/session/prompt.ts:155-157`.
- Adjust `packages/agent-core/src/permission/next.ts:136-141` to either auto-allow only a safe subset, or require explicit config for auto-allow behavior.

Acceptance criteria:
- New messaging sessions require explicit approvals for dangerous tools in the default configuration.

Tests:
- Add unit tests for hold mode resolution by surface.
- Add tests for permission behavior when holdMode is false.

### SEC-006: Harden cron toolInvoke execution policy

Addresses: `security_best_practices_report.md` SEC-006, `docs/security/THREAT-MODEL.md` TM-005

Change:
- Require admin scope for cron job creation/updates when payload is `toolInvoke`.
- Enforce a safe allowlist of tools that can run in cron toolInvoke mode.
- Store an explicit "cron permissions policy" per job and validate before each run.

Implementation details:
- Enforce at API boundary: `packages/agent-core/src/server/route/cron.ts:34-52`.
- Enforce at execution boundary: `packages/agent-core/src/cron/service/timer.ts:225-274`.

Acceptance criteria:
- Unapproved tools cannot be scheduled or executed via cron toolInvoke.
- Cron toolInvoke failures are reported clearly with actionable errors.

Tests:
- Add tests that attempt to schedule disallowed tools and ensure rejection.

## P1 (Security)

### SEC-007: Add connection limiting and finite idle timeouts for streaming endpoints

Addresses: `security_best_practices_report.md` SEC-008, `docs/security/THREAT-MODEL.md` TM-007

Change:
- Set a finite `idleTimeout` in server mode.
- Add per-IP (or per-auth principal) connection caps for SSE and websockets.
- Consider disabling SSE endpoints on non-loopback unless explicitly enabled.

Implementation details:
- `packages/agent-core/src/server/server.ts:311-315` and `packages/agent-core/src/server/route/global.ts:147-207`.

Tests:
- Add unit tests for connection counter logic and ensure cleanup on abort.

### SEC-008: Move Zee gateway token storage out of `/tmp` and validate file permissions

Addresses: `security_best_practices_report.md` SEC-007, `docs/security/THREAT-MODEL.md` TM-009

Change:
- Replace the insecure `/tmp/zee_gateway_token` fallback with `ZEE_GATEWAY_TOKEN_FILE` (default: `~/.local/state/agent-core/zee_gateway_token`).
- Validate file ownership and mode (0600) before reading.

Implementation details:
- `packages/agent-core/src/gateway/token.ts` and `packages/agent-core/src/server/route/gateway.ts`.

Tests:
- Add tests for token file resolution and permission validation (skip on platforms without POSIX perms).

### SEC-009: Upgrade vulnerable runtime dependencies and add audit gating

Addresses: `security_best_practices_report.md` "Supply chain" section, `docs/security/THREAT-MODEL.md` TM-008

Change:
- Upgrade runtime-relevant dependencies flagged by audit, prioritizing `hono` (daemon request path), `@modelcontextprotocol/sdk` (MCP path), and `undici`/`jws`/`qs` where they are runtime-reachable.
- Add a CI job that runs `bun audit` and tracks deltas (allow temporary exceptions with a documented allowlist).

Acceptance criteria:
- `bun audit` high-severity issues for runtime deps are reduced or explicitly waived with rationale.

## P2 (Reliability)

### REL-001: Add explicit timeouts and bounded retries to Qdrant client

Addresses: `reliability-report.md` REL-001, `performance-report.md` "Qdrant/memory performance notes"

Change:
- Add default timeout to `QdrantVectorStorage.request(...)`.
- Add small retry budget for idempotent calls.

Implementation details:
- `src/memory/qdrant.ts:78-106`.

Tests:
- Mock fetch to simulate hangs and verify abort behavior.

### REL-002: Stream file reads to avoid memory spikes

Addresses: `reliability-report.md` REL-004, `performance-report.md` PERF-001

Change:
- Replace `file.text()` usage in `ReadTool` with a streaming/bounded reader.

Implementation details:
- `packages/agent-core/src/tool/read.ts:162-179`.

Tests:
- Add tests for large file behavior (ensure bounded memory usage by verifying read size and output truncation logic).

### REL-003: Define and document correct per-package test commands and add CI coverage

Addresses: `reliability-report.md` REL-006

Change:
- Update `TESTING.md` with explicit per-package commands for `packages/agent-core` (Bun test flow) and `packages/personas/zee` (PNPM/Vitest flow).
- Add CI jobs that run each package's intended test command.

Acceptance criteria:
- Engineers can run a single documented command per package and get consistent results.

## P3 (Performance)

### PERF-001: Reuse gateway WebSocket connection (pool or long-lived)

Addresses: `performance-report.md` PERF-004

Change:
- Introduce a connection manager that maintains a WebSocket and multiplexes requests by ID.

Implementation details:
- `packages/agent-core/src/server/route/gateway.ts:114-254`.

Acceptance criteria:
- Bulk gateway operations show reduced per-call latency and fewer connection errors.

### PERF-002: Reduce per-SSE connection overhead (keepalive and event fanout)

Addresses: `performance-report.md` PERF-003

Change:
- Use a shared keepalive mechanism or remove keepalive timers.
- Add fanout backpressure controls if event volume is high.

Implementation details:
- `packages/agent-core/src/server/route/global.ts:147-207`.
