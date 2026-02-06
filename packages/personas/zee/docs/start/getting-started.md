---
summary: "Beginner guide: from zero to first message (wizard, auth, channels, pairing)"
read_when:
  - First time setup from zero
  - You want the fastest path from install → onboarding → first message
---

# Getting Started

Goal: go from **zero** → **first working chat** (with sane defaults) as quickly as possible.

Fastest chat: run the **CLI onboarding wizard** (`zee onboard`) and connect a
WhatsApp or Matrix channel. It sets up:
- model/auth (OAuth recommended)
- gateway settings
- pairing defaults (secure DMs)
- workspace bootstrap + skills
- optional background service

If you want the deeper reference pages, jump to: [Wizard](/start/wizard), [Setup](/start/setup), [Pairing](/start/pairing), [Security](/gateway/security).

Sandboxing note: `agents.defaults.sandbox.mode: "non-main"` uses `session.mainKey` (default `"main"`),
so group/channel sessions are sandboxed. If you want the main agent to always
run on host, set an explicit per-agent override:

```json
{
  "routing": {
    "agents": {
      "main": {
        "workspace": "~/zee",
        "sandbox": { "mode": "off" }
      }
    }
  }
}
```

## 0) Prereqs

- Node `>=22`
- `pnpm` (optional; recommended if you build from source)
- **Recommended:** Brave Search API key for web search. Easiest path:
  `zee configure --section web` (stores `tools.web.search.apiKey`).
  See [Web tools](/tools/web).

Windows: use **WSL2** (Ubuntu recommended). WSL2 is strongly recommended; native Windows is untested, more problematic, and has poorer tool compatibility. Install WSL2 first, then run the Linux steps inside WSL. See [Windows (WSL2)](/platforms/windows).

## 1) Install the CLI (recommended)

```bash
curl -fsSL https://docs.zee/install.sh | bash
```

Installer options (install method, non-interactive, from GitHub): [Install](/install).

Windows (PowerShell):

```powershell
iwr -useb https://docs.zee/install.ps1 | iex
```

Alternative (global install):

```bash
npm install -g zee@latest
```

```bash
pnpm add -g zee@latest
```

## 2) Run the onboarding wizard (and install the service)

```bash
zee onboard --install-daemon
```

What you’ll choose:
- **Local vs Remote** gateway
- **Auth**: OpenAI Code (Codex) subscription (OAuth) or API keys. For Anthropic we recommend an API key; `claude setup-token` is also supported.
- **Daemon**: background install (systemd; WSL2 uses systemd)
  - **Runtime**: Node (recommended; required for WhatsApp/Matrix). Bun is **not recommended**.
- **Gateway token**: the wizard generates one by default (even on loopback) and stores it in `gateway.auth.token`.

Wizard doc: [Wizard](/start/wizard)

### Auth: where it lives (important)

- **Recommended Anthropic path:** set an API key (wizard can store it for service use). `claude setup-token` is also supported if you want to reuse Claude Code credentials.

- OAuth credentials (legacy import): `~/.zee/credentials/oauth.json`
- Auth profiles (OAuth + API keys): `~/.zee/agents/<agentId>/agent/auth-profiles.json`

Headless/server tip: do OAuth on a normal machine first, then copy `oauth.json` to the gateway host.

## 3) Start the Gateway

If you installed the service during onboarding, the Gateway should already be running:

```bash
zee gateway status
```

Manual run (foreground):

```bash
zee gateway --port 18789 --verbose
```

Warning (WhatsApp + Matrix): Bun has known issues with these
channels. If you use WhatsApp or Matrix, run the Gateway with **Node**.

## 3.5) Quick verify (2 min)

```bash
zee status
zee health
zee security audit --deep
```

## 4) Pair + connect your first chat surface

### WhatsApp (QR login)

```bash
zee channels login
```

Scan via WhatsApp → Settings → Linked Devices.

WhatsApp doc: [WhatsApp](/channels/whatsapp)


The wizard can write tokens/config for you. If you prefer manual config, start with:
- Matrix: [Matrix](/channels/matrix)

Matrix DM tip: your first DM may require pairing approval (see next step) or the bot won’t respond.

## 5) DM safety (pairing approvals)

Default posture: unknown DMs get a short code and messages are not processed until approved.
If your first DM gets no reply, approve the pairing:

```bash
zee pairing list whatsapp
zee pairing approve whatsapp <code>
```

Pairing doc: [Pairing](/start/pairing)

## From source (development)

If you’re hacking on Zee itself, run from source:

```bash
git clone https://github.com/zee/zee.git
cd zee
pnpm install
pnpm build
zee onboard --install-daemon
```

If you don’t have a global install yet, run the onboarding step via `pnpm zee ...` from the repo.
`pnpm build` also bundles A2UI assets; if you need to run just that step, use `pnpm canvas:a2ui:bundle`.

Gateway (from this repo):

```bash
node zee.mjs gateway --port 18789 --verbose
```

## 7) Verify end-to-end

In a new terminal, send a test message:

```bash
zee message send --target +15555550123 --message "Hello from Zee"
```

If `zee health` shows “no auth configured”, go back to the wizard and set OAuth/key auth — the agent won’t be able to respond without it.

Tip: `zee status --all` is the best pasteable, read-only debug report.
Health probes: `zee health` (or `zee status --deep`) asks the running gateway for a health snapshot.

## Next steps (optional, but great)

- Headless node hosts for remote exec: [Nodes](/nodes)
- Remote access (SSH tunnel / Tailscale Serve): [Remote access](/gateway/remote) and [Tailscale](/gateway/tailscale)
- Always-on / VPN setups: [Remote access](/gateway/remote), [exe.dev](/platforms/exe-dev), [Hetzner](/platforms/hetzner)
