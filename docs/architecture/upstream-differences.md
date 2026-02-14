# zee vs sst/opencode vs openclaw

See also:
- `docs/architecture/feature-comparison.md` (generated feature matrix across Zee, OpenCode, OpenClaw, and Pi-mono)
- `docs/architecture/zee-opencode-gap-map-top10.md` (canonical OpenCode lane index and ranked backlog)

This document maps the high-signal differences between zee and:

- `sst/opencode` (OpenCode, `dev` branch)
- `openclaw/openclaw` (OpenClaw, `main` branch)

Snapshot used for this comparison:

- zee: `1942d6fe01bc` (full `1942d6fe01bc4e497856e25af500b05f805d7d98`)
- opencode: `fa20bc2` (cloned `dev`)
- openclaw: `aaddbdae52d7` (full `aaddbdae52d71bff3a74fa28dd6597816e2d7592`)

Current upstream pins (refreshed 2026-02-12):

- opencode: `624dd94b5dd8` (full `624dd94b5dd8dca03aa3b246312f8b54fd3331f1`, `opencode/dev`)
- openclaw: `5c32989f5331` (full `5c32989f5331df0bf760c23fd047e65d1f812b52`, `openclaw/main`)
- pimono: `34878e7cc807` (full `34878e7cc8074f42edff6c2cdcc9828aa9b6afde`, `pimono/main`); installed `@mariozechner/pi-coding-agent@0.52.9`, latest tag `v0.52.9`

## Summary (what each repo is)

- **zee**: a CLI agent engine that powers the Personas system (**Zee**, **Stanley**, **Johny**). It adds persona routing, semantic memory (Qdrant), orchestration, and an optional always-on messaging gateway.
- **opencode**: an open source AI coding agent (TUI-first) with a client/server architecture and LSP support.
- **openclaw**: a personal AI assistant with a Gateway WebSocket control plane, multi-channel messaging (WhatsApp/Slack/Discord/etc), device nodes (macOS/iOS/Android), and a large skill catalog.

## Relationship at a glance

- **zee ↔ opencode**: zee is a fork of opencode with a rebrand (`opencode` → `zee`) plus substantial additions (personas, memory, gateway/daemon workflows) and removals (SST/infra + some hosted/enterprise surfaces).
- **zee ↔ openclaw**: zee contains a large, intentionally reduced subset of OpenClaw’s Gateway/channel stack inside `packages/zee/Swabble/` (Zee’s gateway), but zee’s overall architecture is “multi-persona engine” rather than “single-assistant product”.

## Toolchain and runtime

| Dimension | zee | opencode | openclaw |
| --- | --- | --- | --- |
| Package manager | Bun (`bun.lock`, `packageManager: bun@1.3.5`) | Bun (`bun.lock`, `packageManager: bun@1.3.5`) | pnpm (`pnpm-lock.yaml`, `packageManager: pnpm@10.23.0`) |
| Primary runtime | Bun (dev/build) | Bun (dev/build) | Node 22+ (runtime); pnpm for builds; Bun optional for TS execution |
| CLI framework | yargs (in `packages/zee`) | yargs (in `packages/opencode`) | commander (`src/commands`) |
| Non-TS components | Rust workspace (`Cargo.toml`, `packages/stanley-core`) | none in root | Swift/Kotlin apps (`apps/macos`, `apps/ios`, `apps/android`) |

## Top-level layout differences

### zee (top-level highlights)

- Zee domain code at repo root: `src/memory/`, `src/swarm/`, `src/domain/`
- Project-local configuration bundle: `.zee/` (commands/tools/themes/plans)
- Repo-local skills bundle: `.agents/skills/` (persona-scoped skills)
- Rust workspace: `Cargo.toml`, `Cargo.lock` (currently `packages/stanley-core`)

### opencode (top-level highlights)

- Project-local configuration bundle: `.opencode/`
- SST/infra + deployment files: `sst.config.ts`, `sst-env.d.ts`, `infra/`, `turbo.json`
- Multi-language README set + stats: many `README.<lang>.md`, `STATS.md`

