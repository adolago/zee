# Feature Comparison

This document is generated. Do not edit by hand.

Regenerate:

```bash
cd packages/zee && bun run --conditions=browser ./src/index.ts compare --format md --scope full --output ../../docs/architecture/feature-comparison.md
```

## Snapshot

- Generated: `2026-02-12T16:32:06.828Z`
- Zee: `dev/0.2.13-nightly` (`binary`)
- Zee git: `77d8e72b8e0a90dc4831c57a2615d006b416f63a`
- OpenCode pin: `59a323e9a87d315ff5c0e73c4eb5af089aeff87f` (`opencode/dev`)
- OpenClaw pin: `a2ddcdadebfe0c18dab38816be097a094888d03e` (`openclaw/main`)
- Pi-mono pin: `28c0991281f70145a030a27782e0a14e3ec2f91c` (`pimono/main`)
- Pi-mono installed: `@mariozechner/pi-coding-agent@0.52.9`
- Pi-mono latest tag: `v0.52.9`
- Skills: `81` (top: @zee=34, @codex=34, @clawhub=11, parallel-orchestration=1, codebase-guide=1)

## Legend

- Yes: built-in
- Partial: exists but limited scope or different semantics
- Via plugin: available through plugins/extensions
- Planned: intended but not yet shipped
- N/A: not applicable
- Unknown: not verified

## Feature Matrix

