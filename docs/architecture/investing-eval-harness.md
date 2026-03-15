# Investing Eval Harness

This slice closes `#515`.

Zee now ships a persisted golden-set evaluation harness for investing research outputs. Operators can capture datasets from stable outputs, rerun the harness later, and detect drift without rebuilding the source workflows by hand.

## State contract

State file:

- `~/.local/state/zee/investing/evals.json`

The file stores:

- `datasets[]`
  - golden-set definitions with owner, description, cases, capture audit, and last run metadata
- `runs[]`
  - replay results with structural pass/fail totals and per-case checks

## Supported source kinds

Datasets can capture golden snapshots from:

- `research-artifact`
- `earnings-packet`
- `portfolio-briefing`

Each captured case stores a golden snapshot with:

- `summary`
- `sectionTitles[]`
- `citationCount`
- `diagnosticCount`
- `updatedAt`
- source metadata such as `workflow`, `status`, `kind`, and `symbols[]`

## Harness checks

Each eval run replays the current live source against the stored golden snapshot and emits per-case checks for:

- summary equality
- section-title equality
- minimum citation count
- maximum diagnostic count
- status equality
- symbol coverage equality
- workflow equality when the source exposes one
- freshness window when the dataset case configures `freshnessWithinHours`

The current run contract includes:

- `scores.structural`
  - percent of cases that passed the golden-set replay
- `scores.factuality`
- `scores.consistency`
- `scores.timeliness`
- `owner`
- `baselineRunId`
- `regression`
- `alerts[]`
- `gate`

Those three quality dimensions are now scored by the deterministic `research-leads.v1` profile:

- `structural >= 100`
- `factuality >= 85`
- `consistency >= 85`
- `timeliness >= 80`

The current scorer rules are:

- factuality
  - weights citation coverage, diagnostic budget, summary alignment, and status alignment
- consistency
  - weights summary alignment, section-title stability, symbol coverage, and workflow alignment
- timeliness
  - scores the live source age against either `freshnessWithinHours` or a source-type default window

## Operator surfaces

Tool:

- `zee:invest-evals`

Actions:

- `create-dataset`
- `read-dataset`
- `list-datasets`
- `run-dataset`
- `read-run`
- `list-runs`

CLI:

```bash
zee investing eval dataset create --name daily-goldens --description "Daily research goldens" --owner research-qa --case-file ./cases.json
zee investing eval dataset list
zee investing eval dataset read <datasetId>
zee investing eval run create <datasetId> --strict
zee investing eval run read <runId>
zee investing eval run list --dataset-id <datasetId>
```

`--case-file` must point to a JSON array shaped like:

```json
[
  {
    "label": "NVDA preview artifact",
    "sourceKind": "research-artifact",
    "sourceId": "research-artifact-123",
    "expectations": {
      "freshnessWithinHours": 48
    }
  }
]
```

## Telemetry

This slice emits:

- `investing.eval.dataset`
  - dataset creation and dataset read/list activity
- `investing.eval.run`
  - harness execution totals, scores, ownership, and gate metadata
- `investing.eval.score`
  - per-case and aggregate factuality, consistency, and timeliness scores plus threshold breaches
- `investing.eval.gate`
  - strict gate outcome, blocked reasons, and owner routing key
- `investing.eval.alert`
  - routed regression and threshold-breach alerts for the owning team

That gives the evaluation epic a persisted baseline plus an enforceable gate before the v3 launch workflow consumes it.
