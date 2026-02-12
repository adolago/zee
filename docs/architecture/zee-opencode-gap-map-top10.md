# OpenCode Delta Map (Zee / opencode)

This document is the canonical OpenCode triage map tracked by `adolago/zee#287`.

It is intentionally a triage document (`port` / `adapt` / `defer` / `non-goal`), not an implementation log.

## Snapshot Pins

Use these pins when comparing Zee to OpenCode:

- Zee: `6d33cec12c9c` (full `6d33cec12c9ce20e4fc326c3c4eadb21b8e0d080`)
- opencode/dev: `624dd94b5dd8` (full `624dd94b5dd8dca03aa3b246312f8b54fd3331f1`)

Baseline reference: `docs/architecture/upstream-differences.md`.

## Triage Policy (Default)

- Security and reliability fixes: default to `port` (or `adapt` when architecture differs).
- Product-level features: default to `adapt` or `defer`.
- OpenCode-only hosted surfaces: default to `non-goal` unless Zee product direction changes.
- Every lane keeps an explicit decision and an owner for the next concrete slice.

## Lane Index (Ranked Backlog Source)

| Rank | Lane | Issue | Area | Default decision | Status | Lane artifact |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 01 | [#219](https://github.com/adolago/zee/issues/219) | TUI parity baseline (thinking keybind, remote auth, custom models path) | adapt | open | `docs/architecture/upstream-differences.md` |
| 2 | 02 | [#221](https://github.com/adolago/zee/issues/221) | Config parity baseline (models.dev URL, mDNS domain, managed settings) | adapt | open | `docs/architecture/upstream-differences.md` |
| 3 | 03 | [#288](https://github.com/adolago/zee/issues/288) | Auth/provider plugin parity and migration ergonomics | adapt | open | `docs/architecture/opencode-lanes/lane-03-auth-provider.md` |
| 4 | 04 | [#289](https://github.com/adolago/zee/issues/289) | Web/desktop/package topology parity strategy | adapt | open | `docs/architecture/opencode-lanes/lane-04-package-topology.md` |
| 5 | 05 | [#290](https://github.com/adolago/zee/issues/290) | API/LSP/server workflow parity deltas | adapt | open | `docs/architecture/opencode-lanes/lane-05-api-lsp-workflows.md` |
| 6 | 06 | [#291](https://github.com/adolago/zee/issues/291) | Upstream sync automation and policy | port | open | `docs/architecture/opencode-sync-policy.md` |
| 7 | 07 | `TBD` | Provider breadth parity (extra `@ai-sdk/*` footprint vs Zee policy) | defer | backlog | `docs/architecture/feature-comparison.md` |
| 8 | 08 | `TBD` | Project-local `.opencode/` migration ergonomics into `.zee/` | adapt | backlog | `docs/architecture/upstream-differences.md` |
| 9 | 09 | `TBD` | Client/server mode behavior parity (serve flows, remote clients) | adapt | backlog | `docs/architecture/feature-comparison.md` |
| 10 | 10 | `TBD` | OpenCode-only hosted/package surfaces (`console`, `enterprise`, `identity`) | non-goal | backlog | `docs/architecture/upstream-differences.md` |

## Lane Notes

### Lane 01 (`#219`): TUI parity baseline

- Scope: preserve user-facing parity where it reduces migration surprise for coding-agent users.
- Current decision: `adapt`.
- Exit signal: document and implement parity-critical UX deltas only; avoid OpenCode-specific product coupling.

### Lane 02 (`#221`): Config parity baseline

- Scope: map high-value config deltas that affect portability and onboarding.
- Current decision: `adapt`.
- Exit signal: managed settings remain Zee-native while preserving practical migration path from OpenCode defaults.

### Lane 03 (`#288`): Auth/provider plugin parity

- Scope: provider/auth plugin surface and migration guidance.
- Current decision: `adapt`.

### Lane 04 (`#289`): Web/desktop/package topology

- Scope: package-level topology and non-goal boundaries.
- Current decision: `adapt`.

### Lane 05 (`#290`): API/LSP/server workflows

- Scope: parity-critical coding workflows and acceptance tests.
- Current decision: `adapt`.

### Lane 06 (`#291`): Upstream sync policy

- Scope: repeatable triage automation and evidence standards.
- Current decision: `port` (process and tooling parity).

## Refresh Process (Pinned to `opencode/dev`)

Cadence:
- Weekly quick check (maintainer routine).
- Monthly lane refresh and rank revalidation.
- Immediate refresh when upstream introduces breaking workflow changes.

Required evidence per refresh:
- Updated `opencode/dev` pin.
- Updated lane decision table entries for changed deltas.
- Linked command output references from the snapshot playbook.

Minimum command sequence:

```bash
./scripts/check-upstream.sh --remote opencode --fetch
./scripts/check-upstream-all.sh
./scripts/sync-upstream.sh --remote opencode --preview
```

If rank ordering changes, update this file first and then open or relink lane issues.
