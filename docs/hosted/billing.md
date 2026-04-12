# Hosted Billing

The hosted service includes plan metadata and a billing portal handoff. It does not meter gateway requests or store token usage.

## Plan catalog

Default plans are:

- Free
- Pro
- Enterprise

Plans can be updated per workspace through the API.

## Billing portal

To connect a billing portal, set:

- `HOSTED_BILLING_PORTAL_URL`

The hosted service returns the configured portal URL via `POST /api/billing/portal`. Plan selection lives in the database; external billing systems can synchronize plan changes by calling `POST /api/workspaces/:workspaceId/plan`.
