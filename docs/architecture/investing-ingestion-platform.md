# Investing Ingestion Platform

Zee's investing ingestion platform registers long-lived connector jobs inside the always-on daemon so research data stays fresh without depending on GitHub Actions or external cron.

Canonical entity and lineage details live in `docs/architecture/investing-entity-schema.md`.
Reliability, freshness monitoring, and backfill operations live in `docs/architecture/investing-data-reliability.md`.

## Connector coverage

Built-in connectors:

- `filings`
- `earnings`
- `transcripts`
- `market`
- `macro`
- `news`

Default cadences:

- `filings`: every 1440 minutes
- `earnings`: every 720 minutes
- `transcripts`: every 360 minutes
- `market`: every 60 minutes
- `macro`: every 180 minutes
- `news`: every 120 minutes

`filings`, `earnings`, and `market` inherit the shared `investing.ingestion.coverageSymbols` universe unless a connector-specific `symbols` override is set.

## Runtime model

- The always-on daemon registers the ingestion schedules during startup.
- Each connector is registered as a global scheduler task with an immediate first run plus recurring cadence.
- Scheduled runs are bound to the daemon's project instance so connector executions use the same config context as the rest of Zee.
- Connector state is persisted at `~/.local/state/zee/investing-ingestion.json`.
- Normalized research entities are persisted at `~/.local/state/zee/investing-entity-catalog.json`.
- Backfill operation history is persisted at `~/.local/state/zee/investing-ingestion-backfills.json`.
- A global freshness monitor task emits connector SLO compliance independently of run cadence.

## Operator commands

```bash
zee investing ingest status
zee investing ingest status --json
zee investing ingest run
zee investing ingest run filings
zee investing ingest backfill earnings --quarters 8
zee investing ingest backfill transcripts --symbol NVDA --lookback-days 14
zee investing ingest schedule
zee investing entity status
```

`zee investing ingest schedule` is mainly for an already-running resident process or debugging. The supported production path is the always-on daemon, which keeps the scheduler alive after registration.

## Configuration

```jsonc
{
  "investing": {
    "ingestion": {
      "enabled": true,
      "coverageSymbols": ["AAPL", "MSFT", "NVDA"],
      "connectors": {
        "filings": {
          "scheduleMinutes": 720
        },
        "earnings": {
          "quarters": 12,
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
        "market": {
          "symbols": ["SPY", "QQQ"],
          "freshnessSloMinutes": 120,
          "retryAttempts": 4,
          "retryDelayMs": 500
        },
        "macro": {
          "scheduleMinutes": 60,
          "freshnessSloMinutes": 360,
          "retryAttempts": 3,
          "retryDelayMs": 1000
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

Important behaviors:

- Setting `investing.ingestion.enabled` to `false` disables all connector scheduling.
- Disabling an individual connector removes it from schedule registration while leaving the rest active.
- `transcripts` and `news` support raw-path overrides for upstream API endpoints not yet modeled in the typed SDK.
- Connectors can override `freshnessSloMinutes`, `retryAttempts`, and `retryDelayMs`.
- `earnings`, `transcripts`, and `news` expose bounded backfill controls for local operator workflows.

## Telemetry

The platform emits Flux events for dashboards and release gates:

- `investing.ingestion.schedule`
  - emitted once per enabled connector when the daemon registers schedules
- `investing.ingestion.run`
  - emitted on every connector run with `ok` or `error` status, duration, request counts, normalized entity counts, and connector metadata
- `investing.ingestion.retry`
  - emitted for transient retry attempts with attempt number and backoff delay
- `investing.ingestion.freshness`
  - emitted by the local freshness monitor with SLO adherence and lateness metrics
- `investing.ingestion.backfill`
  - emitted for operator-triggered backfill operations
- `investing.entity.normalized`
  - emitted for each normalized connector batch with catalog upsert counts and entity-kind/source metrics

Recommended operator checks:

1. `zee investing ingest status --json` to inspect last-run timestamps and failure state.
2. `zee investing entity status --json` to inspect catalog totals and lineage-source counts.
3. Flux queries filtered to `domain=investing`.
4. Review `investing-ingestion.json` when reconciling connector freshness or repeated failures.
5. Review `investing-entity-catalog.json` when reconciling canonical IDs or lineage metadata.
6. Review `investing-ingestion-backfills.json` for operator-triggered historical recoveries.