| Feature | Description | Zee | OpenCode | OpenClaw | Pi-mono |
| --- | --- | --- | --- | --- | --- |
| **Positioning** |  |  |  |  |  |
| Dedicated coding agent | A primary product surface aimed at software development workflows. | Yes | Yes | Partial | Yes |
| Personal assistant product | Designed to answer on everyday channels (chat apps, devices) as a single-user assistant. | Partial | No | Yes | No |
| Reusable agent libraries | Ships reusable packages (LLM API, agent runtime, TUI toolkit) meant to be embedded elsewhere. | Partial | Partial | Partial | Yes |
| Unified assistant engine | Focuses on life admin + investing + learning as a single engine with domain toolsets. | Yes | No | Partial | No |
| **Surfaces** |  |  |  |  |  |
| CLI | Command-line interface for interacting with the agent and managing configuration. | Yes | Yes | Yes | Yes |
| Daemon/service mode | Runs as a background service (systemd/launchd) for always-on operation. | Yes | Partial | Yes | No |
| Desktop app | Ships a desktop application distribution in addition to a CLI. | No | Yes | Yes | No |
| HTTP API + OpenAPI | Exposes an HTTP API and/or generates OpenAPI specs. | Yes | Partial | Yes | Partial |
| Shell completion | Built-in shell completion generation. | Yes | Yes | Unknown | Unknown |
| Terminal UI (TUI) | Interactive terminal UI beyond simple prompts. | Yes | Yes | Partial | Yes |
| Web UI | Ships a web UI/control surface in the core repo. | Partial | Yes | Yes | Partial |
| **Architecture** |  |  |  |  |  |
| Client/server split | Separates a client UI from a server runtime for the agent. | Yes | Yes | Yes | Partial |
| Gateway WS control plane | A WebSocket control plane for channels/tools/events and remote clients. | Yes | No | Yes | No |
| Multi-persona routing | First-class persona/domain routing inside the engine. | Yes | No | Partial | Partial |
| Session system | Persistent sessions with message history and tooling context. | Yes | Yes | Yes | Partial |
| **Config & State** |  |  |  |  |  |
| Global config file | Has a primary global config file path for defaults and policies. | Yes | Yes | Yes | Partial |
| Project-local config bundle | Supports a project-local directory bundle (.zee/ or .opencode/) for config/tools/themes/plans. | Yes | Yes | No | No |
| Secret handling policy | Defines how API keys/OAuth tokens are stored and referenced. | Yes | Partial | Yes | Partial |
| State root override | Allows overriding the main state/config root via env var(s). | Yes | Unknown | Yes | Unknown |
| Workspace/worktree model | Has a canonical workspace/worktree location where projects/sessions run. | Yes | Yes | Yes | Partial |
| XDG directories | Uses XDG Base Dir paths for config/cache/state on Linux. | Yes | Yes | No | Unknown |
| **Memory** |  |  |  |  |  |
| Local indexing store | Local embedding index (e.g. sqlite-vec) and plugin-based memory stores. | Partial | No | Yes | No |
| Qdrant integration | First-class Qdrant support for vectors/memory. | Yes | No | No | No |
| Semantic memory | Semantic recall beyond session history (embeddings, retrieval, long-term memory). | Yes | No | Yes | Partial |
| Session export/import | Exports/imports session data for portability and backups. | Yes | Unknown | Partial | No |
| **Extensibility** |  |  |  |  |  |
| Cron/reminders | Built-in cron scheduling for reminders/background jobs. | Yes | Unknown | Yes | No |
| MCP support | Model Context Protocol support for tool servers/clients. | Yes | Yes | Partial | Unknown |
| Plugin manager | Install/search/remove plugins via a first-class CLI. | Yes | No | Partial | No |
| Skill/plugin safety scanning | Scans skill/plugin code for risky patterns as a supply-chain guardrail. | Yes | No | Yes | No |
| Skills system (SKILL.md) | Skill packaging using SKILL.md files (with metadata and progressive disclosure). | Yes | No | Yes | No |
| Tool permissions/approvals | Interactive and/or policy-driven permission gating for tools and commands. | Yes | Partial | Yes | Partial |
| **Coding Workflow** |  |  |  |  |  |
| GitHub automation | First-class GitHub workflows (PR/issue automation) via a dedicated command surface. | Yes | Unknown | Partial | No |
| LSP integration | Language Server Protocol integration for code intelligence in the agent workflow. | Yes | Yes | No | No |
| Patch-based edits | Generates/applies patches and diffs as a core editing primitive. | Yes | Yes | Partial | No |
| VS Code extension | Editor extension to integrate the agent with VS Code. | Yes | Yes | No | No |
| Worktrees/workspaces for code | Project worktrees for running tools, reading files, and isolating sessions per repo. | Yes | Yes | Partial | Partial |
| **Messaging & Channels** |  |  |  |  |  |
| Device nodes | macOS/iOS/Android nodes for device-local actions (voice, camera, screen). | No | No | Yes | No |
| DM pairing + allowlists | Pairing codes and allowlists to gate untrusted inbound DMs by default. | Yes | No | Yes | No |
| Multi-channel inbox | Multiple real-world channels (Telegram/Slack/Discord/Signal/etc). | Partial | No | Yes | No |
| Voice wake/talk mode | Always-on voice interfaces (wake word, talk mode) through device nodes. | No | No | Yes | No |
| WhatsApp | WhatsApp channel integration for inbound/outbound messaging. | Yes | No | Yes | No |
| **Providers & Models** |  |  |  |  |  |
| Embeddings | Embeddings support for memory/search. | Yes | Unknown | Yes | Unknown |
| Local models | Local model backends (e.g., Ollama) as a supported provider. | Yes | Yes | Yes | Partial |
| Multi-provider LLM support | Supports multiple LLM providers (OpenAI/Anthropic/Google/etc). | Yes | Yes | Yes | Yes |
| OAuth subscriptions | OAuth-based auth flows for subscription products (e.g., Claude Pro/Max, ChatGPT). | Partial | Partial | Yes | No |
| **Security & Ops** |  |  |  |  |  |
| Crash report generator | Generates a structured crash report bundle for issue filing. | Yes | Unknown | Unknown | No |
| Health checks | Built-in diagnostics/doctor command for setup and runtime health. | Yes | Unknown | Yes | Partial |
| systemd/launchd install | Installs a user service for always-on operation on supported platforms. | Yes | Unknown | Yes | No |
| Upstream sync lanes (maintainers) | Maintainer tooling and docs for tracking upstream deltas across multiple repos. | Yes | No | No | No |
| **Packaging** |  |  |  |  |  |
| npm package | Published as an npm package. | Yes | Yes | Yes | Yes |
| Prebuilt binaries | Ships prebuilt binaries (or installers) in addition to source install. | Partial | Yes | Partial | No |

