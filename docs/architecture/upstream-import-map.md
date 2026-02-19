# Upstream Import Map (Zee)

This is the canonical, actionable import backlog across Zee's three upstream sources:

- OpenCode: `sst/opencode` (`opencode/dev`)
- OpenClaw: `openclaw/openclaw` (`openclaw/main`)
- Pi-mono: `badlogic/pi-mono` (`pimono/main`)

It tracks only bringable work (`port` / `adapt` / `defer`) and excludes completed or explicit non-goal items from the action table.

## Snapshot Metadata

Refresh timestamp (UTC): `2026-02-19T20:14:42.271Z`

Current upstream pins:

- OpenCode pin: `1867f1acaa894244086d994c71b47bff8301f747` (`opencode/dev`)
- OpenClaw pin: `f7a8c2df2c6eea297f2f5e702f23f0ba2fa574d6` (`openclaw/main`)
- Pi-mono pin: `7207c16c848e1422131236982441d8a310cbcfb7` (`pimono/main`)
- Pi-mono latest tag: `v0.53.1`

Evidence commands run:

- `./scripts/check-upstream-all.sh --fetch`
- `./scripts/check-upstream.sh --remote opencode --fetch --verbose`
- `./scripts/check-upstream.sh --remote openclaw --fetch --verbose`
- `./scripts/check-upstream.sh --remote pimono --fetch --verbose`
- `./scripts/sync-upstream.sh --remote openclaw --preview`
- `./scripts/sync-upstream.sh --remote opencode --preview` (blocked by dirty worktree)
- `cd packages/zee && bun run --conditions=browser ./src/index.ts compare --format text --scope quick --fetch --pins`

Observed drift summary:

- OpenCode: Zee is `1907` commits behind and `1417` commits ahead.
- OpenClaw: unrelated histories; no merge-base sync path. Snapshot TODOs in `openclaw-delta-map` are `0`, but post-snapshot backlog still has actionable items.
- Pi-mono: latest upstream tag `v0.53.1`; installed pin tracked via `docs/architecture/upstream-pins.json` (`piCodingAgentVersion: 0.53.1`).

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

## Ranked Action Backlog

