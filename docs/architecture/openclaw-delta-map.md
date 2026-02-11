# OpenClaw Delta Map (Zee /swarm-advanced)

This document is the canonical triage map tracked by #236.

It is intentionally a **triage doc** (port/adapt/defer/non-goal), not an implementation log.

## Snapshot Pins

Use these pins when comparing OpenClaw to Zee (lane issues #224-#235 were written against this snapshot):

- Zee: `1942d6fe01bc` (full `1942d6fe01bc4e497856e25af500b05f805d7d98`)
- openclaw/openclaw: `aaddbdae52d7` (full `aaddbdae52d71bff3a74fa28dd6597816e2d7592`)

Baseline reference: `docs/architecture/upstream-differences.md`.

## Triage Policy (Default)

- Security + reliability fixes: default to `port` (or `adapt` if the architecture differs).
- Features: default to `adapt` or `defer`.
- Docs + chores: default to `defer` unless they prevent operational mistakes.
- `non-goal`: OpenClaw-only surfaces that Zee does not intend to ship.

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

## Lane 01: Gateway control plane (WS protocol, auth, events)

Implementation focus (Zee):

- `packages/personas/zee/src/gateway`
- `packages/personas/zee/src/security`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#10776 | reliability | port | Gateway-adjacent reliability hardening alongside cron/store changes; treat as a "grab bag" of fixes. | TODO |
| openclaw/openclaw#10072 | feature | defer | Token usage dashboard is a product/UI surface (control UI). | TODO |
| openclaw/openclaw#9436 | reliability | port | Low-risk correctness fix in hooks plumbing. | TODO |
| openclaw/openclaw#10000 | reliability | adapt | Same problem (context overflow) but Zee session history semantics diverge. | TODO |
| openclaw/openclaw#9518 | security | port | Auth-gating canvas/A2UI assets is a common exposure footgun. | TODO |
| openclaw/openclaw#9858 | security | port | Prevent secret leakage via gateway config responses. | TODO |
| openclaw/openclaw#9806 | security | adapt | Skill/plugin safety scanner is desirable, but integration differs. | TODO |
| openclaw/openclaw#9911 | chore | non-goal | Workspace-local upstream cleanup not actionable as a port target. | None |

Unmapped commits / PR unknown (selected examples from #224):

- `66d8117d` "harden control UI framing + ws origin": TODO map to PR; decide whether Zee gateway needs an equivalent origin check.
- `35eb40a7` "separate untrusted channel metadata from system prompt": TODO map to PR; likely security-critical for all channels.

## Lane 02: WhatsApp channel (linking, inbound, outbound, allowlists, heartbeat)

Implementation focus (Zee):

- `packages/personas/zee/src/whatsapp`
- `packages/personas/zee/src/channels/plugins` (WhatsApp-specific pieces)
- `packages/personas/zee/src/web` (WhatsApp-specific pieces)

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#4610 | security | port | Sanitize WhatsApp `accountId` to prevent path traversal. | TODO |
| openclaw/openclaw#838 | security | port | Normalize user JIDs for group allowlists. | TODO |
| openclaw/openclaw#971 | reliability | adapt | Debounce/batching reduces spammy outbound sends; config surface may differ. | TODO |
| openclaw/openclaw#629 | reliability | adapt | Tighten ack reactions + migrate config; Zee migration details differ. | TODO |
| openclaw/openclaw#612 | reliability | port | Improve WhatsApp Web listener errors; reduce flakiness. | TODO |
| openclaw/openclaw#537 | reliability | port | Align WhatsApp activity account id; prevent misrouting. | TODO |
| openclaw/openclaw#1495 | feature | defer | Per-channel markdown table conversion is UX; not correctness critical. | TODO |
| openclaw/openclaw#8415 | docs/feature | non-goal | iMessage/BlueBubbles scope is out for Zee today. | None |

## Lane 03: Removed channel lane (legacy messaging extensions removed from Zee)

Implementation focus (Zee):

- Legacy messaging extension and config types were removed from Zee.
- `packages/personas/zee/src/infra/outbound`
- `packages/personas/zee/src/security`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9335 | security | adapt | Windows ACL + command auth hardening is relevant; details diverge. | TODO |
| openclaw/openclaw#9202 | security | adapt | Owner-only tools + command auth hardening; policy model differs. | TODO |
| openclaw/openclaw#9182 | security | adapt | Sandbox/media hardening should be carried over where applicable. | TODO |
| openclaw/openclaw#10000 | reliability | adapt | Cap sessions history payloads to prevent context overflow; data model differs. | TODO |
| openclaw/openclaw#9806 | security | adapt | Skill scanner integration differs. | TODO |
| openclaw/openclaw#9911 | chore | non-goal | Workspace-local upstream cleanup. | None |
| openclaw/openclaw#10476 | docs | non-goal | Markdownlint workflow changes do not apply to Zee. | None |
| openclaw/openclaw#7235 | feature | non-goal | Topic auto-threading for removed channels is out of scope. | None |

Unmapped commits / PR unknown:

- `35eb40a7` "separate untrusted channel metadata from system prompt": TODO map to PR; should likely be treated as `security/port` across channels.

## Lane 04: Nodes and remote execution (node-host, nodes API, approvals)

Implementation focus (Zee):

- `packages/personas/zee/src/node-host`
- `packages/personas/zee/src/gateway/server-methods/nodes.ts`
- `packages/personas/zee/src/gateway/server-methods/devices.ts`
- `packages/personas/zee/src/infra/exec-approvals.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#1425 | security | port | Align node exec approvals; security-critical. | TODO |
| openclaw/openclaw#1607 | reliability | port | Reduce log noise for node disconnect/late invoke errors. | TODO |
| openclaw/openclaw#1621 | feature | non-goal | Discord exec approval forwarding not in scope (channel not supported). | None |

## Lane 05: Skills system (catalogs, plugin-shipped skills, loaders)

Implementation focus (Zee):

- `.agents/skills` (persona-scoped)
- `packages/personas/zee/skills`
- `packages/personas/zee/src/agents/skills`
- `packages/personas/zee/src/gateway/server-methods/skills.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9806 | security | adapt | Skill/plugin scanning improves supply-chain safety; integration differs. | TODO |
| openclaw/openclaw#9001 | feature | adapt | Per-channel responsePrefix may be useful; persona routing complicates. | TODO |
| openclaw/openclaw#8403 | feature | defer | Removed-channel typing/types refactor not prioritized. | TODO |
| openclaw/openclaw#4502 | docs | defer | session-logs path fix likely already handled by Zee naming; verify. | TODO |
| openclaw/openclaw#7737 | docs | defer | Docs-only change; non-critical correctness. | TODO |
| openclaw/openclaw#4729 | docs | non-goal | Canvas URL prefix is OpenClaw-specific (`/__openclaw__/`). | None |
| openclaw/openclaw#8817 | chore | non-goal | Upstream-only skill catalog churn. | None |
| openclaw/openclaw#8415 | docs/feature | non-goal | iMessage/BlueBubbles is out of scope. | None |

## Lane 06: State model and migrations (fs-safe, runtime guards, config and state dirs)

Implementation focus (Zee):

- `packages/personas/zee/src/infra`
- `packages/personas/zee/src/config`
- `packages/zee/src/global/dirs.ts`
- `packages/zee/src/storage`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9858 | security | port | Redact credentials from config.get-like gateway responses. | TODO |
| openclaw/openclaw#9903 | security | port | Coerce bare-string exec-approval allowlist entries (hardening). | TODO |
| openclaw/openclaw#10000 | reliability | adapt | Payload caps needed, but storage/session model differs. | TODO |
| openclaw/openclaw#9870 | reliability | adapt | Ollama streaming/config/env fixes may apply, but provider stack differs. | TODO |
| openclaw/openclaw#7078 | feature | defer | Native Voyage support can be revisited after correctness fixes. | TODO |
| openclaw/openclaw#10146 | security | non-goal | Control UI asset/update hardening not actionable unless Zee ships those assets. | None |
| openclaw/openclaw#10072 | feature | defer | Token usage dashboard is UI/product. | TODO |
| openclaw/openclaw#9806 | security | adapt | Skill scanner integration differs. | TODO |

## Lane 07: Permissions, allowlists, DM policy, pairing and approvals

Implementation focus (Zee):

- `packages/personas/zee/src/security`
- `packages/personas/zee/src/channels/allowlists`
- `packages/personas/zee/src/pairing`
- `packages/personas/zee/src/gateway/auth.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#4058 | security | adapt | Harden web tools and file parsing; exact tool set differs. | TODO |
| openclaw/openclaw#9335 | security | adapt | Windows ACL + command auth hardening impacts permission surfaces. | TODO |
| openclaw/openclaw#10000 | reliability | adapt | Cap sessions_history payloads; data model differs. | TODO |
| openclaw/openclaw#9806 | security | adapt | Skill scanner integration differs. | TODO |
| openclaw/openclaw#3095 | feature | defer | Per-account dm scope guidance is UX; not correctness critical. | TODO |
| openclaw/openclaw#9911 | chore | non-goal | Workspace-local cleanup. | None |
| openclaw/openclaw#2455 | chore | non-goal | Build artifact tracking does not translate directly. | None |
| openclaw/openclaw#2507 | test | non-goal | Upstream-only test stabilization under CLAWDBOT_PROFILE. | None |

## Lane 08: Cron, wake and heartbeat, background jobs

Implementation focus (Zee):

- `packages/personas/zee/src/cron`
- `packages/personas/zee/src/infra/heartbeat-wake.ts`
- `packages/personas/zee/src/agents/tools/cron-tool.ts`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#10776 | reliability | port | Cron scheduler reliability + store hardening. | TODO |
| openclaw/openclaw#9733 | reliability | port | Fix cron scheduling and reminder delivery regressions. | TODO |
| openclaw/openclaw#9823 | reliability | port | Prevent recomputeNextRuns skipping due jobs in timer loop. | TODO |
| openclaw/openclaw#9948 | reliability | port | Re-arm timer in finally to survive transient errors. | TODO |
| openclaw/openclaw#9932 | reliability | port | Handle legacy schedule fields (atMs) when computing next run. | TODO |
| openclaw/openclaw#10176 | reliability | port | Guard resolveUserPath against undefined input. | TODO |
| openclaw/openclaw#9363 | reliability | adapt | Downgrade xhigh thinking level in cron isolated agent; mapping may differ. | TODO |
| openclaw/openclaw#8392 | reliability | adapt | Cron delivery guard relevant; removed-channel forward metadata is not. | TODO |

## Lane 09: Memory + indexing (OpenClaw plugins vs Zee semantic memory)

Implementation focus (Zee):

- `src/memory` (Qdrant-backed)
- `packages/personas/zee/src/memory`
- `packages/personas/zee/extensions/memory-core`
- `packages/personas/zee/extensions/memory-lancedb`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#10818 | performance | adapt | Voyage embedding input_type improves retrieval; provider wiring differs. | TODO |
| openclaw/openclaw#5332 | performance | adapt | L2-normalize embedding vectors to fix semantic search quality. | TODO |
| openclaw/openclaw#2576 | reliability | adapt | modelDefault bug when provider=="auto" may have an Zee analogue. | TODO |
| openclaw/openclaw#1272 | security | adapt | Enforce plugin config schemas; Zee plugin system differs. | TODO |
| openclaw/openclaw#7078 | feature | defer | Full native Voyage support can be revisited after correctness fixes. | TODO |
| openclaw/openclaw#819 | feature | defer | Memory search remote overrides may not match Zee memory model. | TODO |
| openclaw/openclaw#3600 | chore | non-goal | Upstream-only local updates without clear mapping. | None |
| openclaw/openclaw#1439 | feature | non-goal | BlueBubbles typing behavior out of scope for memory lane. | None |

## Lane 10: Canvas host, A2UI, live workspace surfaces

Implementation focus (Zee):

- `packages/personas/zee/src/canvas-host`
- `packages/personas/zee/src/agents/tools/canvas-tool.ts`
- `packages/personas/zee/src/infra/canvas-host-url.ts`

Upstream PR triage (OpenClaw):

Auth gating: see lane 01 (`openclaw/openclaw#9518`).

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#8432 | reliability | adapt | Fix tool routing/model display/msg updates; upstream Pi stack differs. | TODO |
| openclaw/openclaw#2900 | feature | non-goal | Removed-channel quote replies are not in scope for canvas lane. | None |
| openclaw/openclaw#1757 | security | adapt | Per-sender group tool policies and precedence; needs mapping to Zee. | TODO |
| openclaw/openclaw#2455 | reliability | port | Restore A2UI scaffold assets; prevent runtime breakage. | TODO |
| openclaw/openclaw#1882 | security | adapt | Add mDNS discovery config to reduce information disclosure; config surface differs. | TODO |
| openclaw/openclaw#1621 | feature | non-goal | Discord exec approval forwarding is out of scope (channel not supported). | None |
| openclaw/openclaw#1607 | reliability | port | Node disconnect/late invoke log noise reduction also applies. | TODO |
| openclaw/openclaw#1229 | feature | adapt | Expand /v1/responses inputs; may impact adapters/tool routing. | TODO |

## Lane 11: Plugin and extension model (manifests, loader, tool groups, safety scanning)

Implementation focus (Zee):

- `packages/personas/zee/src/plugins`
- `packages/personas/zee/src/plugin-sdk`
- `packages/personas/zee/extensions`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#9806 | security | adapt | Skill/plugin safety scanning should exist; integration differs. | TODO |
| openclaw/openclaw#4001 | security | port | Harden SSH target handling; reduce injection/target spoofing risk. | TODO |
| openclaw/openclaw#1757 | security | adapt | Tool group precedence is policy logic; map to Zee permission model. | TODO |
| openclaw/openclaw#9001 | feature | adapt | Per-channel responsePrefix override may be useful; persona routing complicates. | TODO |
| openclaw/openclaw#8403 | feature | defer | Removed-channel plugin SDK typing changes not prioritized. | TODO |
| openclaw/openclaw#1708 | feature | non-goal | iMessage normalization out of scope. | None |
| openclaw/openclaw#1630 | feature | non-goal | Line plugin out of scope. | None |
| openclaw/openclaw#1645 | feature | non-goal | BlueBubbles chunking mode out of scope. | None |

## Lane 12: Onboarding, daemon install, operational CLI

Implementation focus (Zee):

- `packages/personas/zee/src/wizard`
- `packages/personas/zee/src/daemon`
- `packages/personas/zee/src/commands/onboarding`

Upstream PR triage (OpenClaw):

| Upstream PR | Category | Decision | Rationale | Zee follow-up |
| --- | --- | --- | --- | --- |
| openclaw/openclaw#1512 | reliability | port | Add user bin dirs to systemd PATH for skill installation. | TODO |
| openclaw/openclaw#1505 | reliability | port | Prefer symlinked paths over realpath for stable service configs. | TODO |
| openclaw/openclaw#1735 | reliability | adapt | Propagate config env vars to gateway services; wiring differs. | TODO |
| openclaw/openclaw#1485 | feature | adapt | Support direct token/provider in auth apply; map to Zee auth UX. | TODO |
| openclaw/openclaw#10176 | reliability | port | resolveUserPath undefined guard is general hardening. | TODO |
| openclaw/openclaw#9436 | reliability | port | Silence unused hook token URL param; low risk. | TODO |
| openclaw/openclaw#5370 | chore | defer | Minimum Node bump may be irrelevant (Zee is Bun-first). | TODO |
| openclaw/openclaw#4873 | chore | non-goal | Upstream-only local updates without clear mapping. | None |
