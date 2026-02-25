# Upstream Import Map (Zee)

This is the canonical, actionable import backlog across Zee's three upstream sources:

- OpenCode: `sst/opencode` (`opencode/dev`)
- OpenClaw: `openclaw/openclaw` (`openclaw/main`)
- Pi-mono: `badlogic/pi-mono` (`pimono/main`)

It tracks only bringable work (`port` / `adapt` / `defer`) and excludes completed or explicit non-goal items from the action table.

## Snapshot Metadata

Refresh timestamp (UTC): `2026-02-25`

Current upstream pins:

- OpenCode pin: `d848c9b6a32f408e8b9bf6448b83af05629454d0` (`opencode/dev`)
- OpenClaw pin: `b3f46f0e2891621467061e4c24851882609b2cbd` (`openclaw/main`)
- Pi-mono pin: `5c0ec26c28c918c5301f218e8c13fcc540d8e3a4` (`pimono/main`)
- Pi-mono latest tag: `v0.55.0`

Evidence commands run:

- `./scripts/check-upstream-all.sh --fetch`
- `./scripts/check-upstream.sh --remote opencode --fetch --verbose`
- `./scripts/check-upstream.sh --remote openclaw --fetch --verbose`
- `./scripts/check-upstream.sh --remote pimono --fetch --verbose`
- `./scripts/sync-upstream.sh --remote openclaw --preview`
- `./scripts/sync-upstream.sh --remote opencode --preview` (blocked by dirty worktree)
- `./scripts/sync-upstream.sh --remote pimono --preview`
- `cd packages/zee && bun run --conditions=browser ./src/index.ts compare --format text --scope quick --fetch --pins`
- `cd packages/zee && bun run --conditions=browser ./src/index.ts compare --format md --scope full --fetch --pins --output ../../docs/architecture/feature-comparison.md`

Observed drift summary:

- OpenCode: Zee is `2058` commits behind and `1445` commits ahead.
- OpenClaw: unrelated histories; no merge-base sync path. Snapshot TODOs in `openclaw-delta-map` are `0`, and `sync-upstream --remote openclaw --preview` reports `0` pending ports.
- Pi-mono: latest upstream tag `v0.55.0`; installed pin tracked via `docs/architecture/upstream-pins.json` (`piCodingAgentVersion: 0.53.1`).

## Roadmap Progress Rollup (2026-02-25)

| Roadmap artifact | Completed | Remaining |
| --- | --- | --- |
| `CVE-REMEDIATION-PLAN.md` | Deliverables checklist is `7/7` complete. | None in current phase scope. |
| `docs/architecture/adr-002-surface-layer.md` | Implementation plan phases 1-4 are marked complete (`12/12` checklist). | None listed in the phase checklist. |
| `docs/architecture/openclaw-delta-map.md` + `docs/architecture/openclaw-post-snapshot-backlog.md` | Snapshot triage closed (`Done: 66`, `None: 25`, `TODO: 0`) and post-snapshot ports are marked done/non-goal. | No pending OpenClaw ports in current sync preview. |
| `docs/architecture/opencode-lanes/lane-03-auth-provider.md` | Acceptance checklist complete (`3/3`). | Implementation candidate still pending execution. |
| `docs/architecture/opencode-lanes/lane-04-package-topology.md` | Acceptance checklist complete (`3/3`). | Phase 2 adaptation slice still pending. |
| `docs/architecture/opencode-lanes/lane-05-api-lsp-workflows.md` | Acceptance checklist complete (`3/3`). | Parity harness implementation remains pending. |
| `docs/architecture/opencode-sync-policy.md` | Lane refresh checklist completed for this cycle. | Continue weekly/monthly cadence. |
| `docs/architecture/feature-comparison.md` | Full feature matrix regenerated with fresh OpenCode/OpenClaw/Pi-mono pins and drift metadata. | Continue regenerating on each parity refresh. |
| `docs/plans/rust-memory-boundary.md` | Boundary, migration phases, and verification plan documented. | Implementation has not started. |
| `docs/architecture/upstream-import-map.md` | Active backlog re-ranked to `9` pending import lanes and grouped into execution batches. | Execute Batch A priorities first. |

## Decision Policy

Definitions:

- `port`: default for security/reliability parity with low architecture conflict.
- `adapt`: default when Zee architecture differs but import value is clear.
- `defer`: useful but non-critical after higher-risk backlog is stabilized.
- `non-goal`: upstream product surfaces Zee intentionally does not mirror.

Ranking policy:

1. Security and reliability risk first.
2. Migration impact for coding workflows second.
3. Implementation effort and dependency ordering third.

## Ranked Action Backlog (Re-ranked 2026-02-25)

