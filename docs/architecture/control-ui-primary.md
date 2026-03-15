# Control UI + WebChat as Primary Operator Surface

This document defines the first-class operator path for Zee web control and webchat workflows (issue `#268`).

Explicit HTTP operator scope assignments live in `docs/architecture/control-plane-scope-matrix.md`.

## Stable Entrypoints

Primary commands:

```bash
zee control-ui start --server-url http://127.0.0.1:3210
zee control-ui status --strict
```

Compatibility:

- `zee web` remains available.
- `zee webchat` aliases `zee control-ui`.

## Core Operator Workflows

`zee control-ui status` probes these core workflows over the server API:

- session visibility: `GET /session`
- approvals queue: `GET /question`
- pairing/gateway reachability: `GET /gateway/status`
- system health: `GET /global/health/status`
- channel state: `GET /gateway/channels/status`

These workflows are covered by API-surface tests to keep the web operator path stable.

## Lifecycle Expectations

- Start daemon: `zee daemon`
- Start web control UI: `zee control-ui start`
- Probe readiness and operator workflows: `zee control-ui status --strict`

## Security Guidance (Proxied Deployment)

- Keep server auth enabled for non-loopback binds (`ZEE_ENABLE_SERVER_AUTH=1`, `ZEE_SERVER_PASSWORD`).
- Use token-mode Control UI auth by default for browser clients:
  - `Authorization: Bearer <token>`
  - `X-Zee-Token: <token>`
- Keep Control UI auth downgrade flags disabled unless explicitly break-glass acknowledged.
- Terminate TLS at the reverse proxy and keep trusted origins explicit (`gateway.controlUi.trustedOrigins`).
- Use:
  - `zee security audit`
  - `zee doctor security`
  to validate control-plane and action-surface guardrails before production exposure.
