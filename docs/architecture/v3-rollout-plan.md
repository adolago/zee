# V3 Rollout Plan

This slice closes `#519`.

Zee now ships an executable staged rollout plan for v3 with managed daemon-env automation and a first-class rollback path.

## Rollout stages

- `paused`
  - all tracked surfaces pinned to legacy
- `canary`
  - CLI primary, orchestration and gateway pinned to legacy
- `internal`
  - CLI and orchestration primary, gateway pinned to legacy
- `broad`
  - all tracked surfaces primary, legacy fallback still allowed
- `general`
  - all tracked surfaces primary, legacy fallback disabled

Stage promotions can only move forward one step at a time.

## Operator usage

```bash
zee v3 rollout status
zee v3 rollout apply canary --actor release-manager --reason "Start CLI canary"
zee v3 rollout apply internal --actor release-manager --reason "Promote daemon traffic"
zee v3 rollout rollback --actor sre-owner --reason "Rollback after parity breach"
zee v3 launch status
```

## Automation contract

The rollout command manages these runtime flags inside `~/.config/zee/daemon.env`:

- `ZEE_RUNTIME_OPENCODE_SURFACES`
- `ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES`
- `ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK`

After applying or rolling back a stage, operators should restart the user service:

```bash
systemctl --user restart zee
```

## Promotion gate

Forward promotion is blocked unless the consolidated `v3-release-gate` report is already passing.

Rollback to `paused` is always allowed.

## Telemetry

This slice emits:

- `release.v3.rollout`
  - stage
  - history count
  - forced-legacy surface count
  - fallback flag state
  - release-gate readiness
  - restart-required status

That gives SRE and release operators a concrete rollout state machine instead of a prose-only rollout plan.
