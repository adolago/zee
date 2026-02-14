---
summary: "Channel-specific troubleshooting shortcuts (WhatsApp)"
read_when:
  - A channel connects but messages don’t flow
  - Investigating channel misconfiguration (intents, permissions, privacy mode)
---
# Channel troubleshooting

Start with:

```bash
zee doctor
zee channels status --probe
```

`channels status --probe` prints warnings when it can detect common channel misconfigurations, and includes small live checks (credentials, some permissions/membership).

## Channels
- WhatsApp: [/channels/whatsapp](/channels/whatsapp)

## WhatsApp quick fixes

- `channels status --probe` shows WhatsApp not configured: check your `channels.whatsapp` account config and `channels.whatsapp.accessToken` (or `{env:WHATSAPP_ACCESS_TOKEN}` in config).
- Messages send but you see access errors: confirm credentials are valid and that the target chat/account is reachable.
- DMs are blocked: check `channels.whatsapp.dmPolicy` and `channels.whatsapp.allowFrom`.
