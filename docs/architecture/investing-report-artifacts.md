# Investing Report Artifacts

Structured investing report artifacts sit on top of the research planner and synthesis executor. They turn each persisted execution into a stable JSON contract that operators and future evals can score without reparsing freeform notes.

## Implementation plan

This slice adds three things:

1. A local artifact store at `~/.local/state/zee/investing/research-artifacts.json`.
2. Automatic artifact generation after every research execution.
3. Actionable diagnostics for degraded or failed runs, plus a read/list tool surface.

## Artifact contract

Each artifact includes:

- `id`
- `executionId`
- `planId`
- `taskId`
- `workflow`
- `kind`
- `status`
- `title`
- `objective`
- `symbols`
- `summary`
- `sections[]`
- `citations[]`
- `nextActions[]`
- `diagnostics[]`

Artifact kinds map to workflow phases:

- `scope-note`
- `source-delta`
- `analysis-memo`
- `research-brief`
- `failure-diagnostic`

Artifact status signals rollout quality:

- `ready`: all evidence sources completed
- `degraded`: execution completed but one or more evidence sources failed
- `failed`: no usable evidence was collected

## Diagnostics model

Every degraded or failed run emits structured diagnostics with:

- the affected tool or source
- the failure detail
- an operator action
- an optional command hint

Current remediations focus on:

- missing symbol scope
- investing runtime or connector failures
- stale or missing ingestion coverage
- blocked downstream plan tasks

## Tool surface

Artifacts are exposed as `zee:invest-artifacts`.

Supported actions:

- `create`
  - inputs: `executionId`, optional `overwrite`
- `read`
  - inputs: `artifactId`
- `list`
  - inputs: optional `planId`, optional `taskId`, optional `executionId`, optional `status`, optional `limit`

The executor also auto-generates an artifact after each run and stores the resulting `artifactId` on the execution packet.

## Telemetry

This slice emits:

- `investing.research.artifact`
  - one event per generated or refreshed artifact
- `investing.research.diagnostic`
  - one event per diagnostic emitted for degraded or failed runs

These events give operators a stable control-plane signal for future eval gates and reliability review.

## Operating loop

1. Create a plan with `zee:invest-planner`.
2. Run a task with `zee:invest-executor`.
3. Read the generated artifact via `zee:invest-artifacts`.
4. If the artifact is `degraded` or `failed`, follow `diagnostics[]` and `nextActions[]`.
5. Rerun the execution once coverage is restored.