## Notes (Full)

### Positioning

#### Dedicated coding agent

A primary product surface aimed at software development workflows.

- Zee: Yes | Zee retains the core coding-agent surfaces (run/session/TUI/LSP) and adds additional domains. | evidence: doc:docs/architecture/upstream-differences.md
- OpenCode: Yes | evidence: note:sst/opencode README (dev)
- OpenClaw: Partial | OpenClaw can do coding tasks but is positioned as a personal assistant product. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Yes | Includes @mariozechner/pi-coding-agent CLI. | evidence: note:badlogic/pi-mono README (main)

#### Personal assistant product

Designed to answer on everyday channels (chat apps, devices) as a single-user assistant.

- Zee: Partial | Optional embedded gateway enables always-on messaging, but Zee’s core is a multi-domain engine. | evidence: doc:docs/architecture/upstream-differences.md
- OpenCode: No | Not a messaging-first assistant product. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)
- Pi-mono: No | Provides tools and CLIs; not a personal assistant across messaging channels. | evidence: note:badlogic/pi-mono README (main)

#### Reusable agent libraries

Ships reusable packages (LLM API, agent runtime, TUI toolkit) meant to be embedded elsewhere.

- Zee: Partial | Zee is a product/engine; it has internal packages but is not primarily a library monorepo.
- OpenCode: Partial | Primarily a product; provides some SDK surfaces but not positioned as a library monorepo.
- OpenClaw: Partial | Primarily a product; uses Pi-based packages but is not itself a library monorepo.
- Pi-mono: Yes | Pi-mono is explicitly a multi-package tools monorepo (pi-ai, pi-agent-core, pi-tui, etc). | evidence: note:badlogic/pi-mono README (main)

#### Unified assistant engine

Focuses on life admin + investing + learning as a single engine with domain toolsets.

- Zee: Yes | evidence: doc:README.md
- OpenCode: No | OpenCode is primarily an AI coding agent. | evidence: note:sst/opencode README (dev)
- OpenClaw: Partial | Personal assistant focus; not positioned as a multi-domain engine with investing/learning personas. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: No | Pi-mono is a tools monorepo (agent runtime, LLM API, CLIs). | evidence: note:badlogic/pi-mono README (main)

### Surfaces

#### CLI

Command-line interface for interacting with the agent and managing configuration.

- Zee: Yes | evidence: repo_path:packages/zee/src/index.ts
- OpenCode: Yes | evidence: note:sst/opencode README (dev)
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Yes | evidence: note:badlogic/pi-mono README (main)

#### Daemon/service mode

Runs as a background service (systemd/launchd) for always-on operation.

- Zee: Yes | evidence: repo_path:packages/zee/src/cli/cmd/daemon.ts
- OpenCode: Partial | Has client/server and desktop modes; not primarily an always-on messaging daemon.
- OpenClaw: Yes | Wizard installs a gateway daemon. | evidence: note:openclaw/openclaw README (main)

#### Desktop app

Ships a desktop application distribution in addition to a CLI.

- OpenCode: Yes | evidence: note:sst/opencode README (dev)
- OpenClaw: Yes | macOS app plus iOS/Android nodes. | evidence: note:openclaw/openclaw README (main)

#### HTTP API + OpenAPI

Exposes an HTTP API and/or generates OpenAPI specs.

- Zee: Yes | Zee has `serve` and can generate OpenAPI with `zee generate`. | evidence: repo_path:packages/zee/src/cli/cmd/serve.ts, repo_path:packages/zee/src/cli/cmd/generate.ts
- OpenCode: Partial | Client/server architecture implies an API surface; exact OpenAPI generation varies by version.
- OpenClaw: Yes | Gateway control plane includes HTTP + WS endpoints for control surfaces. | evidence: doc:docs/architecture/upstream-differences.md
- Pi-mono: Partial | Includes multiple CLIs and packages; not a single documented OpenAPI surface.

