# OpenCode Upstream Sync Policy (Lane 06)

Tracking issue: `adolago/zee#291`

## Purpose

Define a repeatable, auditable policy for syncing Zee against `sst/opencode` (`opencode/dev`) and updating OpenCode delta lanes without manual drift.

## Scope

- OpenCode upstream tracking only (`opencode/dev`).
- Lane triage updates in `docs/architecture/zee-opencode-gap-map-top10.md` and lane docs.
- Evidence capture requirements for maintainers.

## Cadence

- Weekly quick-check:
  - detect upstream movement and high-risk delta signals
- Monthly refresh:
  - refresh pin, re-score ranked lane backlog, update lane decisions
- Event-triggered refresh:
  - run immediately when upstream introduces breaking or parity-critical workflow changes

## Pin Policy

- All OpenCode comparisons must declare a pinned upstream commit from `opencode/dev`.
- Pin location:
  - `docs/architecture/upstream-differences.md` (current upstream pins section)
  - `docs/architecture/zee-opencode-gap-map-top10.md` (snapshot pins section)
- Pin updates must be accompanied by:
  - command evidence from the snapshot playbook
  - lane decision delta summary

## Decision Policy

- `port`:
  - default for clear security/reliability parity deltas with low architecture conflict
- `adapt`:
  - default for user-facing workflow parity where Zee architecture differs
- `defer`:
  - useful but non-critical items not needed for parity-safe operation
- `non-goal`:
  - OpenCode product surfaces Zee intentionally does not plan to mirror

## Evidence Requirements

Each monthly or event-triggered refresh must include:

1. Current `opencode/dev` commit hash.
2. `check-upstream` output proving ahead/behind state.
3. `sync-upstream --preview` output for proposed merge impact.
4. Updated lane map with any rank/decision changes.
5. Explicit notes for any reclassified items (`port` <-> `adapt` <-> `defer` <-> `non-goal`).

## Lane Update Checklist

- [ ] Refresh upstream metadata via playbook commands.
- [ ] Update pinned commit hashes in comparison docs.
- [ ] Re-evaluate top-10 rank ordering in `zee-opencode-gap-map-top10.md`.
- [ ] Update lane artifacts for changed deltas.
- [ ] Open/follow-up lane issues when new items enter top-10.
- [ ] Record why each changed item is `port`/`adapt`/`defer`/`non-goal`.

## Ownership

- Responsible maintainer: `@adolago`
- Backup reviewer: repository maintainers with upstream-sync context

Policy changes should be proposed via PR and reference this lane.
