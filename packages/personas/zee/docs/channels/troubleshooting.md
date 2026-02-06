---
summary: "Channel-specific troubleshooting shortcuts (Matrix/WhatsApp)"
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
- Matrix: [/channels/matrix](/channels/matrix)
- WhatsApp: [/channels/whatsapp#troubleshooting-quick](/channels/whatsapp#troubleshooting-quick)

## Matrix quick fixes

- `channels status --probe` shows Matrix not configured: check `channels.matrix.homeserver`, `channels.matrix.userId`, and `MATRIX_ACCESS_TOKEN` (or `channels.matrix.accessToken`).
- Messages send but you see access errors: confirm the token matches the configured `userId` and that the user is joined to the target room.
- DMs are blocked: check `channels.matrix.dmPolicy` and `channels.matrix.allowFrom`.
