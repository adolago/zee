---
summary: "End-to-end guide for running Zee as a personal assistant with safety cautions"
read_when:
  - Onboarding a new assistant instance
  - Reviewing safety/permission implications
---
# Building a personal assistant with Zee

agents. This guide covers the personal assistant setup: one dedicated WhatsApp
number that behaves like your always-on agent.

## Safety first

You are putting an agent in a position to:
- run commands on your machine (depending on your Pi tool setup)
- read/write files in your workspace
- send messages back out via messaging channels

Start conservative:
- Always set `channels.whatsapp.allowFrom` (never run open-to-the-world on your personal machine).
- Use a dedicated WhatsApp number for the assistant.
- Heartbeats default to every 30 minutes. Disable until you trust the setup by setting `agents.defaults.heartbeat.every: "0m"`.

## Prerequisites

- Node 22+
- Zee available on PATH (recommended: global install)
- A second phone number (SIM/eSIM/prepaid) for the assistant

```bash
npm install -g zee@latest
# or: pnpm add -g zee@latest
```

From source (development):

```bash
pnpm install
pnpm build
pnpm link --global
```

## The two-phone setup (recommended)

You want this:

```
Your Phone (personal)          Second Phone (assistant)
┌─────────────────┐           ┌─────────────────┐
│  Your WhatsApp  │  ──────▶  │  Assistant WA   │
│  +1-555-YOU     │  message  │  +1-555-ZEE     │
└─────────────────┘           └────────┬────────┘
                                       │ linked via QR
                                       ▼
                              ┌─────────────────┐
                              │  Your Host      │
                              │   (zee)         │
                              │    Pi agent     │
                              └─────────────────┘
```

If you link your personal WhatsApp to Zee, every message to you becomes agent
input. That is rarely what you want.

## 5-minute quick start

1) Pair WhatsApp Web (shows QR; scan with the assistant phone):

```bash
zee channels login
```

2) Start the Gateway (leave it running):

```bash
zee gateway --port 18789
```

3) Put a minimal config in `~/.zee/zee.json`:

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "allowFrom": ["+15550000000"]
    }
  }
}
```
