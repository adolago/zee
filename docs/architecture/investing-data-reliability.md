# Investing Data Reliability

Zee monitors investing connector freshness locally inside the always-on daemon and provides bounded retry and backfill controls for operators. This keeps data maintenance on the same machine as the runtime instead of waiting on remote CI.

## Reliability contract

- Every connector has a `freshnessSloMinutes` target.
- Connector runs persist their last result, timing, item counts, and freshness metadata in `~/.local/state/zee/investing-ingestion.json`.
- Manual backfill operations persist the last 50 requests in `~/.local/state/zee/investing-ingestion-backfills.json`.
- Freshness is reported as one of:
  - `fresh`: last successful run completed within the configured SLO window
  - `stale`: last successful run exceeded the SLO window
  - `missing`: no successful run has completed yet, or the last run failed
  - `disabled`: connector is disabled in config

## Default SLOs and retry policy

- `filings`: SLO 2880 minutes, 3 attempts, 1000 ms base retry delay
- `earnings`: SLO 1440 minutes, 3 attempts, 1000 ms base retry delay
- `transcripts`: SLO 720 minutes, 4 attempts, 1000 ms base retry delay
- `market`: SLO 120 minutes, 4 attempts, 500 ms base retry delay
- `macro`: SLO 360 minutes, 3 attempts, 1000 ms base retry delay
- `news`: SLO 240 minutes, 4 attempts, 1000 ms base retry delay

Retry delays are linear backoff: attempt `n` waits `retryDelayMs * n`. Retries are only used for transient connector failures; permanent validation/configuration failures stop immediately.

## Operator commands

```bash
zee investing ingest status
zee investing ingest status --json
zee investing ingest run filings
zee investing ingest backfill earnings --quarters 8
zee investing ingest backfill transcripts --symbol NVDA --lookback-days 14
zee investing ingest backfill news --symbol AAPL --symbol MSFT --lookback-days 7 --json
```

`zee investing ingest status` reports each connector's `freshness` status, configured SLO, last outcome, request count, and normalized entity count.

## Configuration

```jsonc
{
  "investing": {
    "ingestion": {
      "coverageSymbols": ["AAPL", "MSFT", "NVDA"],
      "connectors": {
        "earnings": {
          "scheduleMinutes": 720,
          "freshnessSloMinutes": 1440,
          "retryAttempts": 3,
          "retryDelayMs": 1000,
          "backfillMaxQuarters": 16
        },
        "transcripts": {
          "endpointPath": "/api/transcripts/recent",
          "lookbackDays": 14,
          "freshnessSloMinutes": 720,
          "retryAttempts": 4,
          "retryDelayMs": 1000,
          "backfillMaxLookbackDays": 30
        },
        "news": {
          "endpointPath": "/api/news/recent",
          "lookbackDays": 3,
          "freshnessSloMinutes": 240,
          "retryAttempts": 4,
          "retryDelayMs": 1000,
          "backfillMaxLookbackDays": 30
        }
      }
    }
  }
}
```

Backfill guardrails:

- `earnings` accepts `--quarters` up to `backfillMaxQuarters`
- `transcripts` and `news` accept `--lookback-days` up to `backfillMaxLookbackDays`
- other connectors reject unsupported override flags
- symbol overrides are allowed for symbol-scoped connectors and are recorded with the operation

## Telemetry

The reliability layer emits Flux events under `domain=investing`:

- `investing.ingestion.retry`
  - emitted on every retry attempt with the connector, attempt number, configured retry budget, and delay
- `investing.ingestion.freshness`
  - emitted by the local freshness monitor for every connector with the current status, SLO window, lateness, and last run metadata
- `investing.ingestion.backfill`
  - emitted for manual backfill start outcomes with symbol/quarter/lookback context and result counts

The always-on daemon also registers a global `investing.ingestion.freshness.monitor` task. Its cadence is half of the smallest enabled connector SLO, clamped to a minimum of 5 minutes.

## Local operating loop

1. Run `zee investing ingest status --json` to identify stale or missing connectors.
2. If the connector is failing transiently, inspect Flux events for `investing.ingestion.retry`.
3. If coverage is missing historically, run a bounded `zee investing ingest backfill ...` command.
4. Re-check `zee investing entity status --json` to confirm normalized entities were produced.
5. Inspect the two state files when reconciling repeated failures, stale data, or operator backfill history.
