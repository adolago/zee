# Control-Plane Scope Matrix

Issue: `#491`

This document is the operator-facing summary of Zee's HTTP control-plane scope policy.
The exact route-to-scope source of truth lives in
`packages/zee/src/server/control-plane-scope.ts` and is verified against the generated
OpenAPI surface plus hidden routes in `packages/zee/src/server/auth.test.ts`.

## Approved Implementation Plan

Approved in-repo on `2026-03-15`.

- Replace prefix and verb heuristics with an explicit route matrix for mounted operator endpoints.
- Fail closed to `operator.admin` when a control-plane family route is not present in the matrix.
- Emit Flux telemetry on every authenticated control-plane request:
  - `auth.scope.checked`
  - `auth.scope.fallback`
- Keep the matrix aligned to the generated OpenAPI spec and the non-OpenAPI usage/cron/heartbeat routes.

## Public Exception

- `OPTIONS *`
  CORS preflight bypasses auth middleware. No other public bypass is permitted.

## Scope Summary

| Scope | Route families | Intent |
| --- | --- | --- |
| `operator.observe` | event streams, process registry reads, usage telemetry, Flux inspection, session event SSE | Diagnostics, traces, and runtime observability without mutation rights |
| `operator.approvals` | permission queue, question queue, in-session approval replies | Human approval workflows |
| `operator.pairing` | paired node inventory, pair/reconnect/revoke, node tool authorization | Device and node lifecycle management |
| `operator.admin` | provider auth mutation, MCP mutation/tool calls, PTY, TUI RPC, process mutations, privileged gateway moderation, session shell, usage purge | High-risk execution and security-sensitive administration |
| `operator.read` | tool/config/project/provider/session/file/model/registry reads, health/status, Telegram metadata, memory reads, MCP status | Read-only operator inspection |
| `operator.write` | config/project/theme updates, session mutations, worktree creation, cron/heartbeat triggers, messaging sends, memory writes, STT, legacy LLM bridge | Standard operator mutations that are not full admin |

## Exact Policy Notes

- Provider credential mutation is explicitly `operator.admin`:
  - `PUT /auth/{providerID}`
  - `DELETE /auth/{providerID}`
- Approval queues are explicitly `operator.approvals`:
  - `GET /permission`
  - `POST /permission/{requestID}/reply`
  - `GET /question`
  - `POST /question/{requestID}/reply`
  - `POST /question/{requestID}/reject`
  - `POST /session/{sessionID}/permissions/{permissionID}`
- Pairing inventory and lifecycle are explicitly `operator.pairing`:
  - `GET /gateway/node`
  - `POST /gateway/node/pair`
  - `POST /gateway/node/reconnect`
  - `POST /gateway/node/rotate`
  - `POST /gateway/node/revoke`
  - `POST /gateway/node/tool/authorize`
- Privileged remote execution stays `operator.admin`:
  - `GET|POST|PUT|DELETE /pty...`
  - `POST /mcp...`
  - `POST /tui...`
  - `POST /session/{sessionID}/shell`
- Unmapped control-plane family routes fail closed to `operator.admin` and emit `auth.scope.fallback`.

## Verification

- Unit coverage checks explicit scope resolution and fail-closed fallback behavior.
- OpenAPI parity coverage asserts that documented routes never use fallback resolution.
- Hidden route coverage keeps `usage`, `cron`, and `heartbeat` endpoints out of the parity gap bucket.
