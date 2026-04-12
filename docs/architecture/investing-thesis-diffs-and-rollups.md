# Investing Thesis Diffs And Portfolio Rollups

This slice closes `#511`.

The thesis ledger now exposes operator-facing query APIs for record reads, revision history, revision diffs, and portfolio-level rollup views.

## Query surfaces

New tool:

- `zee:invest-thesis`

Supported actions:

- `read`
  - load a thesis record by `thesisKey` or symbol
- `list`
  - filter thesis records by symbol, status, conviction, or posture
- `history`
  - inspect timestamped revision history for one thesis
- `diff`
  - compare any two thesis versions, including evidence, watchpoint, valuation, and confidence deltas
- `portfolio-rollup`
  - build a holdings/watchlist view from current thesis state

CLI:

```bash
zee investing thesis status
zee investing thesis read NVDA
zee investing thesis list --conviction medium
zee investing thesis history thesis:nvda
zee investing thesis diff NVDA --from-version 1 --to-version 2
zee investing thesis rollup --audience all
```

## Diff contract

Each diff payload includes:

- `fromRevision`
  - source version metadata
- `toRevision`
  - target version metadata
- `changedFields[]`
  - top-level fields that moved between versions
- `changes.summary`
- `changes.thesis`
- `changes.conviction`
- `changes.posture`
- `changes.watchpoints`
- `changes.evidence`
- `changes.valuation`
- `changes.confidence`

That gives operators a stable JSON contract for timestamped thesis deltas without rereading the full revision log.

## Portfolio rollup contract

`portfolio-rollup` builds a view directly from:

- `~/.local/state/zee/investing/theses.json`
- `ZEE_INVESTING_PORTFOLIO_FILE` or `~/.zee/investing/portfolio.json`
- `ZEE_INVESTING_WATCHLIST_FILE` or `~/.zee/investing/watchlist.json`

The rollup reports:

- holdings and watchlist coverage
- tracked thesis count and missing thesis gaps
- counts by posture and conviction
- one entry per holding or watchlist symbol with current thesis summary, latest revision metadata, watchpoints, and valuation context

Missing thesis coverage is explicit so portfolio ops can see where the thesis system still has gaps.

## diagnostics

This slice emits:

- `investing.thesis.query`
  - thesis record reads, filtered lists, history queries, and diffs
- `investing.thesis.rollup`
  - portfolio rollup generation with coverage counts and filter metadata

These events complete the thesis epic metrics loop by making query usage and portfolio rollup coverage observable alongside the existing revision and confidence diagnostics from `#509` and `#510`.
