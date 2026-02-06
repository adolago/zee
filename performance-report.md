# agent-core Performance Report (2026-02-06, refreshed)

Baseline:
- Repo: `agent-core` (branch `dev`, commit `c5b4cfb2c489ae4b211a1cf4b12c61c867c6ec97`)
- Note: analysis reflects the working tree state on 2026-02-06 (repo not clean).
- In-scope: `packages/agent-core/`, `src/` (memory), `packages/personas/zee/` (gateway)

## Executive summary

The primary performance risks in this repo are not hot loops. They are mostly unbounded or per-connection/per-request costs on privileged control-plane endpoints.

The biggest issues identified in the initial pass have been addressed or materially mitigated:
- `tool.read` is now bounded by bytes and reads lines via streaming I/O.
- Instance directory switching is constrained in server mode, and instance cache growth is capped when using directory overrides.
- Streaming endpoints have connection limits, a finite server idle timeout, and shared keepalive scheduling.
- Zee gateway calls reuse a WebSocket client (reduces connect-per-call overhead).
- Qdrant requests have explicit timeouts and bounded retries.

Remaining performance work is mostly about measurement and operational ergonomics (metrics, benchmarks) and deciding whether instance cache eviction should be enabled by default for long-lived daemons.

## High-impact areas (status)

### PERF-001: Avoid full-file reads when output is truncated (Status: addressed)

What is implemented:
- `tool.read` uses `readTextLinesBounded` with a strict byte budget.
- Binary detection reads only a small prefix.

Evidence:
- `packages/agent-core/src/tool/read.ts`
- `packages/agent-core/src/util/read-lines-bounded.ts`

### PERF-002: Bound and manage instance cache growth (Status: mitigated)

What is implemented:
- When requests use the `directory` override, server mode enforces a max cached instance count (`AGENT_CORE_SERVER_MAX_INSTANCES` / `config.server.maxInstances`).
- For non-loopback binds, directory overrides are constrained to an allowlist.

Evidence:
- Directory override middleware: `packages/agent-core/src/server/server.ts`
- Instance cache: `packages/agent-core/src/project/instance.ts`

Residual cost:
- Without eviction configured, the cache has no automatic cleanup. If you frequently switch directories on loopback, you can accumulate in-process state until disposed.
- Admin endpoints exist to list and dispose cached instances (`GET /global/instances`, `POST /global/dispose-directory`, `POST /global/dispose-all`).
- Optional eviction is available via `AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES` (LRU) and `AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS` (TTL).

### PERF-003: Reduce per-connection overhead for streaming endpoints (Status: addressed)

What is implemented:
- SSE connections are limited globally and per client.
- Keepalive scheduling is shared across streams.
- Server idle timeout is finite by default.

Evidence:
- SSE limiter: `packages/agent-core/src/server/sse-limit.ts`
- SSE keepalive: `packages/agent-core/src/server/sse-keepalive.ts`
- Server idle timeout: `packages/agent-core/src/server/server.ts`

### PERF-004: Reuse Zee gateway WebSocket connections (Status: addressed)

What is implemented:
- Gateway RPC uses a reusable WebSocket client with an idle close window.

Evidence:
- `packages/agent-core/src/gateway/ws-client.ts`
- `packages/agent-core/src/server/route/gateway.ts`

## Qdrant/memory performance notes

Current state:
- Qdrant REST requests have explicit timeouts and bounded retries.

Evidence:
- `src/memory/qdrant.ts`

Remaining opportunities:
- Collection/index initialization may still perform multiple sequential requests. If this becomes a hotspot, consider caching successful ensure-index completion per collection version.

## Measurement plan (still recommended)

The repo does not currently include a standardized runtime benchmark suite. A minimal plan that can be implemented without changing runtime behavior:

1. Add a microbenchmark harness under `packages/agent-core/script/bench/` (opt-in). Targets:
- `tool.read` reading a 50MB file (time, peak RSS).
- SSE connection overhead with N clients (CPU, open FDs).
- Gateway call latency for 100 sequential calls (WS reuse behavior).
2. Add lightweight operational counters exposed via HTTP:
- Instance cache size.
- Open SSE connections.
- Route request durations aggregated by route.

## Notes

Many of the highest-risk performance issues are coupled to security hardening (directory allowlists, auth enforcement, connection limiting). The current posture is improved because these controls also bound resource usage.
