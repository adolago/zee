# Zee Roadmap: OpenClaw Alignment + OpenCode Runtime + Financial Research

Start date: 2026-03-05

## Objective

Bring Zee closer to OpenClaw architecture and operating model, replace pi-mono with OpenCode runtime paths, and make financial research (Stanley) a first-class autonomous capability.

## Principles

- OpenCode is the primary execution/runtime substrate.
- OpenClaw-style control-plane and policy enforcement is the target model.
- Financial research quality and repeatability are product-level requirements, not optional add-ons.
- Feature flags and compatibility shims are temporary and have explicit removal dates.

## Milestones

### M1: Architecture lock and migration plan (2026-03-08 to 2026-03-22)

- Freeze target architecture for control plane, runtime, and research stack.
- Define pi-mono compatibility shim contract and removal checkpoints.
- Lock baseline research entity model (company, filing, event, thesis, catalyst, risk, valuation case).

Exit criteria:
- ADR set approved.
- Migration matrix published.
- Epic breakdown and dependency graph complete.

### M2: OpenCode substrate and compatibility layer (2026-03-23 to 2026-04-30)

- Ship OpenCode runtime adapter and route command execution through it.
- Add compatibility shims for legacy pi-mono interfaces.
- Add telemetry for parity gaps and fallback usage.

Exit criteria:
- Primary CLI and orchestration paths can run in OpenCode mode.
- All legacy calls are observable through shim metrics.
- No new pi-mono-only features accepted.

### M3: OpenClaw parity core (2026-05-01 to 2026-06-15)

- Align operator scope model, control-plane endpoints, and node pairing/revocation flows.
- Complete policy enforcement surface (`deny`, `allowlist`, `full`) and deep audit hooks.
- Harden gateway action pack security posture.

Exit criteria:
- Control-plane parity checklist passes.
- Deep security audit reports clean in strict mode for reference deployment.
- Node lifecycle controls fully operational.

### M4: Financial research data foundation (2026-06-16 to 2026-07-31)

- Build ingestion and normalization for filings, earnings, transcripts, price/volume, macro, and news.
- Persist unified research memory graph with queryable lineage.
- Standardize identifier strategy across instruments and sources.
- Operator runbook for connector scheduling and telemetry: `docs/architecture/investing-ingestion-platform.md`.
- Canonical entity and lineage contract: `docs/architecture/investing-entity-schema.md`.
- Reliability and backfill runbook: `docs/architecture/investing-data-reliability.md`.

Exit criteria:
- Data freshness SLAs defined and monitored.
- Research entities available through stable API/tool contracts.
- Historical backfill complete for core coverage universe.

### M5: Autonomous research workflows (2026-08-01 to 2026-09-15)

- Implement thesis generation/update loops, valuation packs, catalyst and risk tracking.
- Add portfolio-linked daily and earnings briefing pipelines.
- Add quality evaluation harness (factuality, consistency, timeliness).
- Research workflow planner and task decomposition runbook: `docs/architecture/investing-research-planner.md`.
- Multi-source synthesis executor runbook: `docs/architecture/investing-synthesis-executor.md`.
- Structured report artifacts and diagnostics runbook: `docs/architecture/investing-report-artifacts.md`.
- Valuation model kernel runbook: `docs/architecture/investing-valuation-kernel.md`.
- Valuation assumption provenance and sensitivity runbook: `docs/architecture/investing-valuation-provenance.md`.

Exit criteria:
- End-to-end automated research run produces usable analyst packet.
- Briefing pipelines run unattended and emit structured deltas.
- Quality gates meet agreed threshold.

### M6: Release hardening and launch (2026-09-16 to 2026-10-15)

- Finalize v3 readiness gates for reliability, security, performance, and documentation.
- Cut release candidate, run staged rollout, and publish rollback plan.

Exit criteria:
- Release gates pass in strict mode.
- v3.0.0 release checklist complete.
- Post-release stabilization plan published.

## Epic backlog (execution order)

1. `epic/opencode-runtime-core`
2. `epic/pi-mono-compat-shim-and-removal`
3. `epic/openclaw-control-plane-parity`
4. `epic/node-client-and-policy-enforcement`
5. `epic/financial-data-ingestion-platform`
6. `epic/stanley-research-orchestrator`
7. `epic/valuation-engine`
8. `epic/news-and-earnings-intelligence`
9. `epic/thesis-memory-and-change-tracking`
10. `epic/portfolio-research-ops`
11. `epic/research-quality-evals`
12. `epic/v3-release-readiness`

## Dependency constraints

- `opencode-runtime-core` must start before parity and orchestration epics can complete.
- `financial-data-ingestion-platform` must complete baseline before advanced research automation.
- `research-quality-evals` should run in parallel once first autonomous workflows are available.

## Program metrics

- Runtime parity coverage (% requests served by OpenCode path).
- Shim burn-down (% of legacy interfaces removed).
- Security audit failures (strict mode).
- Research freshness SLA adherence.
- Research factuality/consistency score.
