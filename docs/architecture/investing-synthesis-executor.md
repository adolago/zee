# Investing Synthesis Executor

The investing synthesis executor turns a planned research task into a persisted execution packet with evidence links, source provenance, and a task-level synthesis note.

## Scope

This slice sits directly after the research planner:

- planner: decide what should be done
- executor: run the current task across relevant sources
- thesis ledger: capture versioned thesis revisions from completed refreshes
- later slices: richer thesis diff/query and portfolio views

Persisted execution packets live at `~/.local/state/zee/investing/research-executions.json`.

## Tool surface

The executor is exposed as `zee:invest-executor`.

Supported actions:

- `run`
  - inputs: `planId`, optional `taskId`
- `read`
  - inputs: `executionId`
- `list`
  - inputs: optional `planId`, optional `taskId`, optional `limit`

## Execution model

When `run` is called, Zee:

1. Loads the research plan and resolves the active task.
2. Maps the task's source tools into concrete source fetches.
3. Collects evidence items from each source.
4. Assigns stable evidence citations such as `E1`, `E2`, and stable links such as `evidence:<executionId>:E1`.
5. Produces a synthesis note that embeds those evidence links.
6. For `earnings-preview` and `earnings-review`, appends the highest-signal scored event deltas for the symbol scope.
7. For `thesis-refresh`, appends a structured thesis snapshot derived from the latest valuation evidence.
8. Appends the standard investing provenance block.
9. Persists the execution packet and advances the task in the planner.
10. After the execution artifact is written, records a new thesis revision for `thesis-refresh-brief`.

If a task has no directly executable source tools, the executor reuses the latest evidence from dependency tasks so synthesis steps can still cite prior evidence.

## Current source coverage

The executor currently synthesizes across:

- investing runtime health
- SEC filings
- research endpoint output
- market data
- analyst estimates
- insider trade flow
- segment coverage gap markers

That matches the currently available investing tool surface and avoids fake citations to sources Zee did not actually call.

## Output contract

Each execution packet contains:

- `id`
- `planId`
- `taskId`
- `workflow`
- `status`
- `startedAt`
- `finishedAt`
- `synthesis`
- `evidence[]`
- `provenance`

Each evidence item contains:

- `citation`
- `link`
- `toolId`
- `sourceLabel`
- `args`
- `status`
- `summary`

## diagnostics

The executor emits event bus events under `domain=investing`:

- `investing.research.execution`
  - one event per execution run with workflow, task, and evidence counts
- `investing.research.evidence`
  - one event per evidence item with citation, source label, and summary

For earnings-oriented workflows, the executor also consumes `investing.event.delta` diagnostics emitted by the event-delta builder when it materializes briefing-ready deltas.

For thesis-refresh workflows, the executor also triggers `investing.thesis.revision` once the versioned thesis change log is updated.

The executor also relies on the planner's `investing.research.plan.task` diagnostics when it marks a task `completed` or `blocked` after execution.

## Operating loop

1. Create a plan with `zee:invest-planner`.
2. Run the active task with `zee:invest-executor`.
3. Inspect the resulting `synthesis` and `evidence` links.
4. Re-run on the next active task or override `taskId` for targeted execution.
5. Use `read` and `list` to resume or audit research sessions.
