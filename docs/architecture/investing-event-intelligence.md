# Investing Event Intelligence

Zee's event-intelligence layer classifies normalized `earnings` and `news` entities into a persistent event ledger, then scores and links those events for downstream research automation.

This document now covers:

- issue `#506`: ingestion and classification
- issue `#507`: materiality scoring and entity-linking

Briefing deltas remain the follow-on work for `#508`.

## Source Of Truth

- Event ledger: `~/.local/state/zee/investing-event-intelligence.json`
- Entity catalog dependency: `~/.local/state/zee/investing-entity-catalog.json`
- Portfolio coverage file: `~/.zee/investing/portfolio.json` or `ZEE_INVESTING_PORTFOLIO_FILE`
- Watchlist coverage file: `~/.zee/investing/watchlist.json` or `ZEE_INVESTING_WATCHLIST_FILE`

## Classification Scope

Supported connectors:

- `earnings`
- `news`

Current classifications:

- `earnings_result`
- `guidance_update`
- `mna`
- `management_change`
- `legal_regulatory`
- `product_and_partnership`
- `capital_allocation`
- `general_news`

Each record also carries:

- connector (`earnings` or `news`)
- direction (`positive`, `negative`, `neutral`, `mixed`, `unknown`)
- classifier confidence (`0.0` to `1.0`)
- canonical entity linkage (`entityId`, `companyId`, `instrumentId`, `relatedIds`)
- source provenance (`sourceId`, `sourceType`, optional `sourceUrl`)

## Materiality And Linking

Each persisted event is enriched with:

- `entityLinks`
  - issuer and instrument IDs
  - derived sector IDs and labels when source or coverage data exposes sector metadata
  - optional holding and watchlist entity IDs (`holding:equity:<symbol>`, `watchlist:equity:<symbol>`)
  - an audience classification of `holding`, `watchlist`, or `general`
- `materiality`
  - numeric score from `0` to `100`
  - band: `critical`, `high`, `medium`, or `low`
  - human-readable scoring reasons

Materiality inputs in this slice:

- event classification
- event direction and classifier confidence
- recency
- sector context
- linkage to holdings and watchlist symbols

## Operator Surfaces

CLI:

```bash
zee investing event status
zee investing event list --limit 20
zee investing event list --connector news --classification guidance_update --symbol MSFT
zee investing event list --materiality-band high --holding
zee investing event read classified:event:news:msft:story-1
```

Domain tool:

- `zee:invest-events`
  - `status`
  - `list`
  - `read`

## Ingestion Flow

1. Connector payloads are normalized into canonical entities.
2. `earnings` and `news` event entities are classified into the event ledger.
3. Each classified record is enriched with materiality and coverage links using the configured holdings/watchlist context.
4. Each enriched record is upserted by stable ID (`classified:<entity-id>`).
5. Connector run telemetry includes classified-event counts, materiality-band counts, and coverage-link counts for that batch.

## Telemetry

Flux events emitted for this slice:

- `investing.event.classified`
  - one event per inserted or updated classified record
  - metadata includes `eventId`, `entityId`, `connector`, `classification`, `direction`, `confidence`, `symbol`, and `mode`
- `investing.event.scored`
  - one event per inserted or updated scored record
  - metadata includes `eventId`, `materialityScore`, `materialityBand`, `audience`, and holding/watchlist linkage flags
- `investing.ingestion.run`
  - now includes `classifiedEventCount`, `classifiedEventTypes`, `eventInserted`, `eventUpdated`, `materialityBands`, `holdingLinkedCount`, and `watchlistLinkedCount` when the connector produces classified events

## Notes

- News classification is heuristic and keyword-driven in this slice.
- Earnings classification is deterministic from the normalized earnings connector event shape.
- Materiality scoring is intentionally heuristic in this slice; calibration and precision tuning remain follow-on work.
- Briefing/thesis integration remains follow-on work.
