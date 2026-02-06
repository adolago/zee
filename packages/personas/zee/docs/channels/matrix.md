---
summary: "Matrix channel setup (homeserver + access token)"
read_when:
  - You want to talk to Zee over Matrix
  - You need to configure `channels.matrix`
---
# Matrix

Zee can connect to Matrix via the **Matrix channel plugin**.

## Configuration

Matrix configuration lives under `channels.matrix` in `~/.zee/zee.json`.

Minimal example:

```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.com",
      userId: "@zee:example.com",
      accessToken: "{env:MATRIX_ACCESS_TOKEN}",
      allowFrom: ["@you:example.com"]
    }
  }
}
```

Supported keys (common):

- `channels.matrix.enabled`: `true|false` (default: `true` when configured)
- `channels.matrix.homeserver`: Matrix homeserver base URL
- `channels.matrix.userId`: the bot/user ID for the access token
- `channels.matrix.accessToken`: access token (prefer env substitution)
- `channels.matrix.allowFrom`: allowlist entries for DMs (wildcard `"*"` supported if you want public inbound DMs)
- `channels.matrix.dmPolicy`: `"pairing"|"open"|"locked"` (default: `"pairing"`)
- `channels.matrix.encryption`: enable E2EE (default: `false`)
- `channels.matrix.threadReplies`: `"off"|"inbound"|"always"` (default: `"off"`)

## Environment variables

The Matrix plugin reads `MATRIX_ACCESS_TOKEN` when set.

## State

By default, Matrix state is stored under `~/.zee/matrix/`.

## Troubleshooting

Start with:

```bash
zee status --all
zee logs --follow
```

Then confirm:

- your `channels.matrix.homeserver` URL is correct
- your `channels.matrix.userId` matches the access token
- `MATRIX_ACCESS_TOKEN` is set (or `channels.matrix.accessToken` is configured)