| Rank | Upstream | Ref | Category | Decision | Current Zee status | Why bring | Target area | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | openclaw | `openclaw/openclaw#15035` | security/reliability | adapt | done (local) | Brute-force resistance and auth endpoint hardening for gateway control plane. | `packages/zee/src/server/auth-rate-limit.ts`, `packages/zee/src/server/server.ts` | `cd packages/zee && bun test test/server/auth-rate-limit.test.ts` |
| 2 | openclaw | `openclaw/openclaw#13184` | security | adapt | done (local) | Loopback-by-default binding reduces accidental external exposure in standalone channel/server surfaces. | `packages/zee/src/cli/network.ts`, `packages/zee/src/diagnostics/checks/security.ts` | `cd packages/zee && bun test test/cli/network.test.ts test/diagnostics/security.test.ts` |
| 3 | openclaw | `openclaw/openclaw#10529` | security | adapt | done (local) | Enforcing strict credential file mode checks prevents local secret disclosure. | `packages/zee/src/diagnostics/checks/security.ts` credential file checks (`auth.json`, `mcp-auth.json`, Kimi credentials) | `cd packages/zee && bun test test/diagnostics/security.test.ts` |
| 4 | pimono | dependency pin hygiene | security/ops | port | done (local) | Explicit pi-mono pin manifest restores safe update decisions and auditability when no direct dependency is declared. | `scripts/lib/upstream-common.sh`, `packages/zee/src/compare/snapshot.ts`, `docs/architecture/upstream-pins.json` | `./scripts/check-upstream.sh --remote pimono --fetch --verbose`, `cd packages/zee && bun test test/compare/snapshot.test.ts` |
| 5 | openclaw | `openclaw/openclaw#15195` | reliability | adapt | done (local) | Process guard improvements reduce runtime wedging and orphaned subprocess behavior. | `packages/zee/src/cli/cmd/runtime-process-guard.ts`, `packages/zee/src/cli/cmd/daemon.ts`, `packages/zee/src/cli/cmd/restart-recovery.ts`, `scripts/recover-orphaned-processes.sh`, `packages/zee/Swabble/src/process/parent-guard.ts` | `cd packages/zee && bun test test/cli/runtime-process-guard.test.ts test/cli/restart-recovery.test.ts ./Swabble/src/process/parent-guard.test.ts` |
| 6 | openclaw | `openclaw/openclaw#13746` | reliability | port | done (local) | Avoid flushing pending tool results before agents are idle to prevent dropped outputs. | `packages/zee/Swabble/src/agents/pi-embedded-runner/wait-for-idle-before-flush.ts` | `cd packages/zee && bun test ./Swabble/src/agents/pi-embedded-runner.guard.waitforidle-before-flush.test.ts` |
| 7 | openclaw | `openclaw/openclaw#13578` | reliability | port | done (local) | Prevent silent `allowList[0]` fallback misrouting in outbound messaging. | `packages/zee/Swabble/src/channels/outbound/whatsapp-target.ts` fail-closed target resolver | `cd packages/zee && bun test ./Swabble/src/channels/outbound/whatsapp-target.test.ts` |
| 8 | openclaw | `openclaw/openclaw#14949` | reliability | adapt | done (local) | Transcript archival on `/new` and `/reset` prevents history loss and improves operability. | `packages/zee/Swabble/src/gateway/session-utils.fs.ts`, `packages/zee/Swabble/src/gateway/session-lifecycle.ts` | `cd packages/zee && bun test ./Swabble/src/gateway/session-utils.fs.archive.test.ts ./Swabble/src/gateway/session-lifecycle.reset-archive.test.ts` |
| 9 | openclaw | `openclaw/openclaw#12846` | reliability | adapt | done (local) | Session-key normalization prevents duplicate/ghost sessions. | `packages/zee/Swabble/src/gateway/session-utils.ts` | `cd packages/zee && bun test ./Swabble/src/gateway/session-utils.key-normalization.test.ts` |
| 10 | openclaw | `openclaw/openclaw#15323` | reliability | adapt | done (local) | Canonical absolute `sessionFile` handling improves compatibility and deterministic storage. | `packages/zee/Swabble/src/config/sessions/paths.ts` | `cd packages/zee && bun test ./Swabble/src/config/sessions/paths.test.ts` |
| 11 | openclaw | `openclaw/openclaw#15154` | reliability | adapt | done (local) | Fixing transcript path resolution for non-default agents prevents split or missing logs. | `packages/zee/Swabble/src/config/sessions/paths.ts` transcript resolver | `cd packages/zee && bun test ./Swabble/src/config/sessions/paths.test.ts` |
| 12 | openclaw | `openclaw/openclaw#15573` | reliability | adapt | done (local) | Preserve streamed text when final payload regresses to avoid output truncation. | `packages/zee/src/session/processor.ts` stream text merge normalization (`SessionProcessor.mergeStreamText`) | `cd packages/zee && bun test test/session/processor-stream-text-merge.test.ts` |
| 13 | openclaw | `openclaw/openclaw#14498` | reliability | adapt | done (local) | Promise-chain mutex model reduces session-store race conditions. | `packages/zee/src/session/persistence.ts` session-context promise-chain mutex + atomic writes | `cd packages/zee && bun test test/session/persistence.test.ts` |
| 14 | openclaw | `openclaw/openclaw#15642` | reliability | port | done (local) | Preserve Windows backslashes in command parsing for cross-platform correctness. | `packages/zee/src/cli/cmd/daemon-cmdline.ts`, `packages/zee/src/cli/cmd/daemon.ts` | `cd packages/zee && bun test test/cli/daemon-cmdline.test.ts` |
| 15 | openclaw | `openclaw/openclaw#11547` | reliability | port | done (local) | Preserve literal `\\n` in inbound Windows path/text flows. | `packages/zee/src/surface/platforms/whatsapp.ts` inbound newline normalization | `cd packages/zee && bun test test/surface/whatsapp-platform.test.ts` |
| 16 | openclaw | `openclaw/openclaw#4702` | reliability | adapt | todo | Harden Windows command execution and binary detection behavior. | command resolution and runtime execution checks | Windows execution matrix tests |
| 17 | openclaw | `openclaw/openclaw#14976` | reliability | adapt | done (verified local) | Confirm `replyToCurrent` parity path works end-to-end. | reply mode injection and routing paths (`packages/zee/src/surface/router.ts`, `packages/zee/src/surface/messaging.ts`) | `cd packages/zee && bun test test/surface/reply-to-current.test.ts` |
| 18 | openclaw | `openclaw/openclaw#10774` | performance | adapt | verify | Verify long-session abort-leak protections are equivalent in Swabble runtime paths. | abort lifecycle in Swabble and runtime control loops | long-session memory/handle leak check |
| 19 | opencode | `adolago/zee#219` (Lane 01) | migration parity | adapt | open | TUI parity baseline reduces migration friction from OpenCode users. | `packages/zee/src/cli/cmd/tui`, auth entrypoints, model selector | TUI parity checklist tests |
| 20 | opencode | `adolago/zee#221` (Lane 02) | migration parity | adapt | open | Config parity baseline (`models.dev`, mDNS, managed settings) improves portability. | config schema/defaults + docs migration mapping | config migration fixture tests |
| 21 | opencode | `adolago/zee#288` (Lane 03) | auth/provider parity | adapt | triage-done (implementation pending) | Implement explicit OpenCode-to-Zee auth/provider migration path. | auth command flow (`zee auth`) + mapping docs | proposed `zee auth import-opencode` fixture test |
| 22 | opencode | `adolago/zee#290` (Lane 05) | API/LSP workflows | adapt | triage-done (harness pending) | Maintain parity-critical LSP + serve/client workflows. | LSP stack, `serve`, attach/resume session lifecycle | parity harness (`P05-LSP-001`, `P05-SRV-001`, `P05-SES-001`) |
| 23 | opencode | `adolago/zee#289` (Lane 04) | package topology | adapt | triage-done (docs/sequence pending) | Map high-value topology deltas without 1:1 package mirroring. | migration docs + control/auth flow alignment | lane checklist completion + docs verification |
| 24 | opencode | Lane 08 (`TBD`) | migration parity | adapt | backlog | `.opencode/` to `.zee/` migration ergonomics remain incomplete. | project-config import/mapping path | fixture-driven migration test |
| 25 | opencode | Lane 09 (`TBD`) | workflow parity | adapt | backlog | Remote `serve`/client behavior parity still needs explicit closure criteria. | server/client attach + auth lifecycle | remote attach/resume integration test |
| 26 | opencode | Lane 07 (`TBD`) | provider breadth | defer | backlog | Useful but lower priority versus security/reliability and core migration paths. | provider registry/policy docs | provider policy decision record |
| 27 | openclaw | `openclaw/openclaw#15376` | feature | adapt | todo | Cloudflare Markdown parity improves fetch-to-markdown quality. | web-fetch toolchain in Swabble/Zee tools | markdown transform fixtures |
| 28 | openclaw | `openclaw/openclaw#12577` | feature | adapt | todo | vLLM onboarding parity improves local model onboarding ergonomics. | provider onboarding wizard and docs | onboarding flow tests for vLLM path |
| 29 | pimono | update to `v0.53.1` | dependency maintenance | adapt | blocked by rank 4 | Once pin visibility exists, update and verify compatibility against current Zee gateway usage. | package manifest pin + pi-mono-dependent runtime paths | update command + regression suite |

## Immediate Execution Batches

### Batch A: Security and Tracking Foundation

Scope:

- `openclaw/openclaw#15035`
- `openclaw/openclaw#13184`
- `openclaw/openclaw#10529`
- Pi-mono dependency pin discoverability (rank 4)

Acceptance:

- Gateway auth rate limiting tests pass.
- Server surfaces default to loopback unless explicitly configured.
- Credential file mode checks enforce secure permissions.
- `check-upstream` and `compare` report a concrete installed pi-mono version or a deliberate manifest location.

### Batch B: Reliability Queue Stabilization

Scope:

- ranks 5 through 18

Acceptance:

- Session-store and transcript regression tests are green.
- No silent outbound recipient fallback remains.
- Windows path/command parsing tests pass.
- Verify-only items are converted to done or reclassified with explicit evidence.

### Batch C: Migration and Feature Parity

Scope:

- ranks 19 through 29

Acceptance:

- OpenCode lane artifacts link to executable tests/harnesses, not only triage docs.
- `.opencode` migration path is fixture-tested.
- Pi-mono update path is executable and validated.
- Deferred provider-breadth lane has explicit revisit criteria and owner.

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
