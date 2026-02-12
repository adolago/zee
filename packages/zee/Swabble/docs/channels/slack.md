---
summary: "Slack channel plugin: setup, policy, and operations"
read_when:
  - You want to run Zee on Slack
  - You need Slack DM/group policy guidance
---
# Slack

Slack support is provided by the bundled `@zee/slack` channel plugin.

## Quick setup

```bash
zee channels add --channel slack --botToken <TOKEN> --audience <channel_id>
zee channels status
```

Minimal config:

```json5
{
  channels: {
    slack: {
      botToken: "xoxb-...",
      defaultChannel: "C0123456789",
      dmPolicy: "pairing",
      allowFrom: []
    }
  }
}
```

## Security policy

- DM access is controlled by `channels.slack.dmPolicy` + `channels.slack.allowFrom`.
- `open` requires `allowFrom` to include `"*"`.
- Channel/group behavior is controlled by `channels.slack.groupPolicy` and `channels.slack.requireMention`.
- Safer defaults: `dmPolicy="pairing"`, `groupPolicy="allowlist"`, `requireMention=true`.

Approve pairing requests:

```bash
zee pairing list slack
zee pairing approve slack <code>
```

## Status and health

Use:

```bash
zee channels status --channel slack
zee security audit
zee doctor
```

These commands surface token/config issues, DM policy mistakes, and risky group policy combinations.
