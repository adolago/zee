# Zee — Personal AI Assistant

<p align="center">
  <img src="README-header.png" alt="Zee" width="600">
</p>

**Zee** is a personal AI assistant you run on your own devices.
It answers on the channels you already use (WhatsApp).
The Zee Gateway is the control plane for sessions, channels, tools, and events.

If you want a single-user assistant that feels local, fast, and always-on, this is it.

- Docs: `packages/personas/zee/docs` (Mintlify config)
- Upstream policy: `docs/UPSTREAM_POLICY.md`

## Quick start

Runtime: **Node ≥22**.

```bash
npm install -g zee@latest
# or: pnpm add -g zee@latest

zee onboard --install-daemon
zee gateway --port 18789 --verbose

# Send a message
zee message send --to +1234567890 --message "Hello from Zee"

# Talk to the assistant
zee agent --message "Ship checklist" --thinking high
```

Notes:
- The onboarding wizard is the recommended path and works on **Linux and Windows (via WSL2)**.
- Native apps are not shipped in this repo.

## Development

```bash
git clone <your-fork>
cd packages/personas/zee

pnpm install
pnpm build

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

## Security defaults (DM access)

Zee connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Default behavior on WhatsApp:
- **DM pairing** (`dmPolicy="pairing"`): unknown senders receive a short pairing code and the bot does not process their message.
- Approve with: `zee pairing approve <channel> <code>` (then the sender is added to a local allowlist store).
- Public inbound DMs require an explicit opt-in: set `dmPolicy="open"` and include `"*"` in the channel allowlist (`allowFrom`).

## Highlights

- **Zee Gateway** — single control plane for sessions, channels, tools, and events.
- **Messaging inbox** — WhatsApp.
- **Multi-agent routing** — route inbound channels/accounts/peers to isolated agents (workspaces + per-agent sessions).
- **Live Canvas** — agent-driven visual workspace with A2UI.
- **First-class tools** — browser, canvas, nodes, cron, and sessions.

## How it works (short)

```
WhatsApp
               │
               ▼
┌───────────────────────────────┐
│         Zee Gateway           │
│       (control plane)         │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi agent (RPC)
               ├─ CLI (zee …)
               └─ TUI
```

## Remote Gateway

It is fine to run the Gateway on a small Linux instance. Clients (CLI/TUI) can connect over **Tailscale Serve/Funnel** or **SSH tunnels**, and you can still pair headless node hosts to execute remote `system.run` actions when needed.

- **Gateway host** runs the exec tool and channel connections by default.
- **Node hosts** run `system.run` on the node machine via `node.invoke`.
In short: exec runs where the Gateway lives unless you explicitly target a node host.
