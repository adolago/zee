---
summary: "CLI reference for `zee message` (send + channel actions)"
read_when:
  - Adding or modifying message CLI actions
  - Changing outbound channel behavior
---

# `zee message`

Single outbound command for sending messages and channel actions

## Usage

```
zee message <subcommand> [flags]
```

Channel selection:
- `--channel` required if more than one channel is configured.
- If exactly one channel is configured, it becomes the default.

Target formats (`--target`):
- WhatsApp: E.164 or group JID
- WhatsApp: `@user:server` or `!roomId:server`

Name lookup:
- On cache miss, Zee will attempt a live directory lookup when the provider supports it.

## Common flags

- `--channel <name>`
- `--account <id>`
- `--target <dest>` (target channel or user for send/poll/read/etc)
- `--targets <name>` (repeat; broadcast only)
- `--json`
- `--dry-run`
- `--verbose`

## Actions

### Core

- `send`
  - Required: `--target`, plus `--message` or `--media`
  - Optional: `--media`, `--reply-to`, `--thread-id`, `--gif-playback`
  - WhatsApp only: `--gif-playback`

- `poll`
  - Required: `--target`, `--poll-question`, `--poll-option` (repeat)
  - Optional: `--poll-multi`

- `react`
  - Required: `--message-id`, `--target`
  - Optional: `--emoji`, `--remove`, `--participant`, `--from-me`, `--target-author`, `--target-author-uuid`
  - Note: `--remove` requires `--emoji` (omit `--emoji` to clear own reactions where supported; see /tools/reactions)
  - WhatsApp only: `--participant`, `--from-me`

- `reactions`
  - Required: `--message-id`, `--target`
  - Optional: `--limit`

- `read`
  - Required: `--target`
  - Optional: `--limit`, `--before`, `--after`

- `edit`
  - Required: `--message-id`, `--message`, `--target`

- `delete`
  - Required: `--message-id`, `--target`

- `pin` / `unpin`
  - Required: `--message-id`, `--target`

- `pins` (list)
  - Required: `--target`

- `permissions`
  - Required: `--target`

- `search`
  - Required: `--guild-id`, `--query`
  - Optional: `--channel-id`, `--channel-ids` (repeat), `--author-id`, `--author-ids` (repeat), `--limit`

### Threads

- `thread create`
  - Required: `--thread-name`, `--target` (channel id)
  - Optional: `--message-id`, `--auto-archive-min`

- `thread list`
  - Required: `--guild-id`
  - Optional: `--channel-id`, `--include-archived`, `--before`, `--limit`

- `thread reply`
  - Required: `--target` (thread id), `--message`
  - Optional: `--media`, `--reply-to`

### Emojis

- `emoji list`

- `emoji upload`
  - Required: `--guild-id`, `--emoji-name`, `--media`
  - Optional: `--role-ids` (repeat)

### Stickers

- `sticker send`
  - Required: `--target`, `--sticker-id` (repeat)
  - Optional: `--message`

- `sticker upload`
  - Required: `--guild-id`, `--sticker-name`, `--sticker-desc`, `--sticker-tags`, `--media`

### Roles / Channels / Members / Voice


### Events

  - Optional: `--end-time`, `--desc`, `--channel-id`, `--location`, `--event-type`


- `timeout`: `--guild-id`, `--user-id` (optional `--duration-min` or `--until`; omit both to clear timeout)
- `kick`: `--guild-id`, `--user-id` (+ `--reason`)
- `ban`: `--guild-id`, `--user-id` (+ `--delete-days`, `--reason`)
  - `timeout` also supports `--reason`

### Broadcast

- `broadcast`
  - Channels: any configured channel; use `--channel all` to target all providers
  - Required: `--targets` (repeat)
  - Optional: `--message`, `--media`, `--dry-run`

## Examples

```
  --target channel:123 --message "hi" --reply-to 456
```

```
  --target channel:123 \
  --poll-question "Snack?" \
  --poll-option Pizza --poll-option Sushi \
  --poll-multi --poll-duration-hours 48
```

Send a WhatsApp message:
```
zee message send --channel whatsapp \
  --target "!room:example.com" --message "hi"
```

Create a poll:
```
zee message poll --channel whatsapp \
  --target "!room:example.com" \
  --poll-question "Lunch?" \
  --poll-option Pizza --poll-option Sushi
```

```
  --target C123 --message-id 456 --emoji ":check:"
```

```
  --emoji ":check:" --target-author-uuid 123e4567-e89b-12d3-a456-426614174000
```