#### Shell completion

Built-in shell completion generation.

- Zee: Yes | evidence: repo_path:packages/zee/src/index.ts
- OpenCode: Yes | Yargs-based CLIs typically ship completion; verify in upstream.

#### Terminal UI (TUI)

Interactive terminal UI beyond simple prompts.

- Zee: Yes | evidence: repo_path:packages/zee/src/cli/cmd/tui
- OpenCode: Yes | evidence: note:sst/opencode README (dev)
- OpenClaw: Partial | OpenClaw is CLI-first with a web control UI; terminal UX is mostly wizard/prompt driven.
- Pi-mono: Yes | Includes pi-coding-agent CLI and a dedicated pi-tui library. | evidence: note:badlogic/pi-mono README (main)

#### Web UI

Ships a web UI/control surface in the core repo.

- Zee: Partial | Zee does not expose the upstream `web` command, but includes web/hosted packages and gateway UI surfaces. | evidence: doc:docs/architecture/upstream-differences.md
- OpenCode: Yes | Includes web/console packages and web surfaces. | evidence: note:sst/opencode README (dev)
- OpenClaw: Yes | Control UI + WebChat. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Partial | Provides pi-web-ui components, not a single product web app. | evidence: note:badlogic/pi-mono README (main)

### Architecture

#### Client/server split

Separates a client UI from a server runtime for the agent.

- Zee: Yes | Server runtime (`zee daemon`/`zee serve`) and client UI (`zee attach`/`zee client`) are explicitly separated; remote targeting uses ZEE_URL + auth. | evidence: repo_path:packages/zee/src/cli/cmd/daemon.ts, repo_path:packages/zee/src/cli/cmd/serve.ts, repo_path:packages/zee/src/cli/cmd/tui/attach.ts, repo_path:packages/zee/src/cli/cmd/client.ts, doc:README.md
- OpenCode: Yes | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Yes | Gateway is the control plane; nodes can be remote.
- Pi-mono: Partial | pi-pods and other packages target deployments; not a single end-user client/server split.

#### Gateway WS control plane

A WebSocket control plane for channels/tools/events and remote clients.

- Zee: Yes | WebSocket gateway control plane (Swabble) for channels/tools/events, with CLI helpers and REST bridging. | evidence: repo_path:packages/zee/Swabble/src/gateway/server.ts, repo_path:packages/zee/src/gateway/embedded-gateway.ts, repo_path:packages/zee/src/server/route/gateway.ts, repo_path:packages/zee/src/cli/cmd/gateway, doc:docs/architecture/gateway-control-plane.md
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

#### Multi-persona routing

First-class persona/domain routing inside the engine.

- Zee: Yes | evidence: doc:docs/architecture/agent-personas.md
- OpenClaw: Partial | Supports multi-agent routing for channels/workspaces; differs from Zee personas. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Partial | Provides primitives to build multi-agent systems; not a product-level persona router.

#### Session system

Persistent sessions with message history and tooling context.

- Zee: Yes | evidence: doc:docs/architecture/session-system.md
- OpenCode: Yes | Core to OpenCode’s coding workflow.
- OpenClaw: Yes | Session model is a core concept. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Partial | pi-agent-core provides runtime state; session UX depends on the embedding product (pi-coding-agent / consumers).

### Config & State

#### Global config file

Has a primary global config file path for defaults and policies.

- Zee: Yes | ~/.config/zee/zee.jsonc | evidence: doc:README.md
- OpenCode: Yes | ~/.config/opencode/opencode.jsonc (varies by install) | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Yes | ~/.openclaw/openclaw.json (or $OPENCLAW_STATE_DIR) | evidence: doc:docs/architecture/upstream-differences.md
- Pi-mono: Partial | Per-package configuration; not a single global product config.

#### Project-local config bundle

Supports a project-local directory bundle (.zee/ or .opencode/) for config/tools/themes/plans.

