# agent-core vs sst/opencode vs openclaw

This document maps the high-signal differences between agent-core and:

- `sst/opencode` (OpenCode, `dev` branch)
- `openclaw/openclaw` (OpenClaw, `main` branch)

Snapshot used for this comparison:

- agent-core: `aa815e1c86` (local `dev`)
- opencode: `fa20bc2` (cloned `dev`)
- openclaw: `f2c5c84` (cloned `main`)

## Summary (what each repo is)

- **agent-core**: a CLI agent engine that powers the Personas system (**Zee**, **Stanley**, **Johny**). It adds persona routing, semantic memory (Qdrant), orchestration, and an optional always-on messaging gateway.
- **opencode**: an open source AI coding agent (TUI-first) with a client/server architecture and LSP support.
- **openclaw**: a personal AI assistant with a Gateway WebSocket control plane, multi-channel messaging (WhatsApp/Slack/Discord/etc), device nodes (macOS/iOS/Android), and a large skill catalog.

## Relationship at a glance

- **agent-core ↔ opencode**: agent-core is a fork of opencode with a rebrand (`opencode` → `agent-core`) plus substantial additions (personas, memory, gateway/daemon workflows) and removals (SST/infra + some hosted/enterprise surfaces).
- **agent-core ↔ openclaw**: agent-core contains a large, intentionally reduced subset of OpenClaw’s Gateway/channel stack inside `packages/personas/zee/` (Zee’s gateway), but agent-core’s overall architecture is “multi-persona engine” rather than “single-assistant product”.

## Toolchain and runtime

| Dimension | agent-core | opencode | openclaw |
| --- | --- | --- | --- |
| Package manager | Bun (`bun.lock`, `packageManager: bun@1.3.5`) | Bun (`bun.lock`, `packageManager: bun@1.3.5`) | pnpm (`pnpm-lock.yaml`, `packageManager: pnpm@10.23.0`) |
| Primary runtime | Bun (dev/build) | Bun (dev/build) | Node 22+ (runtime); pnpm for builds; Bun optional for TS execution |
| CLI framework | yargs (in `packages/agent-core`) | yargs (in `packages/opencode`) | commander (`src/commands`) |
| Non-TS components | Rust workspace (`Cargo.toml`, `packages/stanley-core`) | none in root | Swift/Kotlin apps (`apps/macos`, `apps/ios`, `apps/android`) |

## Top-level layout differences

### agent-core (top-level highlights)

- Persona + memory code at repo root: `src/personas/`, `src/memory/`, `src/swarm/`, `src/domain/`
- Project-local configuration bundle: `.agent-core/` (commands/tools/themes/plans)
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

### agent-core `packages/`

Unique packages (vs opencode):

- `agent-core/` (core CLI/TUI/daemon; renamed from `opencode/`)
- `agent-core-adapter/` (bridge/adapters)
- `personas/` (persona packages; notably `personas/zee/`)
- `stanley-core/` (Rust)
- `hosted/` (agent-core-specific hosted surfaces)

### opencode `packages/`

Unique packages (vs agent-core):

- `opencode/` (core CLI/TUI/daemon)
- `console/`, `enterprise/`, `identity/`, `function/`, `containers/`, `script/`, `slack/`, `docs/`

### openclaw `packages/`

- `clawdbot/`, `moltbot/` (thin wrappers that depend on the main `openclaw` package)

## CLI command surface

### agent-core vs opencode (core CLI)

The shared core commands are broadly the same (`agent`, `auth`, `run`, `session`, `tui`, `mcp`, `models`, `serve`, etc.), but agent-core adds several top-level command groups:

- Present in agent-core, not in opencode: `always-on`, `bug-report`, `check`, `clawhub`, `daemon`, `daemon-install`, `plugin/*`, `provider`, `setup`
- Present in opencode, not in agent-core: `web`

### openclaw (command tree)

OpenClaw’s command surface is much broader and operationally oriented (onboarding wizard, doctor flows, gateway status/probe, channels management, nodes, skills install/sync, packaging).
The command entrypoints live in `src/commands/`.

## Config and state model

