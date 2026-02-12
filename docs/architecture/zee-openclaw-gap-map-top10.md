# Zee vs OpenClaw: Biggest Feature Gaps (Top 10)

## Brief summary
This map ranks the largest **current** gaps where OpenClaw is ahead of Zee for personal-assistant usage, with explicit security implications.

Freshness:
- Date: 2026-02-12
- Zee repo: `main` @ `cee5c584e1`
- OpenClaw repo head checked: `bdd0c1232987cb9f13217acc3db78f33bca9f71c`

Method:
- Prioritized by user-facing impact first, then security delta and implementation cost.
- Excludes items already at effective parity (for example: DM pairing, `security audit --deep/--fix`, trusted proxies, and formal verification docs).

## Top 10 gaps

| Rank | Gap | Category | Zee status | OpenClaw status | User/business impact | Security impact | Evidence | Recommendation | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Multi-channel inbox breadth (Telegram/Slack/Discord/Signal/iMessage/Teams/etc.) | Channels | Partial | Yes | Biggest adoption limiter for assistant usage outside WhatsApp | Fewer channel-specific policy controls/tests; narrower security coverage per real-world surface | Zee: `packages/zee/src/compare/catalog.ts`, `packages/zee/Swabble/src/config/zod-schema.providers.ts`, `packages/zee/Swabble/extensions/whatsapp/zee.plugin.json` OpenClaw: https://github.com/openclaw/openclaw (README “Multi-channel inbox”) | Adapt: ship first-party Telegram + Slack + Discord channel plugins with same policy model as WhatsApp | L |
| 2 | Device node ecosystem (macOS/iOS/Android clients in production) | Nodes | No (infra exists, no official app ecosystem) | Yes | Blocks camera/screen/location/device-local automation workflows | Misses device-permission mediated execution path that OpenClaw uses for least-privilege device actions | Zee: `docs/architecture/feature-comparison.md`, `packages/zee/Swabble/src/node-host` OpenClaw: https://github.com/openclaw/openclaw (README “Companion apps” / “Nodes”) | Adapt: ship one reference node client first (macOS), then iOS/Android | L |
| 3 | Voice wake + talk mode (always-on voice UX) | Voice | No | Yes | Major gap for hands-free assistant usage | No voice-surface policy model to govern always-on capture/command flows | Zee: `packages/zee/src/compare/catalog.ts` (`msg.voice`) OpenClaw: https://github.com/openclaw/openclaw (README “Voice Wake + Talk Mode”) | Defer or adapt after device-node client lands | M |
| 4 | Desktop app distribution (menu-bar/native companion) | Surfaces | No | Yes | Reduces non-CLI accessibility and daily active usage | No native permission UX boundary for desktop operators | Zee: `packages/zee/src/compare/catalog.ts` (`surface.desktop-app`) OpenClaw: https://github.com/openclaw/openclaw (README “macOS app”) | Adapt: minimal desktop shell for gateway status, pairing approvals, and session controls | M |
| 5 | Web control surface depth (Control UI + WebChat as first-class product) | Surfaces | Partial | Yes | Higher friction for non-terminal control and remote supervision | Weaker operator ergonomics for reviewing approvals/pairing/alerts in one place | Zee: `packages/zee/src/compare/catalog.ts` (`surface.web-ui`) OpenClaw: https://github.com/openclaw/openclaw (README “Control UI + WebChat”) | Adapt: elevate current gateway web surface into a first-class command/product path | M |
| 6 | OAuth subscription-first auth UX (Anthropic/OpenAI subscriptions + profile rotation emphasis) | Providers/Auth | Partial | Yes | Better onboarding and lower key-management burden in OpenClaw | More users stay on revocable OAuth flows vs static long-lived API keys | Zee: `packages/zee/src/compare/catalog.ts` (`model.oauth-subscriptions`) OpenClaw: https://github.com/openclaw/openclaw (README “Subscriptions (OAuth)”), https://docs.openclaw.ai/concepts/model-failover | Adapt: first-class `zee auth` profile rotation UX for subscription accounts (without plugin dependency) | M |
| 7 | Local indexing defaults for “no-external-service” memory | Memory | Partial | Yes | OpenClaw can be easier for local-first memory setups; Zee remains Qdrant-centric | External memory service introduces extra deployment and data-surface complexity | Zee: `packages/zee/src/compare/catalog.ts` (`memory.local-indexing`), `README.md` (Qdrant prerequisite) OpenClaw: https://github.com/openclaw/openclaw (README + docs references to local indexing) | Adapt: official local index default profile (with migration path from Qdrant) | M |
| 8 | Channel-native action surfaces (for example Slack/Discord-specific actions) | Tools/Channels | Partial | Yes | Limits channel-embedded automations where OpenClaw has native actions | Fewer per-channel least-privilege policy points for native operations | Zee: `docs/architecture/upstream-differences.md` (reduced subset; missing channel subsystems) OpenClaw: https://github.com/openclaw/openclaw (README “First-class tools … Discord/Slack actions”) | Adapt: prioritize one channel-native action pack per new channel | M |
| 9 | Personal-assistant product coherence (single-user, everyday-channel-first defaults) | Positioning/Product | Partial | Yes | Zee’s multi-domain engine strength also makes assistant product flow less opinionated | Security defaults are strong, but operator journey is less explicitly assistant-centric | Zee: `packages/zee/src/compare/catalog.ts` (`positioning.personal-assistant`) OpenClaw: https://github.com/openclaw/openclaw (README positioning) | Intentional divergence unless product direction changes; if changed, add dedicated “assistant mode” preset | S |
| 10 | Control UI auth downgrade guardrails parity | Security | Partial | Yes | OpenClaw documents explicit secure-context fallback behavior and dangerous toggles | Missing parity knobs/warnings can hide risky UI auth configurations | Zee: `packages/zee/Swabble/src/config/types.gateway.ts` (`controlUi` currently minimal/unused) OpenClaw: https://docs.openclaw.ai/gateway/security (sections on `gateway.controlUi.allowInsecureAuth` and `dangerouslyDisableDeviceAuth`) | Port/adapt the downgrade controls and audit warnings into Zee control UI config + `zee security audit` | S |

