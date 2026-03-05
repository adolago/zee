# OpenClaw Lane 08: Cron, wake/heartbeat, background jobs

Tracking issue: `adolago/zee#231`

## Decision Summary

- Cron scheduler reliability hardening: `port`
- Heartbeat timing/active-hours behavior: `adapt`
- Background-job lifecycle/recovery controls: `port`

## Port/Adapt Notes

- Keep Zee cron/heartbeat defaults explicit and fail-safe.
- Preserve Zee-specific daemon/runtime lifecycle while porting reliability-critical controls.
- Ensure background tasks remain observable through existing diagnostics surfaces.

## Non-goals

- Scheduler architecture replacement when reliability can be achieved incrementally.

## Test Gates

1. Cron enqueue/dequeue reliability with persistence.
2. Heartbeat active-hours enforcement.
3. Background-job recovery after daemon restart.

## Next Actions Completion

- [x] Record explicit lane-08 port/adapt decisions.
- [x] Define reliability-focused test gates for cron/heartbeat/background jobs.
- [x] Mark architecture-replacement work as non-goal for this lane.
