# Investing Valuation Kernel

The valuation kernel is the first reusable valuation engine inside Zee. It creates a persisted run that combines three valuation views for a single symbol:

- valuation overview from `/api/valuation/<symbol>`
- DCF output from `/api/research/<symbol>/dcf`
- comparable-company range from `/api/peers/<symbol>`

## Scope

This slice focuses on the model kernel itself:

- run DCF, comps, and blended valuation collection in one call
- compute a deterministic bull/base/bear scenario table
- persist the result locally for later packet/export work

Assumption provenance and full packet export land in the follow-on valuation issues.

## Persisted contract

Runs are stored at `~/.local/state/zee/investing/valuation-kernels.json`.

Each run records:

- `symbol`
- `status`
- `methods[]`
- `scenarios[]`
- `blendedFairValue`
- `currentPrice`
- `upsidePercent`
- `assumptions`
- `summary`
- `errors[]`

## Tool surface

The kernel is exposed as `zee:invest-valuation`.

Supported actions:

- `run`
  - inputs: `symbol`
  - optional: `peers`, `discountRate`, `terminalGrowth`, `projectionYears`, `bearMultiplier`, `bullMultiplier`
- `read`
  - inputs: `runId`
- `list`
  - inputs: optional `symbol`, optional `status`, optional `limit`

## Scenario model

The kernel computes a blended fair value from whatever valuation methods succeed.

Scenario defaults:

- `bear`: `0.85x`
- `base`: `1.00x`
- `bull`: `1.15x`

These multipliers are intentionally simple in the kernel. The next valuation slices add richer assumption provenance and sensitivity frameworks on top of this base.

## Telemetry

This slice emits:

- `investing.valuation.kernel`
  - one event per valuation run
- `investing.valuation.method`
  - one event per method result (`valuation`, `dcf`, `comparables`)
- `investing.valuation.scenario`
  - one event per bull/base/bear scenario row

## Research workflow integration

Planner valuation tasks now include `zee:invest-valuation`, so the research executor can attach a valuation kernel run as evidence when a workflow reaches valuation-focused steps.