### openclaw (top-level highlights)

- State/config is designed around `~/.openclaw/` (docs + scripts assume this)
- Skills live in-repo under `skills/` (first-party catalog) and also under user state
- Multi-platform apps + UI: `apps/`, `ui/`, `Swabble/`, plus web + gateway docs in `docs/`

## Monorepo package layout

### zee `packages/`

Unique packages (vs opencode):

- `zee/` (core CLI/TUI/daemon; renamed from `opencode/`)
- `zee-adapter/` (bridge/adapters)
- `extensions/` (Zee extensions; gateway/channel integrations live here and in `packages/zee/Swabble/extensions/`)
- `stanley-core/` (Rust)
- `hosted/` (zee-specific hosted surfaces)

### opencode `packages/`

Unique packages (vs zee):

- `opencode/` (core CLI/TUI/daemon)
- `console/`, `enterprise/`, `identity/`, `function/`, `containers/`, `script/`, `slack/`, `docs/`

### openclaw `packages/`

- `clawdbot/`, `moltbot/` (thin wrappers that depend on the main `openclaw` package)

## CLI command surface

### zee vs opencode (core CLI)

The shared core commands are broadly the same (`agent`, `auth`, `run`, `session`, `tui`, `mcp`, `models`, `serve`, etc.), but zee adds several top-level command groups:

- Present in zee, not in opencode: `always-on`, `bug-report`, `check`, `clawhub`, `daemon`, `daemon-install`, `plugin/*`, `provider`, `setup`
- Present in opencode, not in zee: `web`

### openclaw (command tree)

OpenClaw’s command surface is much broader and operationally oriented (onboarding wizard, doctor flows, gateway status/probe, channels management, nodes, skills install/sync, packaging).
The command entrypoints live in `src/commands/`.

## Config and state model

| Dimension | zee | opencode | openclaw |
| --- | --- | --- | --- |
| Global config | `~/.config/zee/zee.json{,c}` | `~/.config/opencode/opencode.json{,c}` | `~/.openclaw/openclaw.json` (or `$OPENCLAW_STATE_DIR/openclaw.json`) |
| Project config | `.zee/` in project root | `.opencode/` in project root | not the primary model; uses the state dir + “workspace” repo |
| Secrets | env vars only (config JSONC references `{env:...}`) | env vars + config | `~/.openclaw/.env` plus env vars; config can fill defaults |
| State | `~/.local/state/zee/` (plus Qdrant) | `~/.local/state/opencode/` (plus app/server state) | `~/.openclaw/` (agents, creds, logs, sessions, skills, workspace) |

## Providers / model backends (practical differences)

### zee vs opencode (AI SDK footprint)

`packages/zee` keeps a smaller provider surface and adds memory + messaging:

- Present in zee deps, not in opencode deps: `@qdrant/js-client-rest`, `@whiskeysockets/baileys`, `whatsapp-web.js`, `google-auth-library`, `croner`, `yaml`
- Present in opencode deps, not in zee deps: many additional `@ai-sdk/*` provider packages (Bedrock/Azure/Groq/Mistral/etc), `ai-gateway-provider`, `partial-json`, plus opencode workspace packages (`@opencode-ai/*`)

### openclaw (provider stack)

OpenClaw does not mirror the AI SDK surface; it uses a Pi-based provider/tooling stack (`@mariozechner/pi-*`) and includes operational deps for channels and gateway services (Slack/Discord/etc), plus `sqlite-vec` for local indexing.

## Gateway / channels

### openclaw (full surface)

- Gateway WebSocket control plane (clients, tools, events)
- Broad channel coverage (WhatsApp/Slack/Discord/Signal/iMessage/Google Chat/Teams/etc), with extensions for additional channels
- Device nodes (macOS/iOS/Android) for device-local actions and permissions
- Remote access patterns (Tailscale Serve/Funnel, SSH tunnels)

### zee (Zee gateway subset)

zee embeds a trimmed “OpenClaw-like” gateway inside the Zee persona package:

