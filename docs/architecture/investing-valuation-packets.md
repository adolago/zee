# Investing Valuation Packets

Valuation packets are the export-ready layer on top of the valuation kernel. They standardize the exact contract downstream portfolio operations can consume without understanding the raw kernel internals.

## Packet schema

Each packet includes:

- `schemaVersion`
- `runId`
- `valuationCaseId`
- `symbol`
- `summary`
- `verdict`
- `portfolioContext`
- `operationsContext`
- `methods`
- `assumptionProvenance`
- `sensitivityTables`
- `thesisContext`
- `audit`

## Portfolio-ops context

Packets now carry downstream ops fields by default:

- `portfolioContext`
  - whether the symbol is already in the configured holdings file
- `operationsContext`
  - consumer audience and an audit key suitable for scheduling/logging systems
- `audit`
  - generation time plus export counters

This is the minimum packet contract needed for the later portfolio-ops workflows to consume valuation outputs without building a custom adapter per use case.

## Tool surface

Packets are exposed as `zee:invest-valuation-packets`.

Supported actions:

- `create`
  - inputs: `runId`, optional `overwrite`
- `read`
  - inputs: `packetId`
- `list`
  - inputs: optional `symbol`, optional `runId`, optional `limit`
- `export`
  - inputs: `packetId`, `format`

Exports currently support:

- `json`
- `markdown`

## diagnostics

This slice emits:

- `investing.valuation.packet`
  - one event per packet create/update
- `investing.valuation.packet.export`
  - one event per packet export