## Security-only appendix (material deltas)

### 1) Control-UI downgrade controls parity
- Type: Prevention + Governance
- Gap: OpenClaw explicitly models insecure-auth downgrade paths for Control UI; Zee currently has minimal `controlUi` config surface.
- Why it matters: Reduces accidental weak auth/device-identity states when UI is proxied or remotely exposed.

### 2) Security policy breadth across real channels
- Type: Prevention + Containment
- Gap: OpenClaw’s channel matrix implies broader tested policy enforcement across many messaging providers; Zee’s first-party channel footprint is currently concentrated on WhatsApp.
- Why it matters: Security controls are strongest when implemented/tested per actual channel semantics.

### 3) OAuth subscription-first auth posture
- Type: Governance + Containment
- Gap: OpenClaw emphasizes OAuth subscription workflows and failover rotation as default operator path; Zee supports OAuth but still partially plugin-dependent.
- Why it matters: Revocable OAuth credentials can reduce long-lived secret sprawl and simplify incident recovery.

## Important interface/public-surface implications
If these gaps are closed, expected public interface additions include:
- New channel plugin IDs and config sections under `channels.*`.
- New node-client installation/registration flows (`devices`/`nodes` lifecycle).
- Expanded `gateway.controlUi.*` security settings and audit checks.
- Extended auth profile CLI for subscription-first rotation/fallback.

## Test scenarios and acceptance criteria

1. Channel breadth
- Add one non-WhatsApp channel (Telegram/Slack/Discord) end-to-end.
- Validate pairing, allowlist, DM policy, group policy, and security audit findings for that channel.

2. Node/client parity
- Pair a real desktop node and run camera/screen/location flows.
- Confirm permissions, deny modes, approvals, and remote revocation paths.

3. Voice mode
- Validate wake/talk flows with explicit opt-in and off-switches.
- Confirm no unintended always-on behavior after restart.

4. Control UI security controls
- Add insecure-auth toggle tests and verify `zee security audit` warns/fails appropriately.
- Validate secure-context behavior behind reverse proxy + `trustedProxies`.

5. OAuth profile UX
- Exercise auth profile rotation with OAuth-only accounts and fallback order.
- Confirm secret storage and revocation behavior are explicit and recoverable.

## Assumptions and defaults
- This ranking assumes Zee remains a unified multi-domain engine and not a full OpenClaw clone.
- “Biggest” means highest product impact for assistant usage, not code-diff size.
- Existing parity items were intentionally excluded from the top list (for example: pairing, security audit, trusted proxy checks, formal verification docs).
