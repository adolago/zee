---
summary: "CLI reference for `zee voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
---

# `zee voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:
- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
zee voicecall status --call-id <id>
zee voicecall call --to "+15555550123" --message "Hello" --mode notify
zee voicecall continue --call-id <id> --message "Any questions?"
zee voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
zee voicecall expose --mode serve
zee voicecall expose --mode funnel
zee voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.

