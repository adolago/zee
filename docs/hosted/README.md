# Hosted Platform

The hosted service lives in `packages/hosted` and provides:
- share API
- auth and workspace APIs
- provider vault and OAuth callbacks
- gateway routing
- analytics and telemetry/log ingestion

This guide is onboarding-first and focuses on getting new users to a working hosted instance quickly.

## Prerequisites

`Required`
- Bun installed
- Repo cloned locally

`Recommended`
- `curl` for API verification

## New-user onboarding flow

### 1) Install dependencies

```bash
cd packages/hosted
bun install
```

`Expected`
- Install completes without dependency errors.

### 2) Start the hosted service

```bash
bun dev
```

`Expected`
- Service starts on `http://127.0.0.1:8787` by default.
- Default local DB path: `packages/hosted/data/hosted.db`.

### 3) Verify first successful API call (Share API)

In a second terminal:

```bash
curl -X POST http://127.0.0.1:8787/api/share \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <optional>" \
  -d '{"info": {"id": "session-id"}, "messages": {}}'
```

`Expected`
- JSON response confirming share creation (or a clear validation/auth error if configured).

## Core capabilities

- Share API: `POST /api/share`, `GET /api/share/:slug`
- Auth API: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- Org/workspace APIs and workspace API keys
- Provider vault (API-key based) and OAuth callbacks
- Gateway routing: `POST /api/gateway/:workspaceId/chat`
- Usage analytics: `GET /api/analytics/summary`
- Telemetry/log ingestion: `POST /api/telemetry`, `POST /api/logs`

## Environment configuration

For the full list, see `docs/ENVIRONMENT_VARIABLES.md`.

Hosted-specific variables include:
- `HOSTED_HOST`, `HOSTED_PORT`
- `HOSTED_BASE_URL`
- `HOSTED_DATA_DIR`, `HOSTED_DB_PATH`
- `HOSTED_ALLOW_SIGNUP`
- `HOSTED_API_KEYS`
- `HOSTED_VAULT_KEY`
- `HOSTED_BILLING_PORTAL_URL`
- `HOSTED_RETENTION_LOGS_DAYS`
- `HOSTED_RETENTION_TELEMETRY_DAYS`
- `HOSTED_RETENTION_USAGE_DAYS`

## Authentication onboarding

Hosted auth uses local email/password accounts.

To bootstrap the first account, set:
- `HOSTED_BOOTSTRAP_EMAIL`
- `HOSTED_BOOTSTRAP_PASSWORD`

## OAuth provider onboarding

Configure provider OAuth via:
- `HOSTED_OAUTH_<PROVIDER>_*` variables (see `docs/ENVIRONMENT_VARIABLES.md`)

Callback endpoint:

```text
GET /oauth/<provider>/callback
```

## Gateway routing quick verification

The gateway endpoint expects a workspace API key or authenticated session cookie.

```bash
curl -X POST http://127.0.0.1:8787/api/gateway/<workspaceId>/chat \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Key: <workspace key>" \
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"hi"}]}'
```

`Expected`
- A routed provider response (or explicit auth/config error if workspace/provider is not configured yet).

## Troubleshooting

`Service does not start`
- Re-run `bun install` in `packages/hosted`.
- Check terminal startup output for missing env variables.

`Share API call fails`
- Confirm service is running on `127.0.0.1:8787`.
- Validate JSON payload and auth headers.

`Gateway routing fails`
- Verify `workspaceId` and `X-Workspace-Key`.
- Verify provider connection exists for that workspace.

`OAuth callback issues`
- Verify `HOSTED_BASE_URL` and provider callback URLs match exactly.

## Management API

Use `/api/*` endpoints to manage orgs, workspaces, API keys, providers, billing, and retention settings.
