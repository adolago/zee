---
summary: "CLI reference for `zee channels` (accounts, status, login/logout, logs)"
read_when:
  - You want to check channel status or tail channel logs
---

# `zee channels`

Manage chat channel accounts and their runtime status on the Gateway.

Related docs:
- Channel guides: [Channels](/channels/index)
- Gateway configuration: [Configuration](/gateway/configuration)

## Common commands

```bash
zee channels list
zee channels status
zee channels capabilities
zee channels logs --channel all
```

## Add / remove accounts

```bash
zee channels add --channel whatsapp
zee channels add --channel telegram --botToken <token> --audience <chat_id>
zee channels add --channel slack --botToken <token> --audience <channel_id>
zee channels add --channel discord --botToken <token> --audience <channel_id>
zee channels remove --channel whatsapp --delete
```


## Login / logout (interactive)

```bash
zee channels login --channel whatsapp
zee channels logout --channel whatsapp
```

Token-based channels (Telegram/Slack/Discord) are configured with `channels add` and usually do not require a separate login flow.

For Slack/Discord native action packs, review and tune `channels.<provider>.actions.*` so message actions stay least-privilege.

## Troubleshooting

- Run `zee status --deep` for a broad probe.
- Use `zee doctor` for guided fixes.
- `zee channels list` prints `Claude: HTTP 403 ... user:profile` → usage snapshot needs the `user:profile` scope. Use `--no-usage`, or provide a claude.ai session key (`CLAUDE_WEB_SESSION_KEY` / `CLAUDE_WEB_COOKIE`), or re-auth via Claude Code CLI.

## Capabilities probe

Fetch provider capability hints (intents/scopes where available) plus static feature support:

```bash
zee channels capabilities
```

Notes:
- `--channel` is optional; omit it to list every channel (including extensions).

## Resolve names to IDs

Resolve channel/user names to IDs using the provider directory:

```bash
zee channels resolve --channel whatsapp "Project Room"
```

Notes:
- Use `--kind user|group|auto` to force the target type.
- Resolution prefers active matches when multiple entries share the same name.
