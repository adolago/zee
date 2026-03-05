# OpenClaw Lane 03: Matrix channel (extension plugin + core integration points)

Tracking issue: `adolago/zee#226`

## Decision Summary

- Matrix channel implementation: `defer`
- Security model expectations (auth/allowlists): `port` (policy-level)
- Plugin integration points: `adapt`

## Rationale

Zee currently ships WhatsApp/Telegram channel priorities. Matrix support remains valuable but is deferred until channel demand and maintenance ownership are explicit.

## Non-goals

- Shipping full Matrix channel runtime in current milestone.
- Mirroring OpenClaw extension loading internals 1:1.

## Required Preconditions for Un-defer

1. Dedicated Matrix operator story and provisioning runbook.
2. Channel policy mapping to existing Zee security audit surface.
3. Regression harness for inbound/outbound + allowlist enforcement.

## Next Actions Completion

- [x] Mark Matrix runtime implementation as deferred with explicit preconditions.
- [x] Keep policy-level security parity expectations tracked as port/adapt requirements.
- [x] Document test requirements needed to re-activate implementation.
