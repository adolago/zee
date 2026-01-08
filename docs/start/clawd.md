---
summary: "End-to-end guide for running Zee as a personal assistant with safety cautions"
read_when:
  - Onboarding a new assistant instance
  - Reviewing safety/permission implications
---
# Building a personal assistant with ZEE (Clawd-style)

ZEE is a WhatsApp + Telegram + Discord gateway for **Pi** agents. This guide is the “personal assistant” setup: one dedicated WhatsApp number that behaves like your always-on agent.

## ⚠️ Safety first

You’re putting an agent in a position to:
- run commands on your machine (depending on your Pi tool setup)
- read/write files in your workspace
- send messages back out via WhatsApp/Telegram/Discord

Start conservative:
- Always set `whatsapp.allowFrom` (never run open-to-the-world on your personal Mac).
- Use a dedicated WhatsApp number for the assistant.
- Heartbeats now default to every 30 minutes. Disable until you trust the setup by setting `agent.heartbeat.every: "0m"`.

## Prerequisites

- Node **22+**
- ZEE available on PATH (recommended: global install)
- A second phone number (SIM/eSIM/prepaid) for the assistant

```bash
npm install -g zee@latest
# or: pnpm add -g zee@latest
```

From source (development):

```bash
git clone https://github.com/zee/zee.git
cd zee
pnpm install
pnpm ui:install
pnpm ui:build
pnpm build
pnpm link --global
```

## The two-phone setup (recommended)

You want this:

```
Your Phone (personal)          Second Phone (assistant)
┌─────────────────┐           ┌─────────────────┐
│  Your WhatsApp  │  ──────▶  │  Assistant WA   │
│  +1-555-YOU     │  message  │  +1-555-CLAWD   │
└─────────────────┘           └────────┬────────┘
                                       │ linked via QR
                                       ▼
                              ┌─────────────────┐
                              │  Your Mac       │
                              │  (zee)      │
                              │    Pi agent     │
                              └─────────────────┘
```

If you link your personal WhatsApp to ZEE, every message to you becomes “agent input”. That’s rarely what you want.

## 5-minute quick start

1) Pair WhatsApp Web (shows QR; scan with the assistant phone):

```bash
zee providers login
```

2) Start the Gateway (leave it running):

```bash
zee gateway --port 18789
```

3) Put a minimal config in `~/.zee/zee.json`:

```json5
{
  whatsapp: {
    allowFrom: ["+15555550123"]
  }
}
```

Now message the assistant number from your allowlisted phone.

## Give the agent a workspace (AGENTS)

Clawd reads operating instructions and “memory” from its workspace directory.

By default, Zee uses `~/clawd` as the agent workspace, and will create it (plus starter `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`) automatically on setup/first agent run. `BOOTSTRAP.md` is only created when the workspace is brand new (it should not come back after you delete it).

Tip: treat this folder like Clawd’s “memory” and make it a git repo (ideally private) so your `AGENTS.md` + memory files are backed up.

```bash
zee setup
```

Full workspace layout + backup guide: [`docs/agent-workspace.md`](/concepts/agent-workspace)

Optional: choose a different workspace with `agent.workspace` (supports `~`).

```json5
{
  agent: {
    workspace: "~/clawd"
  }
}
```

If you already ship your own workspace files from a repo, you can disable bootstrap file creation entirely:

```json5
{
  agent: {
    skipBootstrap: true
  }
}
```

## The config that turns it into “an assistant”

ZEE defaults to a good assistant setup, but you’ll usually want to tune:
- persona/instructions in `SOUL.md`
- thinking defaults (if desired)
- heartbeats (once you trust it)

Example:

```json5
{
  logging: { level: "info" },
  agent: {
    model: "anthropic/claude-opus-4-5",
    workspace: "~/clawd",
    thinkingDefault: "high",
    timeoutSeconds: 1800,
    // Start with 0; enable later.
    heartbeat: { every: "0m" }
  },
  whatsapp: {
    allowFrom: ["+15555550123"],
    groups: {
      "*": { requireMention: true }
    }
  },
  routing: {
    groupChat: {
      mentionPatterns: ["@clawd", "clawd"]
    }
  },
  session: {
    scope: "per-sender",
    resetTriggers: ["/new", "/reset"],
    idleMinutes: 10080
  }
}
```

## Sessions and memory

- Session files: `~/.zee/agents/<agentId>/sessions/{{SessionId}}.jsonl`
- Session metadata (token usage, last route, etc): `~/.zee/agents/<agentId>/sessions/sessions.json` (legacy: `~/.zee/sessions/sessions.json`)
- `/new` or `/reset` starts a fresh session for that chat (configurable via `resetTriggers`). If sent alone, the agent replies with a short hello to confirm the reset.
- `/compact [instructions]` compacts the session context and reports the remaining context budget.

## Heartbeats (proactive mode)

By default, ZEE runs a heartbeat every 30 minutes with the prompt:
`Read HEARTBEAT.md if exists. Consider outstanding tasks. Checkup sometimes on your human during (user local) day time.`
Set `agent.heartbeat.every: "0m"` to disable.

- If the agent replies with `HEARTBEAT_OK` (optionally with short padding; see `agent.heartbeat.ackMaxChars`), ZEE suppresses outbound delivery for that heartbeat.
- Heartbeats run full agent turns — shorter intervals burn more tokens.

```json5
{
  agent: {
    heartbeat: { every: "30m" }
  }
}
```

## Media in and out

Inbound attachments (images/audio/docs) can be surfaced to your command via templates:
- `{{MediaPath}}` (local temp file path)
- `{{MediaUrl}}` (pseudo-URL)
- `{{Transcript}}` (if audio transcription is enabled)

Outbound attachments from the agent: include `MEDIA:<path-or-url>` on its own line (no spaces). Example:

```
Here’s the screenshot.
MEDIA:/tmp/screenshot.png
```

ZEE extracts these and sends them as media alongside the text.

## Operations checklist

```bash
zee status          # local status (creds, sessions, queued events)
zee status --deep   # also probes the running Gateway (WA connect + Telegram)
zee health --json   # gateway health snapshot (WS)
```

Logs live under `/tmp/zee/` (default: `zee-YYYY-MM-DD.log`).

## Next steps

- WebChat: [WebChat](/web/webchat)
- Gateway ops: [Gateway runbook](/gateway)
- Cron + wakeups: [Cron jobs](/automation/cron-jobs)
- macOS menu bar companion: [Zee macOS app](/platforms/macos)
- iOS node app: [iOS app](/platforms/ios)
- Android node app: [Android app](/platforms/android)
- Windows status: [Windows (WSL2)](/platforms/windows)
- Linux status: [Linux app](/platforms/linux)
- Security: [Security](/gateway/security)
