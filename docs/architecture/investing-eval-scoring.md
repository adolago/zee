# Investing Eval Scoring

This slice closes `#516`.

The investing eval harness now computes deterministic `factuality`, `consistency`, and `timeliness` scores for every case and every run.

## Threshold profile

Score profile:

- `research-leads.v1`

Thresholds:

- `structural >= 100`
- `factuality >= 85`
- `consistency >= 85`
- `timeliness >= 80`

The profile is persisted on every eval run so later CI gates can enforce the same standard without guessing which rubric was used.
That strict enforcement now happens in the `#517` eval-gate slice.

## Scorer rules

### Factuality

Inputs:

- citation coverage against the dataset case minimum
- diagnostic budget adherence
- summary alignment with the golden snapshot
- status alignment with the golden snapshot

### Consistency

Inputs:

- summary alignment
- section-title alignment
- symbol coverage alignment
- workflow alignment when the source exposes a workflow

### Timeliness

Inputs:

- `freshnessWithinHours` from the dataset case when present
- otherwise a source-type default window:
  - `portfolio-briefing`: 24h
  - `earnings-packet`: 48h
  - `research-artifact`: 72h

The score decays as the live source drifts outside that window.

## Run contract additions

Each eval run now includes:

- `scoreProfile`
- `thresholds`
- `scores.factuality`
- `scores.consistency`
- `scores.timeliness`
- `thresholdBreaches[]`

Each case result now includes:

- per-case `scores`
- per-case `thresholdBreaches[]`
- scorer `reasons` for factuality, consistency, and timeliness

## diagnostics

This slice emits:

- `investing.eval.score`
  - one event per case score
  - one aggregate event per eval run

That gives the CI gate enough signal to route regressions and fail builds on explicit score thresholds.