- Zee gateway code lives in `packages/zee/Swabble/src/`
- Compared to `openclaw/src/`, Zee’s copy is missing these top-level subsystems:
  - `canvas-host/`
  - `compat/`
  - `extensionAPI.ts`
  - `feishu/`
  - `imessage/`
  - `line/`
  - `macos/`
  - `signal/`

Zee now ships bundled first-party channel plugins for Slack/Discord/Telegram under
`packages/zee/Swabble/extensions/` (instead of mirroring OpenClaw's original top-level source layout).
Slack and Discord extensions include policy-gated native action packs (reactions, pin/unpin, channel-info).

Operationally, Zee’s gateway is launched by zee only when explicitly enabled (for example `zee daemon --gateway`).

### opencode (not a messaging product)

OpenCode’s “server mode” is about a client/server split for the coding agent and UI surfaces; it does not aim to provide multi-channel messaging or device nodes.

## Upstream Sync Lanes

This section tracks discrete upstream-delta triage "lanes" between zee's Zee gateway subset (`packages/zee/Swabble/`) and OpenClaw (`openclaw/openclaw`).

### Lane 01: Gateway control plane (WS protocol, auth, events)

Source tracking issue: `adolago/zee#224`.

Comparison snapshot used for triage (historical context):

- zee: `1942d6fe01bc4e497856e25af500b05f805d7d98`
- openclaw/openclaw: `aaddbdae52d71bff3a74fa28dd6597816e2d7592`

Triage outcome:

| Upstream PR / commit | Title | Decision | zee location |
| --- | --- | --- | --- |
| openclaw/openclaw#9858 | Redact credentials from gateway config.get responses | Ported | `packages/zee/Swabble/src/gateway/server-methods/config.ts`, `packages/zee/Swabble/src/config/redact-snapshot.ts` |
| openclaw commit `66d8117d` | Harden WebSocket origin checks | Ported (adapted to Zee gateway) | `packages/zee/Swabble/src/gateway/server-http.ts`, `packages/zee/Swabble/src/gateway/origin-check.ts` |
| openclaw commit `35eb40a7` | Treat channel/group metadata as untrusted content | Ported | `packages/zee/Swabble/src/auto-reply/reply/groups.ts`, `packages/zee/Swabble/src/security/channel-metadata.ts`, `packages/zee/Swabble/src/security/external-content.ts` |

Notes:

- Configure `gateway.allowedOrigins` when connecting from a different browser origin (for example a dev server on `http://127.0.0.1:5173`).
- Config RPC responses use the sentinel `<redacted>` for sensitive keys; config writes restore `<redacted>` values from the current on-disk config to avoid accidental secret loss.

### Lane 12: Onboarding + daemon install + operational CLI

Source tracking issue: `adolago/zee#235`.

Comparison snapshot used for triage (historical context):

- zee: `1942d6fe01bc4e497856e25af500b05f805d7d98`
- openclaw/openclaw: `aaddbdae52d71bff3a74fa28dd6597816e2d7592`

Triage outcome:

| Upstream PR | Title | Decision | zee location |
| --- | --- | --- | --- |
| openclaw/openclaw#1512 | Linux user bin dirs in systemd PATH | Already ported | `packages/zee/Swabble/src/daemon/service-env.ts` |
| openclaw/openclaw#1505 | Prefer symlinked paths over realpath | Already ported | `packages/zee/Swabble/src/daemon/program-args.ts` |
| openclaw/openclaw#1735 | Propagate config env vars to gateway services | Already ported | `packages/zee/Swabble/src/commands/daemon-install-helpers.ts` |
| openclaw/openclaw#1485 | Support direct token + provider in auth apply commands | Already ported | `packages/zee/Swabble/src/commands/auth-choice.apply.*.ts` |
| openclaw/openclaw#10176 | Guard `resolveUserPath` against undefined input | Ported | `packages/zee/Swabble/src/utils.ts`, `packages/zee/Swabble/src/config/paths.ts`, `packages/zee/Swabble/src/daemon/paths.ts` (commit `3dad5d25bb`) |
| openclaw/openclaw#5370 | Bump minimum Node.js to 22.12.0 | Ported | `packages/zee/Swabble/src/infra/runtime-guard.ts`, `packages/zee/Swabble/package.json` (commit `3dad5d25bb`) |
| openclaw/openclaw#9436 | Silence token in URL query parameters | Adapted | `packages/zee/Swabble/src/gateway/hooks.ts`, `packages/zee/Swabble/src/gateway/server-http.ts`, `packages/zee/Swabble/src/hooks/gmail-setup-utils.ts` (commit `3dad5d25bb`) |

Notes:

- Token-in-URL support is intentionally not supported in zee Zee hooks. Use `Authorization: Bearer <token>` or `X-Zee-Token: <token>`.

## Skills system (format + content)

### Format

Both zee and openclaw use `SKILL.md` files with YAML frontmatter and a progressive disclosure style, but the metadata conventions differ:

- openclaw skills often carry `metadata.openclaw.emoji` (zee avoids emojis and uses `metadata.clawhub` identifiers)
- zee stores many skills under `.agents/skills/@zee/`, `.agents/skills/@stanley/`, `.agents/skills/@johny/` to align skills with personas

### Inventory (repo snapshot)

- openclaw: 53 in-repo skills under `skills/*/SKILL.md`
- zee: 64 in-repo skills under `.agents/skills/**/SKILL.md`

Overlap is mostly in "utility" skills (for example `weather`, `spotify-player`), with zee adding persona-specific skills (investing/learning/memory patterns) and openclaw including many operational integrations (Notion/Obsidian/Discord/etc). WhatsApp is now handled via meta-cli rather than a skill.

## Memory / persistence

- **zee**: semantic memory is a first-class feature (Qdrant-backed vector memory, embedding profiles in config, shared memory types under `src/memory/`).
- **opencode**: focuses on sessions, project worktrees, and coding workflows; it does not ship a Qdrant-backed semantic memory subsystem in the same way.
- **openclaw**: treats `~/.openclaw/workspace/` as the canonical “human-readable memory” surface, with optional local indexing (`sqlite-vec`) and extensive operational state (channels, allowlists, pairing, approvals).

## Concrete diff metrics (zee vs opencode)

These numbers are intended to size the divergence, not to replace a full code review:

- Commit divergence (`git rev-list --left-right --count opencode/dev...HEAD`): `1520` (opencode-only) vs `1185` (zee-only)
- File delta (with rename detection raised: `git -c diff.renameLimit=20000 diff --name-status opencode/dev...HEAD`):
  - Added: `4341`
  - Deleted: `689`
  - Modified: `224`
  - Renamed: `333`

### pi-mono dependency tracking

Zee vendors `@mariozechner/pi-*` packages via npm (not git merge):

- Installed: `@mariozechner/pi-coding-agent@0.52.9` (in `packages/zee/Swabble/package.json`)
- Latest tag: `v0.52.9` (on `pimono/main`)
- Update: `cd packages/zee/Swabble && bun update @mariozechner/pi-coding-agent @mariozechner/pi-agent-core @mariozechner/pi-ai @mariozechner/pi-tui`

## How to reproduce / extend this mapping

From the zee repo:

```bash
# 1) High-level fork delta vs opencode
git rev-list --left-right --count opencode/dev...HEAD
git -c diff.renameLimit=20000 diff --name-status opencode/dev...HEAD > /tmp/opencode.diff.txt

# 2) Compare Zee gateway tree vs OpenClaw src (directory-level)
diff -ruN packages/zee/Swabble/src /tmp/zee-compare/openclaw/src || true

# 3) Compare dependency surfaces (core packages)
jq -r '.dependencies | keys[]' packages/zee/package.json | sort > /tmp/zee.deps
jq -r '.dependencies | keys[]' /tmp/zee-compare/opencode/packages/opencode/package.json | sort > /tmp/opencode.deps
comm -3 /tmp/zee.deps /tmp/opencode.deps
```
