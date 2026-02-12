# OpenCode Lane 05: API/LSP/Server Workflow Parity

Tracking issue: `adolago/zee#290`

## Scope

- Inventory API/LSP/server workflow deltas relevant to coding-agent users.
- Record explicit `port` / `adapt` / `defer` decisions per workflow.
- Define acceptance tests for parity-critical paths.

## Workflow Delta Inventory

| Workflow area | Zee behavior | OpenCode behavior | Decision | Rationale | Reference |
| --- | --- | --- | --- | --- | --- |
| CLI session lifecycle (`run`, `session`, `tui`) | Zee is forked but persona/system integrations add behavior | OpenCode keeps coding-agent-first defaults | adapt | Preserve Zee product semantics while minimizing migration surprise in core coding flows. | `docs/architecture/upstream-differences.md` (CLI command surface) |
| Server mode semantics (`serve`) | Zee has serve/gateway routes and daemonized paths | OpenCode has client/server mode focused on coding workflows | adapt | Preserve Zee gateway/daemon model while maintaining expected coding-agent server operations. | `docs/architecture/feature-comparison.md` (`arch.client-server`, `api.control-plane`) |
| LSP capability surface | Zee has LSP support with fork-level divergence risk | OpenCode positions LSP as core capability | port | LSP interoperability is parity-critical for editor-driven workflows. | `docs/architecture/feature-comparison.md` (`dev.lsp`) |
| Project-local config discovery (`.zee/` vs `.opencode/`) in workflow commands | Zee uses `.zee/` | OpenCode uses `.opencode/` | adapt | Keep Zee-local convention while documenting migration behavior and fallback strategy. | `docs/architecture/upstream-differences.md` (Config and state model) |
| Remote auth and credential flow in server/client workflows | Zee has auth/profile commands but migration path is less explicit | OpenCode users expect straightforward server/client auth setup | adapt | Improve migration ergonomics without replacing Zee auth model. | `docs/architecture/feature-comparison.md` (`model.auth-profiles`) |
| Workflow analytics/telemetry parity dashboards | Zee does not prioritize OpenCode-style telemetry surface parity | OpenCode ecosystem includes additional workflow visibility surfaces | defer | Useful but not required for correctness or migration safety in core coding flows. | `docs/architecture/upstream-differences.md` (Top-level and package layout differences) |
| OpenCode-specific hosted/API surfaces | Zee intentionally diverges in hosted package topology | OpenCode includes additional hosted surfaces | non-goal | Not required for parity-critical coding workflows. | `docs/architecture/upstream-differences.md` (Monorepo package layout) |

## Parity-Critical Shortlist

1. LSP request/response correctness for common editor flows.
2. Server startup and client attach semantics for remote coding sessions.
3. Session lifecycle continuity (`run` -> attach -> resume) with consistent history behavior.

## Acceptance Test Matrix (Parity-Critical)

| Test ID | Scenario | Expected result |
| --- | --- | --- |
| P05-LSP-001 | Start LSP mode and issue diagnostics/completion requests on a fixture project | Responses are valid, stable, and no protocol errors are emitted. |
| P05-SRV-001 | Launch `serve` mode, connect a client, execute a tool-assisted coding task | Client attaches successfully; request/response lifecycle is completed without auth regressions. |
| P05-SES-001 | Start a coding run, detach, then resume session from CLI | Session context resumes correctly and preserves relevant history/metadata. |
| P05-CFG-001 | Run workflow in a repo with `.opencode/` inputs mapped to Zee docs guidance | User receives explicit migration instructions; no silent misconfiguration. |

## Concrete Implementation Candidate

### Candidate A: Workflow parity harness for LSP + serve mode

- Owner: `@adolago`
- Decision type: `port` for LSP correctness checks, `adapt` for surrounding workflow semantics
- Candidate behavior:
  - add a fixture-driven parity harness for key LSP and serve scenarios
  - run the same scenario set across Zee workflow entrypoints
  - report divergence classes (protocol mismatch, auth/setup mismatch, session lifecycle mismatch)
- Minimum test scope:
  - LSP protocol smoke tests
  - serve/connect/resume integration test
  - regression fixture for migration guidance path (`.opencode/` -> `.zee/`)

## Acceptance Checklist

- [x] Workflow delta inventory with upstream refs
- [x] Parity-critical shortlist and acceptance tests
- [x] Explicit `port` / `adapt` / `defer` / `non-goal` decisions for tracked items
