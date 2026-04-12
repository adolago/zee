# OpenClaw Delta Map (Zee /swarm-advanced)

This document is the canonical triage map tracked by #236.

It is intentionally a **triage doc** (port/adapt/defer/non-goal), not an implementation log.

Implementation tracking snapshot: `docs/architecture/openclaw-delta-implementation-tracking.md`.

## Snapshot Pins

Use these pins when comparing OpenClaw to Zee (lane issues #224-#235 were written against this snapshot):

- Zee: `1942d6fe01bc` (full `1942d6fe01bc4e497856e25af500b05f805d7d98`)
- openclaw/openclaw: `aaddbdae52d7` (full `aaddbdae52d71bff3a74fa28dd6597816e2d7592`)

Baseline reference: `docs/architecture/upstream-differences.md`.

Rolling follow-up after this snapshot is tracked in:
`docs/architecture/openclaw-post-snapshot-backlog.md`.

## Triage Policy (Default)

- Security + reliability fixes: default to `port` (or `adapt` if the architecture differs).
- Features: default to `adapt` or `defer`.
- Docs + chores: default to `defer` unless they prevent operational mistakes.
- `non-goal`: OpenClaw-only surfaces that Zee does not intend to ship.

## OpenClaw Sentinel Signal

Weekly upstream checks emit an explicit `OpenClaw sentinel` line:

- `ACTIONABLE PORTS PENDING`: this map still has one or more `TODO` rows.
- `NET-NEW ACTIONABLE DELTAS`: `openclaw/main` moved ahead of the monitored OpenClaw pin while `TODO` rows are `0`; triage is needed.
- `NO NEW ACTIONABLE PORTS`: `TODO` rows are `0` and there are `0` commits since the monitored pin.
- `UNKNOWN`: monitoring pin is missing or not available locally.

## Lane Index

| Lane | Issue | Area | Status |
| --- | --- | --- | --- |
| 01 | #224 | Gateway control plane (WS protocol, auth, events) | triage-done |
| 02 | #225 | WhatsApp channel (linking, inbound, outbound, allowlists, heartbeat) | triage-done |
| 03 | #226 | Removed channel lane (legacy messaging extensions removed from Zee) | triage-done |
| 04 | #227 | Nodes and remote execution (node-host, nodes API, approvals) | triage-done |
| 05 | #228 | Skills system (catalogs, plugin-shipped skills, loaders) | triage-done |
| 06 | #229 | State model and migrations (fs-safe, runtime guards, config and state dirs) | triage-done |
| 07 | #230 | Permissions, allowlists, DM policy, pairing and approvals | triage-done |
| 08 | #231 | Cron, wake and heartbeat, background jobs | triage-done |
| 09 | #232 | Memory + indexing (OpenClaw plugins vs Zee semantic memory) | triage-done |
| 10 | #233 | Canvas host, A2UI, live workspace surfaces | triage-done |
| 11 | #234 | Plugin and extension model (manifests, loader, tool groups, safety scanning) | triage-done |
| 12 | #235 | Onboarding, daemon install, operational CLI | triage-done |

## Net-New Actionable Backlog (2026-02-26)

Triage window:

- Monitor pin: `b3f46f0e2891` (from `docs/architecture/upstream-import-map.md`)
- Current upstream HEAD: `39d725f4d3e2` (`openclaw/main`)
- Net-new commits scanned: `133` (`git log --oneline b3f46f0e2891..openclaw/main`)

Selection policy for this section:

- Include only security/reliability deltas likely applicable to Zee's currently shipped gateway/channel surfaces.
- Leave Android/macOS app-only, provider-specific mobile UX, and unsupported-channel-only changes out of scope.
- Convert each actionable delta into a lane TODO for maintainers.

| Lane | Upstream ref | Category | Decision | Why actionable for Zee | Zee follow-up |
| --- | --- | --- | --- | --- | --- |
| 01 | commit `ec45c317f5` | security | port | Trusted-proxy bypass in gateway control-path is a high-risk auth boundary issue. | Done (ported trusted-proxy-aware SSE client key derivation with trusted-proxy gating + regression tests in `test/server/sse-limit.test.ts`). |
| 01 | commit `c736f11a16` | security | adapt | Browser WebSocket auth hardening is parity-critical for gateway control-plane exposure. | Done (added gateway route secret enforcement for mutating calls and browser-origin reads; accepts `x-zee-gateway-token` or `Authorization: Bearer`; regression tests in `test/server/gateway-route.test.ts`). |
| 01 | commit `70e31c6f68` | security | port | Hooks URL parsing hardening reduces malformed/ambiguous auth target handling. | Done (gateway auth only accepts header-based secrets; URL query token parameters are rejected with regression coverage in `packages/zee/test/server/gateway-route.test.ts`). |
| 01 | commit `2011edc9e5` | reliability | adapt | Lost `agentId` in gateway send path can break routing and policy attribution. | Done (agent id now propagates from `x-zee-agent-id` through request metadata, gateway RPC metadata, and `send` params as `agentId`; regression coverage in `packages/zee/test/server/gateway-route.test.ts`). |
| 04 | commit `f789f880c9` | security | port | Approval-bound node exec cwd handling is an execution-boundary hardening path. | None (not applicable: node-host/nodes execution subsystem has been removed from Zee's current shipped Swabble subset). |
| 04 | commit `03e689fc89` | security | adapt | Binding `system.run` approvals to argv identity reduces approval replay abuse. | None (not applicable: node `system.run` approval replay surface does not exist in Zee's current shipped gateway subset). |
| 07 | commit `04d91d0319` | security | port | Workspace hardlink alias escapes are filesystem boundary bypasses. | Done (added suspicious hardlink alias detection in filesystem/path policy and blocked hardlinked aliases in instance containment + security validators; tests in `test/security/symlink.test.ts` and `test/tool/read.test.ts`). |
| 07 | commit `125f4071bc` | security | port | `agents.files` symlink escape blocking is core path-safety hardening. | Done (verified and tightened symlink-path enforcement in `agents.files` path validators plus hardlink boundary checks with fixture coverage). |
| 07 | commits `61b3246a7f`, `baf656bc6f` | security | port | IPv6 special-use/multicast SSRF bypasses impact network tool safety posture. | Done (central URL policy blocks IPv6 special-use/multicast and IPv4-mapped private targets, enforced in `fetch_content` and `webfetch`; tests in `packages/zee/test/security/url-policy.test.ts`, `packages/zee/test/tool/fetch-content.test.ts`, and `packages/zee/test/tool/webfetch.test.ts`). |
| 07 | commit `8d1481cb4a` | security | adapt | Pairing requirement for operator device auth tightens default trust for gateway operators. | None (not applicable: operator device pairing subsystem is not part of Zee's current shipped gateway surface). |
| 07 | commits `91a3f0a3fe`, `cf8d01bc5a` | security/reliability | adapt | Account-scoped pairing/allowlist isolation prevents cross-account policy bleed. | None (not applicable: account-scoped pairing/allowlist subsystem is not present in Zee's current shipped gateway surface). |
| 02 | commit `c7352f6b3f` | security | adapt | Fail-closed Telegram allowlist behavior maps to multi-channel allowlist policy safety. | Done (messaging allowlist checks now fail closed when sender/group IDs are missing while allowlists are configured; coverage in `packages/zee/test/surface/messaging-allowlist.test.ts`). |
| 02 | commits `75dfb71e4e`, `ce8c67c314`, `aedf62ac7e` | security | adapt | Sender-auth gating for Slack interactive/reaction ingress prevents spoofed system-event actions. | None (not applicable: Slack interactive/reaction ingress is not part of Zee's current shipped channels surface). |
| 02 | commit `069bbf9741` | reliability | adapt | Case-insensitive allowlist channel ID matching avoids false-deny/false-route failures. | Done (identifier matching is now normalized case-insensitively with phone-style normalization; case-variance coverage in `packages/zee/test/surface/messaging-allowlist.test.ts`). |
| 02 | commits `ee594e2fdb`, `95c6b3a912` | reliability | adapt | Telegram webhook/polling outage recovery affects always-on channel stability. | Done (Telegram long-poll loop recovery from transient outages is now regression-tested in `packages/zee/test/surface/telegram-platform.test.ts`). |

## Lane 01: Gateway control plane (WS protocol, auth, events)

Implementation focus (Zee):

- `packages/zee/Swabble/src/gateway`
- `packages/zee/Swabble/src/security`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#10776 | reliability | port | Gateway-adjacent reliability hardening alongside cron/store changes; treat as a "grab bag" of fixes. | Done (already implemented) |
| openclaw/openclaw#10072 | feature | drop | Token usage dashboards are no longer a Zee surface. | Removed |
| openclaw/openclaw#9436 | reliability | port | Low-risk correctness fix in hooks plumbing. | Done (already implemented) |
| openclaw/openclaw#10000 | reliability | adapt | Same problem (context overflow) but Zee session history semantics diverge. | Done (limitHistoryBytes in history.ts, wired into attempt.ts and compact.ts) |
| openclaw/openclaw#9518 | security | port | Auth-gating canvas/A2UI assets is a common exposure footgun. | Done (already implemented) |
| openclaw/openclaw#9858 | security | port | Prevent secret leakage via gateway config responses. | Done (already implemented) |
| openclaw/openclaw#9806 | security | adapt | Skill/plugin safety scanner is desirable, but integration differs. | Done (already implemented: skill-scanner.ts with code pattern matching) |
| openclaw/openclaw#9911 | chore | non-goal | Workspace-local upstream cleanup not actionable as a port target. | None |

Unmapped commits / PR unknown (selected examples from #224):

- `66d8117d` "harden control UI framing + ws origin": Done (already implemented in gateway/origin-check.ts).
- `35eb40a7` "separate untrusted channel metadata from system prompt": Done (already implemented in security/channel-metadata.ts + external-content.ts).

## Lane 02: WhatsApp channel (linking, inbound, outbound, allowlists, heartbeat)

Lane artifact: `docs/architecture/openclaw-lanes/lane-02-whatsapp-channel.md`.

Implementation focus (Zee):

- `packages/zee/Swabble/src/whatsapp`
- `packages/zee/Swabble/src/channels/plugins` (WhatsApp-specific pieces)
- `packages/zee/Swabble/src/web` (WhatsApp-specific pieces)

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#4610 | security | port | Sanitize WhatsApp `accountId` to prevent path traversal. | Done (ported: normalizeAccountId in web/accounts.ts) |
| openclaw/openclaw#838 | security | port | Normalize user JIDs for group allowlists. | Done (ported: normalizeAllowEntry in access-control.ts) |
| openclaw/openclaw#971 | reliability | adapt | Debounce/batching reduces spammy outbound sends; config surface may differ. | Done (already implemented: inbound-debounce.ts with configurable delays) |
| openclaw/openclaw#629 | reliability | adapt | Tighten ack reactions + migrate config; Zee migration details differ. | Done (already implemented: ack-reactions.ts with per-channel modes) |
| openclaw/openclaw#612 | reliability | port | Improve WhatsApp Web listener errors; reduce flakiness. | Done (already implemented in web/outbound.ts) |
| openclaw/openclaw#537 | reliability | port | Align WhatsApp activity account id; prevent misrouting. | Done (ported: recordChannelActivity in send-api.ts sendReaction) |
| openclaw/openclaw#1495 | feature | defer | Per-channel markdown table conversion is UX; not correctness critical. | Done (already implemented: convertMarkdownTables + resolveMarkdownTableMode; whatsapp defaults to bullets) |
| openclaw/openclaw#8415 | docs/feature | non-goal | iMessage/BlueBubbles scope is out for Zee today. | None |

## Lane 03: Removed channel lane (legacy messaging extensions removed from Zee)

Lane artifact: `docs/architecture/openclaw-lanes/lane-03-matrix-channel.md`.

Implementation focus (Zee):

- Legacy messaging extension and config types were removed from Zee.
- `packages/zee/Swabble/src/infra/outbound`
- `packages/zee/Swabble/src/security`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9335 | security | adapt | Windows ACL + command auth hardening is relevant; details diverge. | Done (already implemented: windows-acl.ts, audit-fs.ts, exec-approvals.ts) |
| openclaw/openclaw#9202 | security | adapt | Owner-only tools + command auth hardening; policy model differs. | Done (already implemented: tools.elevated.allowFrom per provider+agent, command-auth.ts) |
| openclaw/openclaw#9182 | security | adapt | Sandbox/media hardening should be carried over where applicable. | Done (already implemented: full sandbox subsystem in agents/sandbox/, tool-policy gating) |
| openclaw/openclaw#10000 | reliability | adapt | Cap sessions history payloads to prevent context overflow; data model differs. | Done (limitHistoryBytes in history.ts, wired into attempt.ts and compact.ts) |
| openclaw/openclaw#9806 | security | adapt | Skill scanner integration differs. | Done (already implemented: skill-scanner.ts integrated in plugin install pipeline) |
| openclaw/openclaw#9911 | chore | non-goal | Workspace-local upstream cleanup. | None |
| openclaw/openclaw#10476 | docs | non-goal | Markdownlint workflow changes do not apply to Zee. | None |
| openclaw/openclaw#7235 | feature | non-goal | Topic auto-threading for removed channels is out of scope. | None |

Unmapped commits / PR unknown:

- `35eb40a7` "separate untrusted channel metadata from system prompt": Done (already implemented in security/channel-metadata.ts + external-content.ts).

## Lane 04: Nodes and remote execution (node-host, nodes API, approvals)

Implementation focus (Zee):

- `packages/zee/Swabble/src/node-host`
- `packages/zee/Swabble/src/gateway/server-methods/nodes.ts`
- `packages/zee/Swabble/src/gateway/server-methods/devices.ts`
- `packages/zee/Swabble/src/infra/exec-approvals.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#1425 | security | port | Align node exec approvals; security-critical. | Done (already implemented in infra/exec-approvals.ts) |
| openclaw/openclaw#1607 | reliability | port | Reduce log noise for node disconnect/late invoke errors. | Done (already implemented: late invoke ignored in `gateway/server-methods/nodes.ts`, node-unavailable filtering in `infra/skills-remote.ts`, debounce + cleanup in `gateway/server.impl.ts`, tests in `gateway/server.nodes.late-invoke.test.ts`) |
| openclaw/openclaw#1621 | feature | non-goal | Discord exec approval forwarding not in scope (channel not supported). | None |

## Lane 05: Skills system (catalogs, plugin-shipped skills, loaders)

Implementation focus (Zee):

- `.agents/skills` (shared and Zee-scoped)
- `packages/zee/Swabble/skills`
- `packages/zee/Swabble/src/agents/skills`
- `packages/zee/Swabble/src/gateway/server-methods/skills.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9806 | security | adapt | Skill/plugin scanning improves supply-chain safety; integration differs. | Done (already implemented: skill-scanner.ts) |
| openclaw/openclaw#9001 | feature | adapt | Per-channel responsePrefix may be useful; Zee-only routing keeps the integration simple. | Done (already implemented: response-prefix-template.ts, reply-prefix.ts) |
| openclaw/openclaw#8403 | feature | adapt | Transferable type-safety subset applies even without removed channels: typed status Probe/Audit generics in plugin contracts. | Done (`ChannelStatusAdapter<ResolvedAccount, Probe, Audit>`, `ChannelPlugin<ResolvedAccount, Probe, Audit>`, typed snapshot wiring in `channels/plugins/status.ts`) |
| openclaw/openclaw#4502 | docs | defer | session-logs path fix likely already handled by Zee naming; verify. | Done (already implemented: session-logs skill points at `~/.zee/agents/main/sessions/`) |
| openclaw/openclaw#7737 | docs | defer | Docs-only change; non-critical correctness. | Done (ported: tmux skill guidance to split send-keys text + Enter for TUIs) |
| openclaw/openclaw#4729 | docs | non-goal | Canvas URL prefix is OpenClaw-specific (`/__openclaw__/`). | None |
| openclaw/openclaw#8817 | chore | non-goal | Upstream-only skill catalog churn. | None |
| openclaw/openclaw#8415 | docs/feature | non-goal | iMessage/BlueBubbles is out of scope. | None |

## Lane 06: State model and migrations (fs-safe, runtime guards, config and state dirs)

Implementation focus (Zee):

- `packages/zee/Swabble/src/infra`
- `packages/zee/Swabble/src/config`
- `packages/zee/src/global/dirs.ts`
- `packages/zee/src/storage`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9858 | security | port | Redact credentials from config.get-like gateway responses. | Done (already implemented in config/redact-snapshot.ts) |
| openclaw/openclaw#9903 | security | port | Coerce bare-string exec-approval allowlist entries (hardening). | Done (already implemented in infra/exec-approvals.ts) |
| openclaw/openclaw#10000 | reliability | adapt | Payload caps needed, but storage/session model differs. | Done (limitHistoryBytes in history.ts, wired into attempt.ts and compact.ts) |
| openclaw/openclaw#9870 | reliability | non-goal | Local LLM provider maintenance is outside Zee's retained provider surface. | None |
| openclaw/openclaw#7078 | feature | port | Zee memory now uses local-only embeddings by default. | Done |
| openclaw/openclaw#10146 | security | non-goal | Control UI asset/update hardening not actionable unless Zee ships those assets. | None |
| openclaw/openclaw#10072 | feature | drop | Token usage dashboards are no longer a Zee surface. | Removed |
| openclaw/openclaw#9806 | security | adapt | Skill scanner integration differs. | Done (already implemented: skill-scanner.ts) |

## Lane 07: Permissions, allowlists, DM policy, pairing and approvals

Implementation focus (Zee):

- `packages/zee/Swabble/src/security`
- `packages/zee/Swabble/src/channels/allowlists`
- `packages/zee/Swabble/src/pairing`
- `packages/zee/Swabble/src/gateway/auth.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#4058 | security | adapt | Harden web tools and file parsing; exact tool set differs. | Done (already implemented: external-content.ts, SSRF tests, suspicious pattern detection) |
| openclaw/openclaw#9335 | security | adapt | Windows ACL + command auth hardening impacts permission surfaces. | Done (already implemented: windows-acl.ts, exec-approvals.ts) |
| openclaw/openclaw#10000 | reliability | adapt | Cap sessions_history payloads; data model differs. | Done (limitHistoryBytes in history.ts, wired into attempt.ts and compact.ts) |
| openclaw/openclaw#9806 | security | adapt | Skill scanner integration differs. | Done (already implemented: skill-scanner.ts) |
| openclaw/openclaw#3095 | feature | defer | Per-account dm scope guidance is UX; not correctness critical. | Done (already implemented: session.dmScope supports per-account-channel-peer; wired in routing/session-key) |
| openclaw/openclaw#9911 | chore | non-goal | Workspace-local cleanup. | None |
| openclaw/openclaw#2455 | chore | non-goal | Build artifact tracking does not translate directly. | None |
| openclaw/openclaw#2507 | test | non-goal | Upstream-only test stabilization under CLAWDBOT_PROFILE. | None |

## Lane 08: Cron, wake and heartbeat, background jobs

Lane artifact: `docs/architecture/openclaw-lanes/lane-08-cron-heartbeat-background-jobs.md`.

Implementation focus (Zee):

- `packages/zee/Swabble/src/cron`
- `packages/zee/Swabble/src/infra/heartbeat-wake.ts`
- `packages/zee/Swabble/src/agents/tools/cron-tool.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#10776 | reliability | port | Cron scheduler reliability + store hardening. | Done (already implemented) |
| openclaw/openclaw#9733 | reliability | port | Fix cron scheduling and reminder delivery regressions. | Done (already implemented) |
| openclaw/openclaw#9823 | reliability | port | Prevent recomputeNextRuns skipping due jobs in timer loop. | Done (already implemented) |
| openclaw/openclaw#9948 | reliability | port | Re-arm timer in finally to survive transient errors. | Done (already implemented) |
| openclaw/openclaw#9932 | reliability | port | Handle legacy schedule fields (atMs) when computing next run. | Done (already implemented) |
| openclaw/openclaw#10176 | reliability | port | Guard resolveUserPath against undefined input. | Done (ported: type guard in utils.ts) |
| openclaw/openclaw#9363 | reliability | adapt | Downgrade xhigh thinking level in cron isolated agent; mapping may differ. | Done (already implemented: supportsXHighThinking() in cron/isolated-agent/run.ts) |
| openclaw/openclaw#8392 | reliability | adapt | Cron delivery guard relevant; removed-channel forward metadata is not. | Done (already implemented: delivery-target.ts with channel/recipient validation) |

## Lane 09: Memory + indexing (OpenClaw plugins vs Zee semantic memory)

Lane artifact: `docs/architecture/openclaw-lanes/lane-09-memory-indexing.md`.

Implementation focus (Zee):

- `src/memory` (local SQLite vector storage + SQLite FTS)
- `packages/zee/Swabble/src/memory`
- `packages/zee/Swabble/extensions/memory-lancedb`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#10818 | performance | non-goal | Remote embedding providers are outside Zee's local-only memory path. | None |
| openclaw/openclaw#5332 | performance | adapt | L2-normalize embedding vectors to fix semantic search quality. | Done (ported: sanitizeAndNormalizeEmbedding in `src/memory/embeddings.ts` + normalization tests in `src/memory/embeddings.test.ts`) |
| openclaw/openclaw#2576 | reliability | non-goal | Zee does not need embedding provider "auto" selection for the default local memory path. | None |
| openclaw/openclaw#1272 | security | adapt | Enforce plugin config schemas; Zee plugin system differs. | Done (already implemented: schema-validator.ts with AJV in loader.ts) |
| openclaw/openclaw#7078 | feature | port | Zee memory now uses local-only embeddings by default. | Done |
| openclaw/openclaw#819 | feature | non-goal | Remote embedding overrides are not needed for the default local memory path. | None |
| openclaw/openclaw#3600 | chore | non-goal | Upstream-only local updates without clear mapping. | None |
| openclaw/openclaw#1439 | feature | non-goal | BlueBubbles typing behavior out of scope for memory lane. | None |

## Lane 10: Canvas host, A2UI, live workspace surfaces

Lane artifact: `docs/architecture/openclaw-lanes/lane-10-canvas-a2ui-live-workspace.md`.

Implementation focus (Zee):

- `packages/zee/Swabble/src/canvas-host`
- `packages/zee/Swabble/src/agents/tools/canvas-tool.ts`
- `packages/zee/Swabble/src/infra/canvas-host-url.ts`

Upstream PR triage (OpenClaw):

Auth gating: see lane 01 (`openclaw/openclaw#9518`).

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#8432 | reliability | adapt | Fix tool routing/model display/msg updates; upstream Pi stack differs. | Done (ported: pi streaming agent updates + targeted tool-event routing/caps in gateway) |
| openclaw/openclaw#2900 | feature | non-goal | Removed-channel quote replies are not in scope for canvas lane. | None |
| openclaw/openclaw#1757 | security | adapt | Per-sender group tool policies and precedence; needs mapping to Zee. | Done (already implemented: channel group toolsBySender + precedence in `src/config/group-policy.ts`, wired via `agents/pi-tools.policy.ts`) |
| openclaw/openclaw#2455 | reliability | port | Restore A2UI scaffold assets; prevent runtime breakage. | Done (already implemented in canvas-host/a2ui/) |
| openclaw/openclaw#1882 | security | adapt | Add mDNS discovery config to reduce information disclosure; config surface differs. | Done (already implemented: bonjour-ciao.ts, bonjour.ts with config in zod-schema.ts) |
| openclaw/openclaw#1621 | feature | non-goal | Discord exec approval forwarding is out of scope (channel not supported). | None |
| openclaw/openclaw#1607 | reliability | port | Node disconnect/late invoke log noise reduction also applies. | Done (already implemented: late invoke handling + node-unavailable log filtering + skills refresh debounce) |
| openclaw/openclaw#1229 | feature | adapt | Expand /v1/responses inputs; may impact adapters/tool routing. | Done (already implemented: openresponses-http.ts + open-responses.schema.ts) |

## Lane 11: Plugin and extension model (manifests, loader, tool groups, safety scanning)

Lane artifact: `docs/architecture/openclaw-lanes/lane-11-plugin-extension-model.md`.

Implementation focus (Zee):

- `packages/zee/Swabble/src/plugins`
- `packages/zee/Swabble/src/plugin-sdk`
- `packages/zee/Swabble/extensions`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9806 | security | adapt | Skill/plugin safety scanning should exist; integration differs. | Done (already implemented: skill-scanner.ts) |
| openclaw/openclaw#4001 | security | port | Harden SSH target handling; reduce injection/target spoofing risk. | Done (ported: SSH option injection prevention in ssh-tunnel.ts, ssh-config.ts, gateway-status) |
| openclaw/openclaw#1757 | security | adapt | Tool group precedence is policy logic; map to Zee permission model. | Done (already implemented: toolsBySender/group tool policy precedence and tool group expansion in tool-policy layer) |
| openclaw/openclaw#9001 | feature | adapt | Per-channel responsePrefix override may be useful; Zee-only routing keeps the integration simple. | Done (already implemented: response-prefix-template.ts) |
| openclaw/openclaw#8403 | feature | adapt | Plugin SDK typing hardening is still relevant for Zee channel plugins even when removed-channel surfaces are out of scope. | Done (ported status Probe/Audit generics and tightened status issue collector typing in Telegram/Slack/Discord plugins) |
| openclaw/openclaw#1708 | feature | non-goal | iMessage normalization out of scope. | None |
| openclaw/openclaw#1630 | feature | non-goal | Line plugin out of scope. | None |
| openclaw/openclaw#1645 | feature | non-goal | BlueBubbles chunking mode out of scope. | None |

## Lane 12: Onboarding, daemon install, operational CLI

Implementation focus (Zee):

- `packages/zee/Swabble/src/wizard`
- `packages/zee/Swabble/src/daemon`
- `packages/zee/Swabble/src/commands/onboarding`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#1512 | reliability | port | Add user bin dirs to systemd PATH for skill installation. | Done (already implemented in daemon/service-env.ts) |
| openclaw/openclaw#1505 | reliability | port | Prefer symlinked paths over realpath for stable service configs. | Done (already implemented in daemon/program-args.ts) |
| openclaw/openclaw#1735 | reliability | adapt | Propagate config env vars to gateway services; wiring differs. | Done (already implemented: service-env.ts buildServiceEnvironment with PATH, PNPM_HOME, BUN_INSTALL, etc.) |
| openclaw/openclaw#1485 | feature | adapt | Support direct token/provider in auth apply; map to Zee auth UX. | Done (already implemented: auth-choice.apply.openai.ts supports opts.token + opts.tokenProvider) |
| openclaw/openclaw#10176 | reliability | port | resolveUserPath undefined guard is general hardening. | Done (ported: type guard in utils.ts) |
| openclaw/openclaw#9436 | reliability | port | Silence unused hook token URL param; low risk. | Done (already implemented: hooks.ts + server-http.ts reject ?token= URLs) |
| openclaw/openclaw#5370 | chore | defer | Minimum Node bump may be irrelevant (Zee is Bun-first). | Done (already implemented: `infra/runtime-guard.ts` MIN_NODE >=22.12.0 + package engines) |
| openclaw/openclaw#4873 | chore | non-goal | Upstream-only local updates without clear mapping. | None |
