---
summary: "Top-level overview of Zee, features, and purpose"
read_when:
  - Introducing Zee to newcomers
---
# Zee

<p align="center">
</p>

<p align="center">
  Send a message, get an agent response.
</p>

<p align="center">
  <a href="/">Docs</a> ·
  <a href="/start/zee">Zee assistant setup</a>
</p>

Zee bridges WhatsApp (via WhatsApp Web / Baileys), WhatsApp (via whatsapp-bot-sdk),
agents like Pi.

## Start here

- **New install from zero:** [Getting Started](/start/getting-started)
- **Guided setup (recommended):** [Wizard](/start/wizard) (`zee onboard`)
- **Start the Gateway:** `zee gateway`

## How it works

```
        │
        ▼
  ┌───────────────────────────┐
  │        Zee Gateway        │  ws://127.0.0.1:18789 (loopback-only)
  │     (single source)       │
  │                           │  http://<gateway-host>:18793
  │                           │    /__zee__/canvas/ (Canvas host)
  └───────────┬───────────────┘
              │
              ├─ Pi agent (RPC)
              ├─ CLI (zee …)
              └─ External node hosts (headless) via Gateway WS
```

Most operations flow through the **Zee Gateway** (`zee gateway`), a single long-running process that owns channel connections and the WebSocket control plane.

## Network model

- **One Zee Gateway per host (recommended)**: it is the only process allowed to own the WhatsApp Web session. If you need a rescue bot or strict isolation, run multiple gateways with isolated profiles and ports; see [Multiple gateways](/gateway/multiple-gateways).
- **Loopback-first**: Gateway WS defaults to `ws://127.0.0.1:18789`.
  - The wizard now generates a gateway token by default (even for loopback).
  - For Tailnet access, run `zee gateway --bind tailnet --token ...` (token is required for non-loopback binds).
- **Nodes**: connect to the Gateway WebSocket (LAN/tailnet/SSH as needed); legacy TCP bridge is deprecated/removed.
- **Canvas host**: HTTP file server on `canvasHost.port` (default `18793`), serving `/__zee__/canvas/` for node WebViews; see [Gateway configuration](/gateway/configuration) (`canvasHost`).
- **Remote use**: SSH tunnel or tailnet/VPN; see [Remote access](/gateway/remote) and [Discovery](/gateway/discovery).

## Features (high level)

- **WhatsApp Integration** — Uses Baileys for WhatsApp Web protocol
- **WhatsApp** — DMs + rooms via the WhatsApp channel plugin
- **Agent bridge** — Pi (RPC mode) with tool streaming
- **Streaming + chunking** — Block streaming + per-channel chunking details ([/concepts/streaming](/concepts/streaming))
- **Multi-agent routing** — Route provider accounts/peers to isolated agents (workspace + per-agent sessions)
- **Subscription auth** — Anthropic (Claude Pro/Max) + OpenAI (ChatGPT/Codex) via OAuth
- **Sessions** — Direct chats collapse into shared `main` (default); groups are isolated
- **Group Chat Support** — Mention-based by default; owner can toggle `/activation always|mention`
- **Media Support** — Send and receive images, audio, documents
- **Voice notes** — Optional transcription hook
- **Node hosts (external)** — headless node hosts pair via Gateway WS (not shipped in this repo)

Note: legacy Claude/Codex/Gemini/Opencode paths have been removed; Pi is the only coding-agent path.

## Quick start

Runtime requirement: **Node ≥ 22**.

```bash
# Recommended: global install (npm/pnpm)
npm install -g zee@latest
# or: pnpm add -g zee@latest

# Onboard + install the service (systemd user service)
zee onboard --install-daemon

# Pair WhatsApp Web (shows QR)
zee channels login

# Gateway runs via the service after onboarding; manual run is still possible:
zee gateway --port 18789
```

Switching between npm and git installs later is easy: install the other flavor and run `zee doctor` to update the gateway service entrypoint.

From source (development):

```bash
git clone https://github.com/zee/zee.git
cd zee
pnpm install
pnpm build
zee onboard --install-daemon
```

If you don’t have a global install yet, run the onboarding step via `pnpm zee ...` from the repo.

Multi-instance quickstart (optional):

```bash
ZEE_CONFIG_PATH=~/.zee/a.json \
ZEE_STATE_DIR=~/.zee-a \
zee gateway --port 19001
```

Send a test message (requires a running Gateway):

```bash
zee message send --target +15555550123 --message "Hello from Zee"
```

## Configuration (optional)

Config lives at `~/.zee/zee.json`.

- If you **do nothing**, Zee uses the bundled Pi binary in RPC mode with per-sender sessions.
- If you want to lock it down, start with `channels.whatsapp.allowFrom` and (for groups) mention rules.

Example:

```json5
{
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } }
    }
  },
  messages: { groupChat: { mentionPatterns: ["@zee"] } }
}
```

## Docs

- Start here:
  - [Docs hubs (all pages linked)](/start/hubs)
  - [Help](/help) ← *common fixes + troubleshooting*
  - [Configuration](/gateway/configuration)
  - [Configuration examples](/gateway/configuration-examples)
  - [Slash commands](/tools/slash-commands)
  - [Multi-agent routing](/concepts/multi-agent)
  - [Updating / rollback](/install/updating)
  - [Pairing (DM + nodes)](/start/pairing)
  - [Nix mode](/install/nix)
  - [Zee assistant setup (Zee)](/start/zee)
  - [Skills](/tools/skills)
  - [Skills config](/tools/skills-config)
  - [Workspace templates](/reference/templates/AGENTS)
  - [RPC adapters](/reference/rpc)
  - [Gateway runbook](/gateway)
  - [Nodes](/nodes)
  - [Discovery + transports](/gateway/discovery)
  - [Remote access](/gateway/remote)
- Providers and UX:
  - [WhatsApp](/channels/whatsapp)
  - [WhatsApp](/channels/whatsapp)
  - [Groups](/concepts/groups)
  - [WhatsApp group messages](/concepts/group-messages)
- Host environments:
  - [Windows (WSL2)](/platforms/windows)
  - [Linux host](/platforms/linux)
- Ops and safety:
  - [Sessions](/concepts/session)
  - [Cron jobs](/automation/cron-jobs)
  - [Webhooks](/automation/webhook)
  - [Gmail hooks (Pub/Sub)](/automation/gmail-pubsub)
  - [Security](/gateway/security)
  - [Troubleshooting](/gateway/troubleshooting)

## Credits

- **Peter Steinberger** ([@steipete](https://twitter.com/steipete)) — Creator, lobster whisperer
- **Mario Zechner** ([@badlogicc](https://twitter.com/badlogicgames)) — Pi creator, security pen-tester
- **Zee** — The space lobster who demanded a better name

## Core Contributors

- **Maxim Vovshin** (@Hyaxia, 36747317+Hyaxia@users.noreply.github.com) — Blogwatcher skill
- **Nacho Iacovino** (@nachoiacovino, nacho.iacovino@gmail.com) — Location parsing (WhatsApp + WhatsApp)

## License

MIT — Free as a lobster in the ocean

---

*"We're all just playing with our own prompts."* — An AI, probably high on tokens
