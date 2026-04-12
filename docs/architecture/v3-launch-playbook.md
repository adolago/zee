# V3 Launch Playbook

This slice closes `#520`.

Zee now ships a persisted launch checklist with required owner signoffs and a `go-live` command that only opens when release and rollout gates are already satisfied.

## Required owner signoffs

- `release-manager`
- `sre-owner`
- `program-lead`

Each owner can record either:

- `approve`
- `block`

## Operator usage

```bash
zee v3 launch status
zee v3 launch signoff release-manager --actor artur --note "Release gate is green"
zee v3 launch signoff sre-owner --actor artur --note "Rollback path verified"
zee v3 launch signoff program-lead --actor artur --note "Go-live approved"
zee v3 launch go-live --actor artur --reason "Final launch approval"
```

## Launch gate

`zee v3 launch go-live` is blocked until all of the following are true:

- the consolidated `v3-release-gate` report is passing
- the staged rollout is already at `general`
- every required owner has an `approve` signoff on file

## Go-live playbook

The command emits a structured playbook that reinforces the final checks:

1. Reconfirm `zee v3 release --strict`.
2. Reconfirm `zee v3 rollout status`.
3. Restart Zee services if rollout changes are still pending.
4. Monitor `release.v3.report`, `release.v3.rollout`, and `release.v3.launch` diagnostics.
5. Re-run `zee inspect runtime-rollout --no-json` during stabilization.

## diagnostics

This slice emits:

- `release.v3.launch`
  - checklist count
  - checklist failures
  - signoff counts
  - rollout stage
  - release readiness
  - launched state

That gives the final release epic a durable record of who approved launch and when go-live was recorded.
