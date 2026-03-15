# Investing Entity Schema

Zee normalizes investing connector payloads into a canonical entity catalog so research automation can address the same company, filing, or event across filings, earnings, transcripts, market data, macro calendars, and news.

## Canonical kinds

The schema supports these entity kinds:

- `company`
- `instrument`
- `filing`
- `event`
- `thesis`
- `catalyst`
- `risk`
- `valuation_case`

Current ingestion connectors emit `company`, `instrument`, `filing`, and `event`. The valuation kernel now also mints canonical `valuation_case` identifiers for downstream thesis linkage. The remaining kinds are reserved for later research-orchestration issues.

## Identifier strategy

Canonical IDs are deterministic, lowercase, and prefix-scoped by entity kind:

- `company:equity:aapl`
- `instrument:equity:aapl`
- `filing:equity:aapl:10-k:2026-02-01`
- `event:earnings:aapl:q4-2025:2026-01-28t00-00-00-000z`
- `event:news:msft:story-1`

Rules:

1. The leftmost segment is always the canonical kind or subtype family.
2. Equity-linked entities normalize the ticker to uppercase for display and lowercase for ID segments.
3. Connector-native identifiers such as filing dates, transcript/article IDs, URLs, and event codes are preserved in `identifiers.external` and `lineage.sourceId`.
4. Related entities link through `relatedIds`, plus `identifiers.company` and `identifiers.instrument` where applicable.

## Lineage contract

Every normalized entity carries lineage metadata:

- `source`
  - one of `filings`, `earnings`, `transcripts`, `market`, `macro`, `news`, `manual`, or `derived`
- `sourceType`
  - connector-specific subtype such as `sec_filing`, `earnings_analysis`, `market_snapshot`, `transcript`, `news`, or `macro_calendar`
- `sourceId`
  - the stable upstream record identifier or synthesized connector key
- `parentIds`
  - canonical parent references such as company/instrument IDs
- `collectedAt`
  - when Zee ingested the upstream payload
- `evidence`
  - selected source facts such as ticker, filing form, quarter label, or URL

## Persistence and operator checks

- Catalog path: `~/.local/state/zee/investing-entity-catalog.json`
- Connector run state: `~/.local/state/zee/investing-ingestion.json`

CLI:

```bash
zee investing entity status
zee investing entity status --json
zee investing ingest status
```

`zee investing entity status` reports total catalog size plus counts by kind and lineage source.

## Telemetry

Flux events emitted for this slice:

- `investing.entity.normalized`
  - emitted whenever a connector batch is normalized into the catalog
  - metadata includes `batchCount`, `inserted`, `updated`, `batchKinds`, `countsByKind`, and `countsByLineageSource`
- `investing.ingestion.run`
  - now includes `normalizedEntityCount` and `normalizedKinds`

## Compatibility note

The normalized catalog is the canonical ID and lineage layer for investing ingestion. It does not replace existing answer-level provenance blocks in session transcripts, which still describe which tools were used to answer a question.
