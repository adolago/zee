# Investing Eval Gates

This slice closes `#517`.

Zee now turns the investing eval harness into an enforceable gate for CI and release-quality owners.

## Gate contract

Each eval run now persists:

- `owner`
- `baselineRunId`
- `regression`
- `alerts[]`
- `gate`

The gate blocks strict execution when any of the following are true:

- the run status is not `pass`
- the run has threshold breaches
- the run regresses against the previous baseline run for the same dataset

## Regression detection

Regression comparisons use the previous persisted run for the same dataset.

Tracked regressions include:

- newly breached run-level thresholds
- run-level score drops of `>= 5` points
- case-level score drops of `>= 5` points
- checks that previously passed and now fail
- case status moving from `pass` to `fail` or `error`

## Ownership routing

Each dataset owner now becomes a routing key for alert delivery:

- dataset owner `research-qa` maps to routing key `owner:research-qa`
- dataset owner `release-quality-owner` maps to routing key `owner:release-quality-owner`

Alerts are attached directly to the persisted run and emitted through event bus diagnostics so downstream automation can fan them out without reparsing CLI output.

## Operator surfaces

CLI:

```bash
zee investing eval run create <datasetId> --strict
zee investing eval run read <runId> --json
zee investing eval run list --dataset-id <datasetId>
```

CI:

```bash
bun run --cwd packages/zee eval:gate
```

The CI script seeds a deterministic fixture dataset, runs the strict CLI gate, and fails the workflow if the gate blocks.

## diagnostics

This slice emits:

- `investing.eval.run`
  - owner, baseline run, gate outcome, regression count, alert count
- `investing.eval.gate`
  - strict gate routing key, blocked reasons, and baseline context
- `investing.eval.alert`
  - one event per routed alert with owner, code, and runbook size

That gives release-quality operators a stable signal for regression routing before the v3 launch gate consolidates it.
