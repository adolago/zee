# Investing Research Ops Automation

This slice closes `#514`.

## Implementation plan

- persist explicit research-op schedules instead of relying on ad hoc reminders
- register those schedules inside the always-on process, following the same global scheduler pattern as ingestion
- materialize delivery content into a durable audit trail so operators can inspect every unattended run

## Runtime model

State file:

- `~/.local/state/zee/investing/ops-automation.json`

The state file stores two records:

- `schedules[]`
  - workflow, cadence, enabled state, optional symbol scope, output format, delivery target, and last-run audit summary
- `deliveries[]`
  - one record per unattended or operator-triggered run with artifact type/id, delivered content, timestamps, and error detail when a run fails

Supported workflows:

- `daily-portfolio-brief`
- `earnings-preview-packet`
- `earnings-review-packet`

Supported delivery target:

- `audit-log`
  - the rendered artifact is persisted directly into the delivery record so operators can review the exact unattended output later

## Operator surfaces

CLI:

- `zee investing ops schedule create`
- `zee investing ops schedule read`
- `zee investing ops schedule list`
- `zee investing ops schedule update`
- `zee investing ops schedule run`
- `zee investing ops delivery read`
- `zee investing ops delivery list`

Tool surface:

- `zee:invest-ops`

Supported tool actions:

- `create-schedule`
- `update-schedule`
- `read-schedule`
- `list-schedules`
- `run-schedule`
- `read-delivery`
- `list-deliveries`

## Always-on integration

- the always-on daemon registers enabled research-op schedules during startup
- schedules run as global scheduler tasks so they keep firing without GitHub Actions or external cron
- the daily portfolio brief workflow materializes the latest persisted portfolio briefing
- earnings workflows locate the latest matching synthesis execution, regenerate the packet if needed, and store the delivered content in the audit trail

## Telemetry

This slice emits:

- `investing.ops.schedule`
  - emitted when schedules are created, updated, or registered with the resident scheduler
- `investing.ops.delivery`
  - emitted on every unattended or operator-triggered run with workflow, artifact linkage, format, target, and error detail when applicable
