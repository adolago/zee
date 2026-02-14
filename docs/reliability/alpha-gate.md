# Zee Alpha Reliability Gate

The alpha reliability gate is executed by `zee reliability run` and fails hard on any required stage failure.

## Run Locally

```bash
cd packages/zee
bun run script/reliability/run.ts --profile alpha
```

Quick diagnostic mode:

```bash
cd packages/zee
bun run script/reliability/run.ts --profile diag --long-soak-minutes 5
```

CLI entrypoint:

```bash
zee reliability run --profile alpha
```

## Output

Artifacts are written to:

`artifacts/reliability/<timestamp>/`

Key files:

- `report.json`: full `ReliabilityReportV1`
- `command-log.md`: top-level command and environment trace
- `<stage>/stage.log`: per-stage execution log
- `<stage>/*.stdout.log`, `<stage>/*.stderr.log`: daemon/runtime output
- `<stage>/failure-snapshot-*.log`: host diagnostics captured on failure

## Stage List (Alpha)

1. `R01_build_and_binary_integrity`
2. `R02_source_vs_dist_parity`
3. `R03_daemon_singleton_and_locking`
4. `R04_daemon_recovery_and_restart`
5. `R05_gateway_preflight_and_conflict_handling`
6. `R06_gateway_channel_live_checks`
7. `R07_tui_lifecycle_no_orphans`
8. `R08_mode_switch_stress`
9. `R09_provider_health_live`
10. `R10_memory_health_live`
11. `R11_long_soak`
12. `R12_postmortem_artifacts`

## Notes

- The suite isolates daemon state under the artifact directory via `ZEE_STATE_DIR`.
- Existing host config/credentials are copied into the isolated runtime when available.
- External provider/gateway checks are blocking by design in alpha profile.
