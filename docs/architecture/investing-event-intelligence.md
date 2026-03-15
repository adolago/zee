# Investing Event Intelligence

Zee's event-intelligence layer classifies normalized `earnings` and `news` entities into a persistent event ledger for downstream research automation.

This slice implements issue `#506`: ingestion and classification.
It does not yet assign materiality scores or briefing deltas; those remain the follow-on work for `#507` and `#508`.

## Source Of Truth

- Event ledger: `~/.local/state/zee/investing-event-intelligence.json`
- Entity catalog dependency: `~/.local/state/zee/investing-entity-catalog.json`

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

## Operator Surfaces

CLI:

```bash
zee investing event status
zee investing event list --limit 20
zee investing event list --connector news --classification guidance_update --symbol MSFT
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
3. Each classified record is upserted by stable ID (`classified:<entity-id>`).
4. Connector run telemetry includes classified-event counts and unique event types for that batch.

## Telemetry

Flux events emitted for this slice:

- `investing.event.classified`
  - one event per inserted or updated classified record
  - metadata includes `eventId`, `entityId`, `connector`, `classification`, `direction`, `confidence`, `symbol`, and `mode`
- `investing.ingestion.run`
  - now includes `classifiedEventCount`, `classifiedEventTypes`, `eventInserted`, and `eventUpdated` when the connector produces classified events

## Notes

- News classification is heuristic and keyword-driven in this slice.
- Earnings classification is deterministic from the normalized earnings connector event shape.
- Materiality scoring, precision tuning, and briefing/thesis integration remain follow-on work.
