---
summary: "Messaging platforms Zee can connect to"
read_when:
  - You want to choose a chat channel for Zee
  - You need a quick overview of supported messaging platforms
---
# Chat Channels

Zee can run multiple channels at the same time via the Gateway.

## First-party channels

- [WhatsApp](/channels/whatsapp) - QR-linked WhatsApp Web runtime.
- [Telegram](/channels/telegram) - Telegram Bot API token + target routing.
- [Slack](/channels/slack) - Slack bot token + channel routing.
- [Discord](/channels/discord) - Discord bot token + channel routing.

## Security defaults

- DM access defaults to pairing-style controls.
- `dmPolicy="open"` requires `allowFrom=["*"]`.
- Group access should normally stay `groupPolicy="allowlist"` with mention gating enabled.
- Review warnings with `zee security audit` and `zee doctor`.

## Operational commands

```bash
zee channels list
zee channels status
zee security audit
zee doctor
```

See [Channel troubleshooting](/channels/troubleshooting) for runtime and auth debugging.
