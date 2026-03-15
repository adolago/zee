# Investing Earnings Packets

This slice closes `#513`.

## Implementation plan

- reuse persisted research executions and artifacts as the packet source of truth
- join those executions with event delta intelligence and thesis-linked valuation state
- expose one operator surface for create/read/list/export instead of forcing manual assembly

## Contract

State file:

- `~/.local/state/zee/investing/earnings-packets.json`

Each packet stores:

- `schemaVersion`
  - current value: `earnings-packet.v1`
- `workflow`
  - `earnings-preview` or `earnings-review`
- `status`
  - `ready` or `degraded`
- `summary`
  - concise packet outcome across catalysts, risks, and valuation context
- `catalysts[]`
  - event delta records selected for the relevant earnings mode
- `risks[]`
  - thesis watchpoints, negative event deltas, and research diagnostics
- `valuation`
  - current thesis-linked valuation snapshot plus comparison against the most recent prior packet
- `sections[]`
  - operator sections for overview, synthesis, catalysts, risks, valuation change, evidence, and diagnostics

## Inputs

The packet is built from already-persisted workflow state:

- research execution and artifact output for the chosen earnings execution
- event delta intelligence in `pre-earnings` or `post-earnings` mode
- thesis ledger state, including the latest linked valuation snapshot

That keeps packet generation deterministic:

- no new research run is required to create a packet
- valuation change reporting is anchored to persisted thesis state instead of freeform notes

## Tool surface

The operator surface is `zee:invest-earnings-packets`.

Supported actions:

- `create`
  - inputs: `executionId`, optional `overwrite`
- `read`
  - inputs: `packetId`
- `list`
  - inputs: optional `symbol`, `workflow`, `executionId`, `limit`
- `export`
  - inputs: `packetId`, `format`

The CLI mirror is `zee investing earnings-packet ...`.

## Telemetry

This slice emits:

- `investing.earnings.packet`
  - one event per persisted earnings packet
  - metadata includes symbol, workflow, packet status, catalyst count, risk count, and valuation linkage
- `investing.earnings.packet.export`
  - one event per operator export
  - metadata includes workflow, symbol, format, and export count
