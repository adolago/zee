# OpenCode Delta Map (Zee / opencode)

This document is the canonical OpenCode triage map tracked by `adolago/zee#287`.

It is intentionally a triage document (`port` / `adapt` / `defer` / `non-goal`), not an implementation log.

## Snapshot Pins

Use these pins when comparing Zee to OpenCode:

- Zee: `a141706a7cd8` (full `a141706a7cd86543daae5b393cc1df7fea10cfd4`)
- opencode/dev: `d848c9b6a32f` (full `d848c9b6a32f408e8b9bf6448b83af05629454d0`)

Last refreshed: `2026-02-25`

Baseline reference: `docs/architecture/upstream-differences.md`.

## Triage Policy (Default)

- Security and reliability fixes: default to `port` (or `adapt` when architecture differs).
- Product-level features: default to `adapt` or `defer`.
- OpenCode-only hosted surfaces: default to `non-goal` unless Zee product direction changes.
- Every lane keeps an explicit decision and an owner for the next concrete slice.

## Lane Index (Ranked Backlog Source)

| Rank | Lane | Issue | Area | Default decision | Status | Lane artifact |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 01 | [#219](https://github.com/adolago/zee/issues/219) | TUI parity baseline (thinking keybind, remote auth, custom models path) | adapt | in-progress | `docs/architecture/upstream-differences.md` |
| 2 | 02 | [#221](https://github.com/adolago/zee/issues/221) | Config parity baseline (models.dev URL, mDNS domain, managed settings) | adapt | in-progress | `docs/architecture/upstream-differences.md` |
| 3 | 05 | [#290](https://github.com/adolago/zee/issues/290) | API/LSP/server workflow parity deltas | adapt | in-progress | `docs/architecture/opencode-lanes/lane-05-api-lsp-workflows.md` |
| 4 | 03 | [#288](https://github.com/adolago/zee/issues/288) | Auth/provider plugin parity and migration ergonomics | adapt | in-progress | `docs/architecture/opencode-lanes/lane-03-auth-provider.md` |
| 5 | 08 | `TBD` | Project-local `.opencode/` migration ergonomics into `.zee/` | adapt | in-progress | `docs/architecture/upstream-differences.md` |
| 6 | 09 | `TBD` | Client/server mode behavior parity (serve flows, remote clients) | adapt | in-progress | `docs/architecture/feature-comparison.md` |
| 7 | 04 | [#289](https://github.com/adolago/zee/issues/289) | Web/desktop/package topology parity strategy | adapt | triage-done | `docs/architecture/opencode-lanes/lane-04-package-topology.md` |
| 8 | 06 | [#291](https://github.com/adolago/zee/issues/291) | Upstream sync automation and policy | port | triage-done | `docs/architecture/opencode-sync-policy.md` |
| 9 | 07 | `TBD` | Provider breadth parity (extra `@ai-sdk/*` footprint vs Zee policy) | defer | backlog | `docs/architecture/feature-comparison.md` |
| 10 | 10 | `TBD` | OpenCode-only hosted/package surfaces (`console`, `enterprise`, `identity`) | non-goal | backlog | `docs/architecture/upstream-differences.md` |

## Re-ranking Rationale (2026-02-25)

- Promoted lane 05 ahead of lane 03 because executable LSP/serve/session harness coverage is now the fastest way to control parity regressions while drift is `2076` commits behind.
- Promoted lanes 08/09 above lane 04 because migration ergonomics and remote attach behavior directly impact day-one OpenCode portability.
- Demoted lane 06 (sync policy) because the process lane is operational and currently in maintenance mode.

## Lane Notes

### Lane 01 (`#219`): TUI parity baseline

- Scope: preserve user-facing parity where it reduces migration surprise for coding-agent users.
- Current decision: `adapt`.
- 2026-02-25 progress: added remote attach auth regression coverage for 401 password-prompt retry and explicit-password attach flow (`test/cli/attach-shared-auth.test.ts`).
- Exit signal: document and implement parity-critical UX deltas only; avoid OpenCode-specific product coupling.

### Lane 02 (`#221`): Config parity baseline

- Scope: map high-value config deltas that affect portability and onboarding.
- Current decision: `adapt`.
- 2026-02-25 progress: shipped config-backed `models.url` / `models.path` support, daemon/TUI mDNS forwarding to server startup, and managed settings reload hook (`Config.reloadManaged()`) with test coverage.
- Exit signal: managed settings remain Zee-native while preserving practical migration path from OpenCode defaults.

### Lane 03 (`#288`): Auth/provider plugin parity

- Scope: provider/auth plugin surface and migration guidance.
- Current decision: `adapt`.
- 2026-02-25 progress: added `zee auth import-opencode` first implementation slice with fixture-backed tests and dry-run diagnostics.
- 2026-02-26 progress: expanded mapping coverage (provider/server/top-level keys) and added structured unknown-key diagnostics with remediation hints.
- Artifact: `docs/architecture/opencode-lanes/lane-03-auth-provider.md`.

### Lane 04 (`#289`): Web/desktop/package topology

- Scope: package-level topology and non-goal boundaries.
- Current decision: `adapt`.
- Artifact: `docs/architecture/opencode-lanes/lane-04-package-topology.md`.

### Lane 05 (`#290`): API/LSP/server workflows

- Scope: parity-critical coding workflows and acceptance tests.
- Current decision: `adapt`.
- 2026-02-26 progress: shipped parity harness baseline tests for `P05-LSP-001`, `P05-SRV-001`, `P05-SES-001`, and `P05-CFG-001`.
- Artifact: `docs/architecture/opencode-lanes/lane-05-api-lsp-workflows.md`.

### Lane 06 (`#291`): Upstream sync policy

- Scope: repeatable triage automation and evidence standards.
- Current decision: `port` (process and tooling parity).
- Artifacts:
  - `docs/architecture/opencode-sync-policy.md`
  - `docs/architecture/opencode-snapshot-playbook.md`

### Lane 08 (`TBD`): `.opencode/` migration ergonomics

- Scope: practical import/mapping path from `.opencode/` project defaults into `.zee/`.
- Current decision: `adapt`.
- 2026-02-25 progress: baseline import path now implemented through `zee auth import-opencode` (`.opencode/opencode.jsonc` -> `.zee/zee.jsonc` + auth store).
- Exit signal: fixture-backed import path with explicit diagnostics for unsupported keys.

### Lane 09 (`TBD`): Client/server mode behavior parity

- Scope: remote `serve`/attach/resume behavior and auth lifecycle parity.
- Current decision: `adapt`.
- 2026-02-26 progress: attach auth lifecycle and resume continuity now covered by baseline parity tests.
- Exit signal: integration harness verifies attach/resume parity in remote workflow scenarios.

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
