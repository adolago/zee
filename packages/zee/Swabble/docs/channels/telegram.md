---
summary: "Telegram channel plugin: setup, policy, and operations"
read_when:
  - You want to run Zee on Telegram
  - You need Telegram DM/group policy guidance
---
# Telegram

Telegram support is provided by the bundled `@zee/telegram` channel plugin.

## Quick setup

```bash
zee channels add --channel telegram --botToken <TOKEN> --audience <chat_id>
zee channels status
```

Minimal config:

```json5
{
  channels: {
    telegram: {
      botToken: "<token>",
      defaultTarget: "-1001234567890",
      dmPolicy: "pairing",
      allowFrom: []
    }
  }
}
```

## Security policy

- DM access is controlled by `channels.telegram.dmPolicy` + `channels.telegram.allowFrom`.
- `open` requires `allowFrom` to include `"*"`.
- Group behavior is controlled by `channels.telegram.groupPolicy` and `channels.telegram.requireMention`.
- Safer defaults: `dmPolicy="pairing"`, `groupPolicy="allowlist"`, `requireMention=true`.

Approve pairing requests:

```bash
zee pairing list telegram
zee pairing approve telegram <code>
```

## Status and health

Use:

```bash
zee channels status --channel telegram
zee security audit
zee doctor
```

These commands surface token/config issues, DM policy mistakes, and risky group policy combinations.
