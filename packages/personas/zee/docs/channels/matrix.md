---
summary: "Matrix support status, capabilities, and configuration"
read_when:
  - You want to talk to Zee over Matrix
  - You need to configure `channels.matrix`
title: "Matrix"
---

# Matrix (plugin)

Matrix is an open, decentralized messaging protocol. Zee connects as a Matrix user on any homeserver, so you need a Matrix account for the bot.

Status: supported via plugin (@vector-im/matrix-bot-sdk). Direct messages, rooms, threads, media, reactions, polls (send + poll-start as text), location, and E2EE (when crypto support is available).

## Setup

1. Create a Matrix account on a homeserver for the bot.
2. Get an access token:
   - Provide `channels.matrix.accessToken` (or `MATRIX_ACCESS_TOKEN`), and Zee will fetch `userId` via `/whoami`.
   - Or provide `channels.matrix.userId` + `channels.matrix.password` (or `MATRIX_USER_ID` + `MATRIX_PASSWORD`), and Zee will call the login API and cache the access token under `$ZEE_STATE_DIR/credentials/matrix/credentials.json`.
3. Configure `channels.matrix` in `~/.zee/zee.json`.
4. Restart the gateway.

Minimal config (access token; DM policy defaults to pairing):

```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.org",
      accessToken: "{env:MATRIX_ACCESS_TOKEN}",
      dm: { policy: "pairing" },
    },
  },
}
```

E2EE config (end to end encryption enabled):

```json5
{
  channels: {
    matrix: {
      enabled: true,
      homeserver: "https://matrix.example.org",
      accessToken: "{env:MATRIX_ACCESS_TOKEN}",
      encryption: true,
      dm: { policy: "pairing" },
    },
  },
}
```

## Access Control (DMs)

- Default: `channels.matrix.dm.policy = "pairing"`. Unknown senders get a pairing code.
- Approve via:
  - `zee pairing list matrix`
  - `zee pairing approve matrix <CODE>`
- Public DMs: `channels.matrix.dm.policy="open"` plus `channels.matrix.dm.allowFrom=["*"]`.
- Allowlisted DMs: `channels.matrix.dm.policy="allowlist"` plus `channels.matrix.dm.allowFrom=["@user:server"]`.

## Rooms (Groups)

- Default: `channels.matrix.groupPolicy = "allowlist"` (mention-gated). If unset, Zee falls back to `channels.defaults.groupPolicy`.
- Allowlist rooms with `channels.matrix.groups` (room IDs or aliases):

```json5
{
  channels: {
    matrix: {
      groupPolicy: "allowlist",
      groups: {
        "!roomId:example.org": { allow: true },
        "#alias:example.org": { allow: true },
      },
      groupAllowFrom: ["@owner:example.org"],
    },
  },
}
```

- `requireMention: false` enables auto-reply in that room.
- `groups."*"` can set defaults for mention gating across rooms.
- `groupAllowFrom` restricts which senders can trigger the bot in rooms.
- Per-room `users` allowlists can further restrict senders inside a specific room.
- Invites are auto-joined by default; control with `channels.matrix.autoJoin` and `channels.matrix.autoJoinAllowlist`.
- Legacy key: `channels.matrix.rooms` (same shape as `groups`).

## Environment Variables

The Matrix plugin supports:

- `MATRIX_HOMESERVER`
- `MATRIX_ACCESS_TOKEN`
- `MATRIX_USER_ID`
- `MATRIX_PASSWORD`
- `MATRIX_DEVICE_NAME`

Config takes precedence over environment variables.

## State

- Credentials cache: `$ZEE_STATE_DIR/credentials/matrix/credentials.json`
- Sync + crypto state: `$ZEE_STATE_DIR/matrix/accounts/<account>/<homeserver>__<user>/<token-hash>/`

## Legacy Config

These keys are auto-migrated by gateway start / `zee doctor`:

- `channels.matrix.dmPolicy` -> `channels.matrix.dm.policy`
- `channels.matrix.allowFrom` -> `channels.matrix.dm.allowFrom`

## Troubleshooting

Start with:

```bash
zee status --all
zee logs --follow
```

Then confirm:

- `channels.matrix.homeserver` is correct
- `channels.matrix.accessToken` is valid (or `channels.matrix.userId` + `channels.matrix.password`)
- `MATRIX_ACCESS_TOKEN` is set when using env substitution

