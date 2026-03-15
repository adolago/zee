# Investing Thesis Confidence Rules

This slice closes `#510`.

The thesis ledger now requires evidence links for every persisted thesis revision and applies a deterministic confidence rule before any conviction change is accepted.

## Rule contract

Rule ID:

- `thesis-confidence.v1`

Each revision now carries a `confidence` block with:

- `requestedConviction`
  - the conviction requested by the caller or carried forward from the prior thesis state
- `appliedConviction`
  - the conviction actually written after the rule runs
- `maxAllowedConviction`
  - the highest conviction the linked evidence bundle is allowed to support
- `score`
  - rule score derived from evidence count, tool diversity, and linked valuation context
- `evidenceCount`
  - number of linked evidence references on the revision
- `uniqueTools[]`
  - distinct tool paths represented by the evidence
- `reasons[]`
  - operator-readable explanation for the resulting conviction

## Current rules

`thesis-confidence.v1` applies these checks:

1. A thesis revision must include at least one evidence reference.
2. Evidence count contributes to the confidence score.
3. Distinct tool-path coverage contributes to the confidence score.
4. Linked valuation context contributes to the confidence score.
5. A `balanced` valuation signal caps conviction at `medium` even when evidence is otherwise strong.
6. If the requested conviction is stronger than the rule allows, Zee downshifts it and records the reason.

The rule is intentionally simple and deterministic. It gives operators an explicit audit trail now, while leaving room for richer scoring and policy later.

## Execution integration

The `thesis-refresh` path now does two things before it writes a revision:

- converts completed research evidence into thesis evidence references
- runs `thesis-confidence.v1` and stores the result on both the revision and the current thesis record

The thesis snapshot appended to synthesis output now also shows the applied confidence rule and reasons so operators can audit the conviction before reading the persisted change log.

## Telemetry

This slice emits:

- `investing.thesis.confidence`
  - one event per thesis revision confidence evaluation
- `investing.thesis.revision`
  - now includes requested and applied conviction metadata

## Operator checks

Use the thesis ledger record or revision payload to inspect:

- whether the revision had evidence links
- which tools backed the change
- whether the requested conviction was downgraded
- why the rule accepted the final conviction level