- Zee: Yes | Uses .zee/ in project root. | evidence: doc:README.md
- OpenCode: Yes | Uses .opencode/ in project root. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: No | OpenClaw prefers the state dir + a workspace repo model. | evidence: doc:docs/architecture/upstream-differences.md

#### Secret handling policy

Defines how API keys/OAuth tokens are stored and referenced.

- Zee: Yes | Secrets are env-var only; JSONC config references {env:...}. | evidence: doc:docs/architecture/upstream-differences.md
- OpenCode: Partial | Supports env vars and config-based defaults depending on provider.
- OpenClaw: Yes | Uses a state-dir .env plus env vars; wizard-driven onboarding. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Partial | Depends on the consumer; pi-ai supports multiple providers and key sources.

#### State root override

Allows overriding the main state/config root via env var(s).

- Zee: Yes | ZEE_STATE_DIR | evidence: doc:README.md
- OpenClaw: Yes | OPENCLAW_STATE_DIR | evidence: doc:docs/architecture/upstream-differences.md

#### Workspace/worktree model

Has a canonical workspace/worktree location where projects/sessions run.

- Zee: Yes | Default worktree under XDG data; override via ZEE_WORKSPACE_DIR. | evidence: doc:README.md
- OpenCode: Yes | Project worktree/session model is core to coding workflows.
- OpenClaw: Yes | ~/.openclaw/workspace is the canonical surface. | evidence: doc:docs/architecture/upstream-differences.md
- Pi-mono: Partial | Depends on the specific CLI (pi-coding-agent) and consumer.

#### XDG directories

Uses XDG Base Dir paths for config/cache/state on Linux.

- Zee: Yes | evidence: doc:README.md
- OpenCode: Yes | OpenCode uses XDG-style config/state for most installs. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: No | OpenClaw uses a dedicated state root (e.g. ~/.openclaw). | evidence: doc:docs/architecture/upstream-differences.md

### Memory

#### Local indexing store

Local embedding index (e.g. sqlite-vec) and plugin-based memory stores.

- Zee: Partial | Gateway embeds memory extensions (e.g. LanceDB) in Swabble; primary semantic memory is Qdrant. | evidence: repo_path:packages/zee/Swabble/extensions
- OpenClaw: Yes | Uses sqlite-vec for local indexing and memory surfaces. | evidence: doc:docs/architecture/upstream-differences.md

#### Qdrant integration

First-class Qdrant support for vectors/memory.

- Zee: Yes | evidence: repo_path:src/memory
- OpenClaw: No | Uses local indexing (sqlite-vec) rather than Qdrant by default. | evidence: doc:docs/architecture/upstream-differences.md

#### Semantic memory

Semantic recall beyond session history (embeddings, retrieval, long-term memory).

- Zee: Yes | Qdrant-backed semantic memory. | evidence: repo_path:src/memory
- OpenCode: No | Primarily session/worktree focused; does not ship Qdrant-style semantic memory in the same way. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Yes | Local-first memory and indexing surfaces; differs in storage model. | evidence: doc:docs/architecture/upstream-differences.md
- Pi-mono: Partial | Provides LLM/runtime primitives; memory layer depends on the embedding product.

#### Session export/import

Exports/imports session data for portability and backups.

- Zee: Yes | evidence: repo_path:packages/zee/src/cli/cmd/export.ts, repo_path:packages/zee/src/cli/cmd/import.ts
- OpenClaw: Partial | Sessions are persisted; export UX differs.

### Extensibility

#### Cron/reminders

Built-in cron scheduling for reminders/background jobs.

- Zee: Yes | evidence: repo_path:packages/zee/Swabble/src/cron
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

#### MCP support

Model Context Protocol support for tool servers/clients.

- Zee: Yes | evidence: repo_path:packages/zee/src/cli/cmd/mcp.ts
- OpenCode: Yes | Core MCP support is part of the OpenCode lineage.
- OpenClaw: Partial | Has a broad tool system; MCP integration may exist but is not the primary abstraction.

#### Plugin manager

Install/search/remove plugins via a first-class CLI.

