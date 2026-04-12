# Investing Research Planner

Zee's investing research planner gives Stanley a repeatable way to break multi-step research objectives into explicit tasks, persist plan state locally, and emit diagnostics for operators.

## Scope

The planner is designed for research setup and decomposition, not final synthesis. It answers:

- what workflow should this objective follow?
- which tasks should run next?
- which tool surfaces are expected for each task?
- what is the current state of the workflow?

Persisted plans live at `~/.local/state/zee/investing/research-plans.json`.

## Tool surface

The planner is exposed as `zee:invest-planner`.

Supported actions:

- `create`
  - inputs: `objective`, optional `workflow`, optional `symbols`
- `read`
  - inputs: `planId`
- `list`
  - inputs: optional `status`, optional `limit`
- `update`
  - inputs: `planId`, `taskId`, `status`, optional `note`

Example payloads:

```json
{
  "action": "create",
  "objective": "Prepare a pre-earnings preview for NVDA",
  "symbols": ["NVDA"]
}
```

```json
{
  "action": "update",
  "planId": "research-plan-1234abcd5678",
  "taskId": "expectation-map",
  "status": "completed",
  "note": "Consensus and guideposts captured"
}
```

## Workflow templates

Supported workflow kinds:

- `company-brief`
- `earnings-preview`
- `earnings-review`
- `thesis-refresh`
- `valuation-refresh`
- `event-follow-up`
- `peer-compare`

If the caller does not specify a workflow, Zee infers one from the objective text. Each workflow emits a fixed task template with:

- `id`
- `phase`
- `title`
- `description`
- `toolIds`
- `dependsOn`
- `deliverable`
- `status`

The planner auto-starts the first task and auto-advances the next dependency-ready task when the current one is marked `completed`.

## Task design

The templates intentionally point Stanley toward the existing investing tool surface:

- `zee:invest-status`
- `zee:invest-research`
- `zee:invest-sec-filings`
- `zee:invest-market-data`
- `zee:invest-estimates`
- `zee:invest-insider-trades`
- `zee:invest-segments`
- `zee:invest-scratchpad`

That keeps workflow decomposition aligned with the actual tool inventory instead of creating planner-only steps that cannot be executed.

## diagnostics

The planner emits event bus events under `domain=investing`:

- `investing.research.plan`
  - emitted when a plan is created
  - metadata includes workflow kind, objective, symbols, phases, and task count
- `investing.research.plan.task`
  - emitted when a task status changes
  - metadata includes plan status, task status, task id/title, symbols, and optional operator note

Recommended checks:

1. Query event bus for `kind=investing.research.plan` to track research intake volume by workflow.
2. Query event bus for `kind=investing.research.plan.task` to find blocked tasks and stalled workflows.
3. Inspect `research-plans.json` when reconciling planner state with a live research session.

## Operating loop

1. Create a plan at the start of any multi-step research objective.
2. Execute the active task using the listed investing tools.
3. Update the task status as evidence is gathered.
4. Let the planner auto-advance the next dependency-ready task.
5. Use `list` or `read` to resume work across sessions.
