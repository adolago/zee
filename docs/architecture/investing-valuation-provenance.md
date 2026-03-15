# Investing Valuation Provenance

The valuation provenance layer extends the valuation kernel with two operator-facing guarantees:

- every material valuation assumption is traceable back to a method/source path
- every valuation run includes explicit sensitivity tables that thesis tracking can diff later

## Added contract

Valuation runs now carry:

- `valuationCaseId`
  - canonical `valuation_case` identifier for downstream thesis linkage
- `assumptionProvenance[]`
  - one row per traced assumption
- `sensitivityTables[]`
  - standardized tables for DCF, comparables, and blended scenarios
- `thesisContext`
  - stable `thesisKey`, `valuationCaseId`, and a high-level valuation signal

## Assumption provenance

Each assumption row records:

- `method`
- `name`
- `value`
- `sourceType`
- `sourcePath`
- `sourceLabel`

Current provenance sources:

- valuation overview assumptions
- DCF assumptions
- comparable-set assumptions
- scenario-model multipliers

## Sensitivity tables

This slice standardizes three tables per valuation run:

- DCF discount-rate sensitivity
- comparable-company range sensitivity
- blended bull/base/bear scenario surface

The framework is deterministic and lightweight on purpose. It gives Zee a stable schema now, while leaving room for richer model-specific sensitivity engines later.

## Thesis integration

The valuation layer now emits a stable `valuationCaseId` plus `thesisContext.thesisKey`.

That is the forward-compatible handoff for the thesis lifecycle epic:

- thesis systems can link a thesis record to a valuation case without re-deriving IDs
- valuation signal changes can be diffed against later thesis revisions

The thesis ledger now consumes that handoff directly:

- valuation packet creation keeps the base thesis record warm
- `thesisKey`, `valuationCaseId`, and the valuation signal are copied into the persisted thesis ledger for later refreshes

## Telemetry

This slice emits:

- `investing.valuation.assumption`
  - one event per traced assumption row
- `investing.valuation.sensitivity`
  - one event per sensitivity table
