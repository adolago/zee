# agent-core Reliability Report (2026-02-06, refreshed)

Baseline:
- Repo: `agent-core` (branch `dev`, commit `c5b4cfb2c489ae4b211a1cf4b12c61c867c6ec97`)
- Note: analysis reflects the working tree state on 2026-02-06 (repo not clean).
- In-scope: `packages/agent-core/`, `src/` (memory), `packages/personas/zee/` (gateway)

## Executive summary

Core `packages/agent-core` typecheck/build/tests are healthy in this environment. The largest reliability risks called out in the initial pass were primarily unbounded resources and unbounded waits, and those have been materially improved:
- Qdrant client now has explicit timeouts and bounded retries.
- Streaming endpoints have finite idle timeouts and SSE connection limiting.
- Request-scoped instance directory overrides are constrained in server mode (non-loopback allowlist, root directory refused by default).
- `tool.read` now uses a bounded streaming reader and avoids full-file loads in binary detection.

Remaining reliability risks are mostly operational and policy-driven:
- Instance contexts are cached in-process; cleanup can be manual (admin dispose endpoints) or automatic via optional instance cache TTL/LRU eviction.
- Cron toolInvoke is intentionally non-interactive and will hard-fail if a tool starts requesting permissions.
- Multi-package runner differences still exist (Bun vs PNPM/Vitest), though CI covers both.

## What was validated (high signal)

- `packages/agent-core` uses a Bun-based test flow (`bun test`): `packages/agent-core/package.json`.
- Root intentionally blocks running tests from the repo root: `package.json`.
- Zee package tests run via PNPM/Vitest: `packages/personas/zee/package.json`.
- CI runs both `packages/agent-core` tests and `packages/personas/zee` tests: `.github/workflows/test.yml`.

## Previously high-risk findings (status)

### REL-001: Outbound Qdrant requests had no explicit timeouts (Status: addressed)

What is implemented:
- Qdrant REST requests use `AbortController` with a configurable timeout.
- A small, bounded retry budget exists for retryable and idempotent operations.

Evidence:
- `src/memory/qdrant.ts`

Residual risk:
- Other outbound calls (providers, web fetches) may not all share a uniform timeout policy.

### REL-002: Instance cache growth and request-scoped directory selection (Status: mitigated)

What is implemented:
- Server mode rejects filesystem root (`/`) as an instance directory by default.
- For non-loopback binds, request-scoped directory overrides are constrained to an allowlist.
- A max instance cache size is enforced when using request-scoped directory overrides (default cap for non-loopback binds; configurable via `AGENT_CORE_SERVER_MAX_INSTANCES` / `config.server.maxInstances`).

Evidence:
- Directory resolver, allowlist, and cap: `packages/agent-core/src/server/server.ts`
- Instance cache: `packages/agent-core/src/project/instance.ts`

Residual risk:
- Without eviction configured, the instance cache has no automatic cleanup. If you use many directories on loopback, you can accumulate contexts until you dispose them.
- Admin endpoints exist to list and dispose cached instances (`GET /global/instances`, `POST /global/dispose-directory`, `POST /global/dispose-all`).
- Optional eviction is available via `AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES` (LRU) and `AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS` (TTL).

### REL-003: Streaming endpoints and infinite idle timeout (Status: addressed)

What is implemented:
- Server idle timeout is finite by default (`AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS`, default 120).
- SSE connection counts are bounded globally and per client.
- SSE keepalive is scheduled by a shared interval (avoids per-connection timers).

Evidence:
- Server listen config: `packages/agent-core/src/server/server.ts`
- SSE limiter: `packages/agent-core/src/server/sse-limit.ts`
- SSE keepalive: `packages/agent-core/src/server/sse-keepalive.ts`

### REL-004: Large file reads loaded entire files before truncation (Status: addressed)

What is implemented:
- `tool.read` uses a bounded line reader (`readTextLinesBounded`) with a strict byte budget.
- Binary detection reads a small prefix instead of loading the full file.

Evidence:
- `packages/agent-core/src/tool/read.ts`
- `packages/agent-core/src/util/read-lines-bounded.ts`

## Remaining reliability findings

### REL-005: Cron toolInvoke is non-interactive and can fail on permission prompts

Severity: Medium

What is implemented:
- Cron toolInvoke is allowlisted and checked at schedule time and runtime.
- Cron toolInvoke requires `operator.admin` scope when HTTP auth is enabled.
- Cron toolInvoke fails fast if a tool requests permissions.

Evidence:
- Allowlist policy: `packages/agent-core/src/cron/policy.ts`
- API checks: `packages/agent-core/src/server/route/cron.ts`
- Runtime behavior: `packages/agent-core/src/cron/service/timer.ts`

Failure modes:
- A previously safe tool can start requesting permissions after an update, causing scheduled jobs to fail until configuration is updated.

Recommendation:
- Keep the allowlist small and prefer tools designed for deterministic, non-interactive execution.

### REL-006: Multi-package test runner fragmentation

Severity: Low

Current state:
- Root scripts intentionally prevent running tests from the repo root.
- `packages/agent-core` is Bun-first; `packages/personas/zee` is PNPM/Vitest.
- CI runs both.

Recommendation:
- Keep `TESTING.md` explicit about per-package commands and maintain the CI split to avoid accidental under-testing.

## Reliability opportunities

- Implemented: an explicit instance cache management API exists for operators (list cached directories, dispose specific directory, dispose all). Remaining open: decide whether to add automatic eviction (TTL/LRU) for long-lived daemons.
- Implemented: optional instance cache eviction exists (LRU/TTL) in addition to manual admin disposal endpoints.
- Consider a shared outbound HTTP helper that applies consistent timeouts and error classification across providers and integrations.
