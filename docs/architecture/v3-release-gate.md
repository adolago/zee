# V3 Release Gate

This slice closes `#518`.

Zee now exposes a single consolidated release gate report through `zee v3 status` and `zee v3 release`.

## Report contract

Report id:

- `v3-release-gate`

Categories:

- `reliability`
- `security`
- `performance`
- `docs`

Current gates:

- reliability
  - AgentDB memory wiring
  - hierarchical mesh capacity
  - agentic-flow plan decomposition
  - OpenCode runtime parity
- security
  - deep control-plane audit
  - node-client policy exposure
- performance
  - day-window usage latency and error-rate budget
- docs
  - required operator docs presence

## Operator usage

```bash
zee v3 status
zee v3 release
zee v3 release --strict
zee v3 release --json
```

`--strict` exits non-zero when any category gate fails.

## Performance budget

The current report treats the performance gate as passing when either:

- there is no recorded traffic in the trailing day window
- or the trailing day window stays within:
  - `avgLatencyMs <= 5000`
  - `errorRate <= 5%`

The report still prints request count, average latency, error rate, and cache-hit rate even when the gate is non-blocking because there is no traffic.

## Documentation checks

The consolidated report now verifies the presence of these operator-facing docs:

- `docs/architecture/opencode-runtime-rollout.md`
- `docs/architecture/v3-release-readiness.md`
- `docs/architecture/investing-eval-gates.md`

## Telemetry

This slice emits:

- `release.v3.report`
  - gate count
  - failure count
  - missing-doc count
  - trailing usage latency and error-rate metrics

That gives the rollout and launch slices a single release report object to extend instead of reassembling independent checks in each command.
