# OpenBB Workspace as Primary Browser Surface

This document defines the first-class browser operator path for Zee after the removal of the in-repo web UI and Rust GUI.

Explicit HTTP operator scope assignments live in `docs/architecture/control-plane-scope-matrix.md`.

## Stable Entrypoints

Primary entrypoints:

```bash
zee daemon --hostname 127.0.0.1 --port 3210
GET /openbb/agents.json
POST /openbb/query
```

## Core Operator Workflows

OpenBB Workspace now drives these workflows over the Zee daemon API:

- agent discovery: `GET /openbb/agents.json`
- stateless copilot streaming: `POST /openbb/query`
- session visibility: `GET /session`
- system health: `GET /global/health/status`
- memory-backed personalization: `GET /memory/*` and `POST /memory/search`

These workflows are covered by API-surface tests to keep the OpenBB path stable.

## Lifecycle Expectations

- Start daemon: `zee daemon`
- Configure OpenBB Workspace against `http://127.0.0.1:3210/openbb/agents.json`
- Verify streaming query flow against `POST /openbb/query`

## Security Guidance (Proxied Deployment)

- Keep server auth enabled for non-loopback binds (`ZEE_ENABLE_SERVER_AUTH=1`, `ZEE_SERVER_PASSWORD`).
- Use token auth for browser clients:
  - `Authorization: Bearer <token>`
  - `X-Zee-Token: <token>`
- Keep browser-client auth downgrade flags disabled unless explicitly break-glass acknowledged.
- Terminate TLS at the reverse proxy and keep trusted origins explicit (`gateway.controlUi.trustedOrigins`).
- Use:
  - `zee security audit`
  - `zee security audit --deep --strict`
  - `zee doctor security --deep --strict`
  to validate control-plane and action-surface guardrails before production exposure.
