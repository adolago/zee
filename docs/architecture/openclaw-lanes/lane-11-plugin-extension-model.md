# OpenClaw Lane 11: Plugin/extension model (manifests, loader, tool groups, safety scanning)

Tracking issue: `adolago/zee#234`

## Decision Summary

- Safety scanner and extension security checks: `port`
- Manifest/loader internals: `adapt`
- Tool-group ergonomics and packaging conventions: `adapt`

## Rationale

Security-critical plugin checks must remain parity-driven. Loader internals can diverge where Zee’s plugin architecture already provides equivalent guarantees.

## Non-goals

- Upstream plugin manifest format lockstep when behavioral guarantees already match.

## Test Gates

1. Plugin/skill scanner detection coverage (high-risk patterns).
2. Loader failure isolation and safe fallback behavior.
3. Tool exposure policy checks across plugin boundaries.

## Next Actions Completion

- [x] Record explicit port/adapt decisions for lane-11 extension deltas.
- [x] Prioritize safety scanner parity as mandatory scope.
- [x] Define plugin loader/security behavior test gates.
