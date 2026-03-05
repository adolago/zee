# OpenClaw Lane 02: WhatsApp channel (linking, inbound/outbound, allowlists, heartbeat)

Tracking issue: `adolago/zee#225`

## Decision Summary

- Channel linking/auth flows: `adapt`
- Inbound/outbound routing correctness: `port`
- Allowlists and mention-gating safety: `port`
- Heartbeat/recovery behavior: `adapt`

## Port/Adapt Notes

- Preserve fail-closed sender/group allowlist behavior.
- Keep outbound normalization and account-id hygiene aligned with Zee channel abstractions.
- Keep heartbeat/reconnect behavior reliable without forcing OpenClaw package topology parity.

## Non-goals

- Channel feature parity beyond WhatsApp production scope.
- Upstream package/file parity where Zee already diverges structurally.

## Test Gates

1. Inbound allowlist deny/allow matrix.
2. Outbound normalization and routing regression tests.
3. Heartbeat/reconnect resilience tests for channel outages.

## Next Actions Completion

- [x] Confirm lane-02 non-goals and retained scope.
- [x] Record explicit `port` / `adapt` decisions for lane-02 deltas.
- [x] Define lane-02 behavior test gates.