- Zee: Yes | evidence: repo_path:packages/zee/src/cli/cmd/plugin
- OpenCode: No | Zee’s plugin command group is not present in the upstream OpenCode command surface. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Partial | Has extensions and skills management; terminology and packaging differ.

#### Skill/plugin safety scanning

Scans skill/plugin code for risky patterns as a supply-chain guardrail.

- Zee: Yes | evidence: repo_path:packages/zee/src/skill/scanner.ts
- OpenClaw: Yes | Upstream has similar supply-chain scanning patterns (ported/adapted in Zee). | evidence: doc:docs/architecture/openclaw-delta-map.md

#### Skills system (SKILL.md)

Skill packaging using SKILL.md files (with metadata and progressive disclosure).

- Zee: Yes | Persona-scoped skills under .agents/skills. | evidence: doc:AGENTS.md
- OpenCode: No | OpenCode uses agent modes and extensions; does not ship the same SKILL.md catalog model.
- OpenClaw: Yes | Skills live under skills/ and user state. | evidence: doc:docs/architecture/upstream-differences.md

#### Tool permissions/approvals

Interactive and/or policy-driven permission gating for tools and commands.

- Zee: Yes | Fine-grained tool policy + sandbox gates. | evidence: repo_path:packages/zee/src/permission
- OpenCode: Partial | Built-in agent modes include a read-only/permissioned mode. | evidence: note:sst/opencode README (dev)
- OpenClaw: Yes | Pairing/allowlists + approvals are core for real channels. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Partial | Runtime and tools exist; approval model depends on consumers.

### Coding Workflow

#### GitHub automation

First-class GitHub workflows (PR/issue automation) via a dedicated command surface.

- Zee: Yes | Includes `zee github` and `zee pr` flows. | evidence: repo_path:packages/zee/src/cli/cmd/github.ts
- OpenClaw: Partial | Can act on GitHub via tools, but not necessarily a dedicated agent product surface.

#### LSP integration

Language Server Protocol integration for code intelligence in the agent workflow.

- Zee: Yes | evidence: repo_path:packages/zee/src/lsp
- OpenCode: Yes | LSP support is a core OpenCode capability. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: No | Not a primary surface for OpenClaw.

#### Patch-based edits

Generates/applies patches and diffs as a core editing primitive.

- Zee: Yes | evidence: repo_path:packages/zee/src/patch
- OpenCode: Yes | Patch editing is a typical OpenCode workflow; verify exact implementation in upstream.
- OpenClaw: Partial | Can do edits via tools/nodes; patch-first workflows are not the primary surface.

#### VS Code extension

Editor extension to integrate the agent with VS Code.

- Zee: Yes | Ships a VS Code SDK/extension in-repo. | evidence: repo_path:sdks/vscode
- OpenCode: Yes | Upstream ships editor/desktop surfaces; VS Code extension exists in the OpenCode ecosystem.

#### Worktrees/workspaces for code

Project worktrees for running tools, reading files, and isolating sessions per repo.

- Zee: Yes | evidence: repo_path:packages/zee/src/worktree
- OpenCode: Yes | Worktree/session model is core to OpenCode. | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Partial | Has a workspace repo model for assistant context rather than code worktrees. | evidence: doc:docs/architecture/upstream-differences.md
- Pi-mono: Partial | Depends on pi-coding-agent behavior; not a universal repo worktree system.

### Messaging & Channels

#### Device nodes

macOS/iOS/Android nodes for device-local actions (voice, camera, screen).

- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

#### DM pairing + allowlists

Pairing codes and allowlists to gate untrusted inbound DMs by default.

- Zee: Yes | evidence: repo_path:packages/zee/Swabble/src/pairing
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

#### Multi-channel inbox

Multiple real-world channels (Telegram/Slack/Discord/Signal/etc).

- Zee: Partial | Zee embeds a reduced subset of OpenClaw’s channel stack (focuses on WhatsApp and a small set of surfaces). | evidence: doc:docs/architecture/upstream-differences.md
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