| Rank | Upstream | Ref | Category | Decision | Current Zee status | Why bring | Target area | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | opencode | `adolago/zee#219` (Lane 01) | migration parity | adapt | open | Highest migration impact for day-to-day TUI workflows and user-visible parity gaps. | `packages/zee/src/cli/cmd/tui`, auth entrypoints, model selector | TUI parity checklist tests |
| 2 | opencode | `adolago/zee#221` (Lane 02) | migration parity | adapt | in-progress | Config portability (`models.dev`, mDNS, managed settings) remains a top onboarding blocker. | config schema/defaults + daemon/TUI network plumbing | config migration fixture tests + daemon/TUI mDNS regression coverage |
| 3 | opencode | `adolago/zee#290` (Lane 05) | API/LSP workflows | adapt | triage-done (harness pending) | Parity harness is required to keep LSP/serve behavior stable while upstream drift grows. | LSP stack, `serve`, attach/resume lifecycle | parity harness (`P05-LSP-001`, `P05-SRV-001`, `P05-SES-001`) |
| 4 | opencode | `adolago/zee#288` (Lane 03) | auth/provider parity | adapt | triage-done (implementation pending) | Explicit OpenCode-to-Zee auth/provider migration path reduces setup churn. | auth command flow (`zee auth`) + mapping docs | `zee auth import-opencode` fixture test |
| 5 | opencode | Lane 08 (`TBD`) | migration parity | adapt | backlog | `.opencode/` to `.zee/` migration ergonomics still lack fixture-backed import behavior. | project-config import/mapping path | fixture-driven migration test |
| 6 | opencode | Lane 09 (`TBD`) | workflow parity | adapt | backlog | Remote `serve`/client attach-resume parity still has no explicit closure harness. | server/client attach + auth lifecycle | remote attach/resume integration test |
| 7 | pimono | update to `v0.55.0` | dependency maintenance | adapt | backlog | Installed pin is `0.53.1` while upstream latest is `v0.55.0`; validate compatibility before bumping. | `docs/architecture/upstream-pins.json` + pi-dependent runtime paths | update pin + regression suite |
| 8 | opencode | `adolago/zee#289` (Lane 04) | package topology | adapt | triage-done (docs/sequence pending) | Adaptation slice is useful after core migration and workflow lanes stabilize. | migration docs + control/auth flow alignment | lane checklist completion + docs verification |
| 9 | opencode | Lane 07 (`TBD`) | provider breadth | defer | backlog | Useful, but lower ROI than migration-critical and workflow-critical lanes. | provider registry/policy docs | provider policy decision record |

## Recently Completed Imports (Reference)

- OpenClaw snapshot + post-snapshot security/reliability/feature ports remain closed in current roadmap artifacts (`openclaw-delta-map`, `openclaw-post-snapshot-backlog`).
- `sync-upstream --remote openclaw --preview` currently reports `0` pending ports.
- Pi-mono pin discoverability (rank-4 prior cycle) remains done via `docs/architecture/upstream-pins.json` and compare snapshot fallback logic.

## Immediate Execution Batches

### Batch A: OpenCode migration-critical parity (ranks 1-4)

Scope:

- Lane 01 (`#219`) TUI parity baseline
- Lane 02 (`#221`) config parity baseline
- Lane 05 (`#290`) parity harness (LSP/serve/session)
- Lane 03 (`#288`) auth/provider migration command flow

Acceptance:

- At least one fixture-backed parity harness exists for each of P05-LSP-001 / P05-SRV-001 / P05-SES-001.
- `.opencode` migration guidance is executable (not docs-only) for key config/auth paths.
- Top two migration blockers (TUI + config portability) have actionable implementation slices linked to issues.

Progress update (2026-02-25):

- Lane 02 moved to `in-progress`.
- Implemented slices: config-backed `models.url` / `models.path` support with provider tests; daemon/TUI forwarding of resolved mDNS options into server startup; `Config.reloadManaged()` lifecycle hook with regression coverage.
- Remaining closure work: explicit migration fixtures for OpenCode-style config imports.

### Batch B: Migration ergonomics + Pi-mono refresh prep (ranks 5-7)

Scope:

- Lane 08 `.opencode -> .zee` import path
- Lane 09 remote serve/client attach-resume closure
- Pi-mono bump validation path (`0.53.1 -> 0.55.0`)

Acceptance:

- `.opencode` import path is fixture-tested end to end.
- Remote attach/resume integration coverage exists for parity-critical scenarios.
- Pi-mono bump is either validated and promoted, or blocked with explicit failure evidence.

### Batch C: Deferred topology/provider breadth (ranks 8-9)

Scope:

- Lane 04 package topology adaptation slice
- Lane 07 provider breadth policy lane

Acceptance:

- Lane 04 has an implemented adaptation slice (not only planning docs).
- Lane 07 has explicit revisit criteria and owner with decision record.

## Exclusions (Non-Goals)

Excluded from the actionable backlog:

- OpenClaw non-WhatsApp messaging surfaces (Discord voice/presence, Matrix, MS Teams, similar channel expansions currently designated non-goal).
- OpenCode hosted package mirroring (`console`, `enterprise`, `identity`) as 1:1 topology parity.
- Historical rows already marked done in `openclaw-delta-map` or `openclaw-post-snapshot-backlog`.

## Source Artifacts

- `docs/architecture/openclaw-post-snapshot-backlog.md`
- `docs/architecture/openclaw-delta-map.md`
- `docs/architecture/zee-opencode-gap-map-top10.md`
- `docs/architecture/opencode-lanes/lane-03-auth-provider.md`
- `docs/architecture/opencode-lanes/lane-04-package-topology.md`
- `docs/architecture/opencode-lanes/lane-05-api-lsp-workflows.md`
- `docs/architecture/opencode-sync-policy.md`
- `docs/architecture/opencode-snapshot-playbook.md`
- `docs/architecture/upstream-differences.md`
