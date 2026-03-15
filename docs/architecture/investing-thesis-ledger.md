# Investing Thesis Ledger

The thesis ledger persists one canonical thesis record per `thesisKey` and a versioned revision log that later diff, query, and portfolio workflows can build on.

This slice closes `#509`.

## Record contract

State file:

- `~/.local/state/zee/investing/theses.json`

Each record stores:

- `id`
  - stable thesis key such as `thesis:nvda`
- `symbol`
  - normalized equity ticker
- `status`
  - current lifecycle state for the thesis record
- `conviction`
  - current conviction label carried across revisions
- `posture`
  - current directional posture (`bullish`, `neutral`, `bearish`)
- `currentVersion`
  - latest revision number for the thesis
- `summary`
  - operator-facing one-line thesis summary
- `thesis`
  - latest persisted thesis body
- `watchpoints[]`
  - next monitoring items that should trigger a refresh
- `valuation`
  - latest linked valuation case, packet, run, and signal metadata
- `confidence`
  - latest applied thesis confidence assessment
- `revisions[]`
  - append-only change log for the thesis

## Revision contract

Each revision stores:

- `version`
  - monotonic revision number per thesis
- `changeType`
  - `initialize`, `refresh`, `valuation-sync`, or `operator-update`
- `summary`
  - concise statement of what changed
- `thesis`
  - full persisted thesis body at that revision
- `conviction`
  - conviction label at that revision
- `posture`
  - directional posture at that revision
- `watchpoints[]`
  - operator follow-up list captured for that revision
- `valuation`
  - linked valuation snapshot for later diffing
- `evidence[]`
  - references to persisted evidence or valuation packets
- `confidence`
  - applied confidence rule, capped conviction, and operator-readable reasons
- `source`
  - workflow/task/execution/artifact pointers when the revision came from automation

## Automatic updates

Two flows now keep the ledger warm:

- valuation packet creation syncs the base thesis record and latest valuation context from `thesisContext.thesisKey`
- `thesis-refresh` synthesis execution appends a new revision after the execution artifact is created

That gives the thesis lifecycle epic a stable handoff:

- the thesis record already exists by the time a research refresh runs
- the revision log already carries workflow, execution, artifact, and valuation references

## Operator checks

CLI:

```bash
zee investing thesis status
zee investing thesis status --json
```

`zee investing thesis status` reports total theses, total revisions, and current counts by status and conviction.

Confidence rules and downgrade behavior are documented in `docs/architecture/investing-thesis-confidence.md`.

## Telemetry

Flux events emitted for this slice:

- `investing.thesis.record`
  - emitted whenever a thesis record is created, updated, or advanced by a revision
- `investing.thesis.revision`
  - emitted whenever a new thesis revision is appended to the change log
- `investing.thesis.confidence`
  - emitted whenever Zee evaluates the confidence rule for a thesis revision