#### Voice wake/talk mode

Always-on voice interfaces (wake word, talk mode) through device nodes.

- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

#### WhatsApp

WhatsApp channel integration for inbound/outbound messaging.

- Zee: Yes | WhatsApp support exists in Zee’s embedded gateway. | evidence: repo_path:packages/zee/Swabble/src/web
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

### Providers & Models

#### Embeddings

Embeddings support for memory/search.

- Zee: Yes | Google-only embeddings for semantic memory by default. | evidence: doc:docs/architecture/openclaw-delta-map.md
- OpenClaw: Yes | Supports embedding/indexing flows; storage differs.

#### Local models

Local model backends (e.g., Ollama) as a supported provider.

- Zee: Yes | Includes an Ollama provider in the provider stack. | evidence: doc:docs/architecture/openclaw-delta-map.md
- OpenCode: Yes | Common in OpenCode deployments; verify exact provider set in upstream.
- OpenClaw: Yes | Supports local and remote models; configuration differs.
- Pi-mono: Partial | pi-ai supports multiple deployment targets; local backend coverage depends on package configuration.

#### Multi-provider LLM support

Supports multiple LLM providers (OpenAI/Anthropic/Google/etc).

- Zee: Yes | Uses the AI SDK provider stack and gateway provider integrations. | evidence: repo_path:packages/zee/package.json
- OpenCode: Yes | Multi-provider support is core to OpenCode deployments.
- OpenClaw: Yes | Supports any model; recommended subscription-based flows for Anthropic/OpenAI. | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Yes | pi-ai provides a unified multi-provider API. | evidence: note:badlogic/pi-mono README (main)

#### OAuth subscriptions

OAuth-based auth flows for subscription products (e.g., Claude Pro/Max, ChatGPT).

- Zee: Partial | Zee supports plugin-based OAuth flows for some providers; coverage depends on installed plugins. | evidence: repo_path:plugins/index.json
- OpenCode: Partial | Auth flows vary by provider; OpenCode ecosystem includes auth helpers.
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)

### Security & Ops

#### Crash report generator

Generates a structured crash report bundle for issue filing.

- Zee: Yes | `zee bug-report` | evidence: repo_path:packages/zee/src/cli/cmd/bug-report.ts

#### Health checks

Built-in diagnostics/doctor command for setup and runtime health.

- Zee: Yes | `zee check` | evidence: repo_path:packages/zee/src/cli/cmd/check.ts
- OpenClaw: Yes | `openclaw doctor` | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Partial | Monorepo has CI/test scripts; not a single end-user doctor flow.

#### systemd/launchd install

Installs a user service for always-on operation on supported platforms.

- Zee: Yes | Includes daemon install helpers and systemd scripts. | evidence: repo_path:scripts/systemd
- OpenClaw: Yes | Wizard installs launchd/systemd user service. | evidence: note:openclaw/openclaw README (main)

#### Upstream sync lanes (maintainers)

Maintainer tooling and docs for tracking upstream deltas across multiple repos.

- Zee: Yes | Tracks OpenCode/OpenClaw/Pi-mono upstream pins and port lanes. | evidence: repo_path:docs/architecture/upstream-differences.md

### Packaging

#### npm package

Published as an npm package.

- Zee: Yes | evidence: doc:README.md
- OpenCode: Yes | evidence: note:sst/opencode README (dev)
- OpenClaw: Yes | evidence: note:openclaw/openclaw README (main)
- Pi-mono: Yes | Multiple npm packages published from the monorepo. | evidence: note:badlogic/pi-mono README (main)

#### Prebuilt binaries

Ships prebuilt binaries (or installers) in addition to source install.

- Zee: Partial | Prebuilt Linux x64; other platforms build from source. | evidence: doc:README.md
- OpenCode: Yes | Install script + multiple package-manager distributions; desktop releases. | evidence: note:sst/opencode README (dev)
- OpenClaw: Partial | Primary distribution is npm + optional Docker/Nix; companion apps distributed separately. | evidence: note:openclaw/openclaw README (main)
