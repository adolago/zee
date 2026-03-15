# Investing Ingestion Platform

Zee's investing ingestion platform registers long-lived connector jobs inside the always-on daemon so research data stays fresh without depending on GitHub Actions or external cron.

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

## Operator commands

```bash
zee investing ingest status
zee investing ingest status --json
zee investing ingest run
zee investing ingest run filings
zee investing ingest schedule
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
          "quarters": 12
        },
        "transcripts": {
          "endpointPath": "/api/transcripts/recent",
          "lookbackDays": 14
        },
        "market": {
          "symbols": ["SPY", "QQQ"]
        },
        "macro": {
          "scheduleMinutes": 60
        },
        "news": {
          "endpointPath": "/api/news/recent",
          "lookbackDays": 3
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

## Telemetry

The platform emits Flux events for dashboards and release gates:

- `investing.ingestion.schedule`
  - emitted once per enabled connector when the daemon registers schedules
- `investing.ingestion.run`
  - emitted on every connector run with `ok` or `error` status, duration, request counts, and connector metadata

Recommended operator checks:

1. `zee investing ingest status --json` to inspect last-run timestamps and failure state.
2. Flux queries filtered to `domain=investing`.
3. Review `investing-ingestion.json` when reconciling connector freshness or repeated failures.