| Dimension | agent-core | opencode | openclaw |
| --- | --- | --- | --- |
| Global config | `~/.config/agent-core/agent-core.json{,c}` | `~/.config/opencode/opencode.json{,c}` | `~/.openclaw/openclaw.json` (or `$OPENCLAW_STATE_DIR/openclaw.json`) |
| Project config | `.agent-core/` in project root | `.opencode/` in project root | not the primary model; uses the state dir + “workspace” repo |
| Secrets | env vars only (config JSONC references `{env:...}`) | env vars + config | `~/.openclaw/.env` plus env vars; config can fill defaults |
| State | `~/.local/state/agent-core/` (plus Qdrant) | `~/.local/state/opencode/` (plus app/server state) | `~/.openclaw/` (agents, creds, logs, sessions, skills, workspace) |

## Providers / model backends (practical differences)

### agent-core vs opencode (AI SDK footprint)

`packages/agent-core` keeps a smaller provider surface and adds memory + messaging:

- Present in agent-core deps, not in opencode deps: `@qdrant/js-client-rest`, `@whiskeysockets/baileys`, `whatsapp-web.js`, `google-auth-library`, `croner`, `yaml`
- Present in opencode deps, not in agent-core deps: many additional `@ai-sdk/*` provider packages (Bedrock/Azure/Groq/Mistral/etc), `ai-gateway-provider`, `partial-json`, plus opencode workspace packages (`@opencode-ai/*`)

### openclaw (provider stack)

OpenClaw does not mirror the AI SDK surface; it uses a Pi-based provider/tooling stack (`@mariozechner/pi-*`) and includes operational deps for channels and gateway services (Slack/Discord/etc), plus `sqlite-vec` for local indexing.

## Gateway / channels

### openclaw (full surface)

- Gateway WebSocket control plane (clients, tools, events)
- Broad channel coverage (WhatsApp/Slack/Discord/Signal/iMessage/Google Chat/Teams/etc), with extensions for additional channels
- Device nodes (macOS/iOS/Android) for device-local actions and permissions
- Remote access patterns (Tailscale Serve/Funnel, SSH tunnels)

### agent-core (Zee gateway subset)

agent-core embeds a trimmed “OpenClaw-like” gateway inside the Zee persona package:

- Zee gateway code lives in `packages/personas/zee/src/`
- Compared to `openclaw/src/`, Zee’s copy is missing these top-level subsystems:
  - `canvas-host/`
  - `compat/`
  - `discord/`
  - `extensionAPI.ts`
  - `feishu/`
  - `imessage/`
  - `line/`
  - `macos/`
  - `signal/`
  - `slack/`

Operationally, Zee’s gateway is launched by agent-core only when explicitly enabled (for example `agent-core daemon --gateway`).

### opencode (not a messaging product)

OpenCode’s “server mode” is about a client/server split for the coding agent and UI surfaces; it does not aim to provide multi-channel messaging or device nodes.

## Upstream Sync Lanes

This section tracks discrete upstream-delta triage "lanes" between agent-core's Zee gateway subset (`packages/personas/zee/`) and OpenClaw (`openclaw/openclaw`).

### Lane 07: Permissions, allowlists, DM policy, pairing/approvals

Source tracking issue: `adolago/agent-core#230`.

Ported / adapted:

- External content hardening: strip spoofed boundary markers and fold fullwidth bracket homoglyphs in `packages/personas/zee/src/security/external-content.ts`.
- Hook auth hardening: reject token query parameters; header-only auth via `Authorization: Bearer ...` or `X-Zee-Token` in `packages/personas/zee/src/gateway/server-http.ts`.
- Gateway WebSocket origin validation (strict same-host; allow missing Origin for non-browser clients) in `packages/personas/zee/src/gateway/origin-check.ts` and `packages/personas/zee/src/gateway/server-http.ts`.
- Separate untrusted group subject/members into an explicit untrusted wrapper via `packages/personas/zee/src/security/channel-metadata.ts` and `packages/personas/zee/src/auto-reply/reply/groups.ts`.

Deferred / non-goals:

- Full OpenClaw channel parity (Discord/Slack/etc) and per-account DM scope guidance are out of scope for Zee.
- Windows-only ACL test stabilization is a low priority for the current Linux-focused setup.
- OpenClaw Control UI-specific hardening does not map cleanly onto Zee's gateway architecture.

### Lane 12: Onboarding + daemon install + operational CLI

Source tracking issue: `adolago/agent-core#235`.

Comparison snapshot used for triage (historical context):

- agent-core: `1942d6fe01bc4e497856e25af500b05f805d7d98`
- openclaw/openclaw: `aaddbdae52d71bff3a74fa28dd6597816e2d7592`

Triage outcome:

| Upstream PR | Title | Decision | agent-core location |
| --- | --- | --- | --- |
| openclaw/openclaw#1512 | Linux user bin dirs in systemd PATH | Already ported | `packages/personas/zee/src/daemon/service-env.ts` |
| openclaw/openclaw#1505 | Prefer symlinked paths over realpath | Already ported | `packages/personas/zee/src/daemon/program-args.ts` |
| openclaw/openclaw#1735 | Propagate config env vars to gateway services | Already ported | `packages/personas/zee/src/commands/daemon-install-helpers.ts` |
| openclaw/openclaw#1485 | Support direct token + provider in auth apply commands | Already ported | `packages/personas/zee/src/commands/auth-choice.apply.*.ts` |
| openclaw/openclaw#10176 | Guard `resolveUserPath` against undefined input | Ported | `packages/personas/zee/src/utils.ts`, `packages/personas/zee/src/config/paths.ts`, `packages/personas/zee/src/daemon/paths.ts` (commit `3dad5d25bb`) |
| openclaw/openclaw#5370 | Bump minimum Node.js to 22.12.0 | Ported | `packages/personas/zee/src/infra/runtime-guard.ts`, `packages/personas/zee/package.json` (commit `3dad5d25bb`) |
| openclaw/openclaw#9436 | Silence token in URL query parameters | Adapted | `packages/personas/zee/src/gateway/hooks.ts`, `packages/personas/zee/src/gateway/server-http.ts`, `packages/personas/zee/src/hooks/gmail-setup-utils.ts` (commit `3dad5d25bb`) |

Notes:

- Token-in-URL support is intentionally not supported in agent-core Zee hooks. Use `Authorization: Bearer <token>` or `X-Zee-Token: <token>`.

## Skills system (format + content)

### Format

Both agent-core and openclaw use `SKILL.md` files with YAML frontmatter and a progressive disclosure style, but the metadata conventions differ:

- openclaw skills often carry `metadata.openclaw.emoji` (agent-core avoids emojis and uses `metadata.clawhub` identifiers)
- agent-core stores many skills under `.agents/skills/@zee/`, `.agents/skills/@stanley/`, `.agents/skills/@johny/` to align skills with personas

### Inventory (repo snapshot)

- openclaw: 53 in-repo skills under `skills/*/SKILL.md`
- agent-core: 64 in-repo skills under `.agents/skills/**/SKILL.md`

Overlap is mostly in “utility” skills (for example `weather`, `wacli`, `spotify-player`), with agent-core adding persona-specific skills (investing/learning/memory patterns) and openclaw including many operational integrations (Notion/Obsidian/Discord/etc).

## Memory / persistence

- **agent-core**: semantic memory is a first-class feature (Qdrant-backed vector memory, embedding profiles in config, shared memory types under `src/memory/`).
- **opencode**: focuses on sessions, project worktrees, and coding workflows; it does not ship a Qdrant-backed semantic memory subsystem in the same way.
- **openclaw**: treats `~/.openclaw/workspace/` as the canonical “human-readable memory” surface, with optional local indexing (`sqlite-vec`) and extensive operational state (channels, allowlists, pairing, approvals).

## Concrete diff metrics (agent-core vs opencode)

These numbers are intended to size the divergence, not to replace a full code review:

- Commit divergence (`git rev-list --left-right --count opencode/dev...HEAD`): `1197` (opencode-only) vs `999` (agent-core-only)
- File delta (with rename detection raised: `git -c diff.renameLimit=20000 diff --name-status opencode/dev...HEAD`):
  - Added: `3655`
  - Deleted: `626`
  - Modified: `213`
  - Renamed: `376`

## How to reproduce / extend this mapping

From the agent-core repo:

```bash
# 1) High-level fork delta vs opencode
git rev-list --left-right --count opencode/dev...HEAD
git -c diff.renameLimit=20000 diff --name-status opencode/dev...HEAD > /tmp/opencode.diff.txt

# 2) Compare Zee gateway tree vs OpenClaw src (directory-level)
diff -ruN packages/personas/zee/src /tmp/agent-core-compare/openclaw/src || true

# 3) Compare dependency surfaces (core packages)
jq -r '.dependencies | keys[]' packages/agent-core/package.json | sort > /tmp/agent-core.deps
jq -r '.dependencies | keys[]' /tmp/agent-core-compare/opencode/packages/opencode/package.json | sort > /tmp/opencode.deps
comm -3 /tmp/agent-core.deps /tmp/opencode.deps
```
