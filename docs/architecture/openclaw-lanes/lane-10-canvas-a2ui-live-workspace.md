# OpenClaw Lane 10: Canvas host / A2UI / live workspace surfaces

Tracking issue: `adolago/zee#233`

## Decision Summary

- Canvas/A2UI product-surface parity: `defer`
- Auth gating and exposure hardening for equivalent surfaces: `port`
- Live-workspace UX parity: `adapt`

## Rationale

Zee control-ui/webchat is now first-class, but full canvas-host parity remains a product-shape decision. Security posture for any exposed web control assets is still a direct port requirement.

## Non-goals

- Immediate 1:1 canvas host and A2UI feature parity.

## Re-entry Conditions

1. Product decision for canvas-grade workspace UX in Zee.
2. Dedicated auth/origin hardening test matrix.
3. Operational support owner for web control surface expansion.

## Next Actions Completion

- [x] Mark canvas/A2UI full parity as deferred with explicit re-entry conditions.
- [x] Retain auth/exposure hardening as required port scope.
- [x] Capture live-workspace behavior as adapt scope.
