# Investing Portfolio Briefings

This slice closes `#512`.

The portfolio briefing layer turns existing research outputs into a daily holdings and watchlist workflow instead of making operators stitch together thesis records and event deltas by hand.

## Daily brief contract

State file:

- `~/.local/state/zee/investing/portfolio-briefings.json`

Each briefing stores:

- `schemaVersion`
  - current value: `portfolio-brief.v1`
- `kind`
  - current value: `daily-portfolio-brief`
- `summary`
  - high-level daily ops summary across holdings and watchlist coverage
- `coverage`
  - counts for holdings, watchlist names, thesis-backed symbols, and event deltas
- `symbols[]`
  - one row per holding or watchlist name with:
    - audience (`holding` or `watchlist`)
    - optional position context
    - current thesis summary/conviction/posture/version
    - latest linked valuation snapshot from thesis state
    - relevant daily event deltas
- `sections[]`
  - rendered operator sections for overview, holdings, and watchlist review

## Inputs

The daily briefing consumes three already-persisted research layers:

- portfolio holdings from the configured portfolio file
- watchlist symbols from the configured watchlist file or explicit overrides
- thesis state from the thesis ledger
- daily event deltas from event intelligence

That means the workflow stays lightweight and deterministic:

- no new research execution is required to create the brief
- the brief is always grounded in the latest persisted thesis and event state

## Tool surface

The operator surface is `zee:invest-briefings`.

Supported actions:

- `create`
  - inputs: `kind`, optional `watchlistSymbols`
- `read`
  - inputs: `briefingId`
- `list`
  - inputs: optional `kind`, `symbol`, `audience`, `limit`

The existing `zee_invest_morning_brief` plugin output now appends the rendered portfolio briefing so the daily user-facing brief also reflects holdings and watchlist deltas.

## Telemetry

This slice emits:

- `investing.portfolio.briefing`
  - one event per persisted daily portfolio briefing
  - metadata includes symbol coverage, thesis coverage, and event-delta counts
