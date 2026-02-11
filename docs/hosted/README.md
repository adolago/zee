# Hosted Platform

This directory documents the in-repo hosted platform for zee. The hosted service lives in `packages/hosted` and provides the share API, provider vault, analytics, billing endpoints, gateway routing, and telemetry/log ingestion.

## Quick start

```bash
cd packages/hosted
bun install
bun dev
```

By default the service listens on `http://127.0.0.1:8787` and stores data in `packages/hosted/data/hosted.db`.

## Core capabilities

- Share API: `POST /api/share` and `GET /api/share/:slug`
- Auth API: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- Org/workspace APIs and API keys
- Provider vault (API-key based) and OAuth callback endpoints
- Gateway routing: `POST /api/gateway/:workspaceId/chat`
- Usage analytics: `GET /api/analytics/summary`
- Telemetry/log ingestion: `POST /api/telemetry`, `POST /api/logs`

## Environment variables

See `docs/ENVIRONMENT_VARIABLES.md` for the full list. Hosted-specific entries include:

- `HOSTED_HOST` and `HOSTED_PORT`
- `HOSTED_BASE_URL`
- `HOSTED_DATA_DIR` and `HOSTED_DB_PATH`
- `HOSTED_ALLOW_SIGNUP`
- `HOSTED_API_KEYS`
- `HOSTED_VAULT_KEY`
- `HOSTED_BILLING_PORTAL_URL`
- `HOSTED_RETENTION_LOGS_DAYS`
- `HOSTED_RETENTION_TELEMETRY_DAYS`
- `HOSTED_RETENTION_USAGE_DAYS`

## Authentication

The hosted API uses local email + password accounts. The first account can be bootstrapped by setting:

- `HOSTED_BOOTSTRAP_EMAIL`
- `HOSTED_BOOTSTRAP_PASSWORD`

### OAuth provider connections

Configure OAuth providers using the `HOSTED_OAUTH_<PROVIDER>_*` environment variables documented in
`docs/ENVIRONMENT_VARIABLES.md`. The callback endpoint is:

```
GET /oauth/<provider>/callback
```

## Share API

To create a share:

```bash
curl -X POST http://127.0.0.1:8787/api/share \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <optional>" \
  -d '{"info": {"id": "session-id"}, "messages": {}}'
```

## Gateway routing

The gateway expects a workspace API key or an authenticated session cookie. It forwards chat-style payloads to the configured provider connection for that workspace.

```bash
curl -X POST http://127.0.0.1:8787/api/gateway/<workspaceId>/chat \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Key: <workspace key>" \
  -d '{"model": "gpt-4.1-mini", "messages": [{"role":"user","content":"hi"}]}'
```

## Management API

Use the `/api/*` endpoints to manage orgs, workspaces, API keys, providers, billing, and retention settings.
