---
summary: "Discord channel plugin: setup, policy, and operations"
read_when:
  - You want to run Zee on Discord
  - You need Discord DM/group policy guidance
---
# Discord

Discord support is provided by the bundled `@zee/discord` channel plugin.

## Quick setup

```bash
zee channels add --channel discord --botToken <TOKEN> --audience <channel_id>
zee channels status
```

Minimal config:

```json5
{
  channels: {
    discord: {
      botToken: "<token>",
      defaultChannel: "123456789012345678",
      dmPolicy: "pairing",
      allowFrom: []
    }
  }
}
```

## Security policy

- DM access is controlled by `channels.discord.dmPolicy` + `channels.discord.allowFrom`.
- `open` requires `allowFrom` to include `"*"`.
- Channel/group behavior is controlled by `channels.discord.groupPolicy` and `channels.discord.requireMention`.
- Native action permissions are controlled by `channels.discord.actions` (`reactions`, `pins`, `channelInfo`).
- Safer defaults: `dmPolicy="pairing"`, `groupPolicy="allowlist"`, `requireMention=true`.

Approve pairing requests:

```bash
zee pairing list discord
zee pairing approve discord <code>
```

## Native actions

Supported action pack:
- `react`
- `pin` / `unpin`
- `channel-info`

Policy example:

```json5
{
  channels: {
    discord: {
      actions: {
        reactions: true,
        pins: true,
        channelInfo: true
      }
    }
  }
}
```

CLI examples:

```bash
zee message react --channel discord --target 123456789012345678 --message-id 998877665544332211 --emoji wave
zee message pin --channel discord --target 123456789012345678 --message-id 998877665544332211
zee message unpin --channel discord --target 123456789012345678 --message-id 998877665544332211
zee message channel-info --channel discord --target 123456789012345678
```

## Status and health

Use:

```bash
zee channels status --channel discord
zee security audit
zee doctor
```

These commands surface token/config issues, DM policy mistakes, risky group policy combinations, and over-broad action surfaces.
