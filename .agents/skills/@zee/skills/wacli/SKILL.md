---
name: wacli
description: Send WhatsApp messages, voice notes, and files, or search/sync WhatsApp history via the wacli CLI (not for normal user chats).
homepage: https://wacli.sh
metadata: {"clawdbot":{"emoji":"📱","requires":{"bins":["wacli"]},"install":[{"id":"brew","kind":"brew","formula":"steipete/tap/wacli","bins":["wacli"],"label":"Install wacli (brew)"},{"id":"go","kind":"go","module":"github.com/steipete/wacli/cmd/wacli@latest","bins":["wacli"],"label":"Install wacli (go)"}]}}
---

# wacli

Use `wacli` only when the user explicitly asks you to message someone else on WhatsApp or when they ask to sync/search WhatsApp history.
Do NOT use `wacli` for normal user chats; Clawdbot routes WhatsApp conversations automatically.
If the user is chatting with you on WhatsApp, you should not reach for this tool unless they ask you to contact a third party.

Safety
- Require explicit recipient + message text.
- Confirm recipient + message before sending.
- If anything is ambiguous, ask a clarifying question.

## IMPORTANT: Use JID format, not phone numbers

Always use JID format for the `--to` flag. Phone number format (`+43...`) causes slow user lookup timeouts.

- Direct chats: `<number>@s.whatsapp.net` (e.g. `436649137379@s.whatsapp.net`)
- Groups: `<id>@g.us` (use `wacli chats list` to find)
- To find a JID: `wacli contacts search "name or number"`

## Auth + sync
- `wacli auth` (QR login + initial sync)
- `wacli sync --follow` (continuous sync)
- `wacli sync --once` (connect, sync, exit)
- `wacli doctor` (check auth/connection/FTS5 status)

## Find chats + messages
- `wacli chats list --limit 20 --query "name or number"`
- `wacli contacts search "name or number"`
- `wacli messages search "query" --limit 20 --chat <jid>`
- `wacli messages search "invoice" --after 2025-01-01 --before 2025-12-31`

## History backfill
- `wacli history backfill --chat <jid> --requests 2 --count 50`

## Send text
- `wacli send text --to "436649137379@s.whatsapp.net" --message "Hello!"`
- Group: `wacli send text --to "1234567890-123456789@g.us" --message "Running 5 min late."`

## Send files
- `wacli send file --to "436649137379@s.whatsapp.net" --file /path/agenda.pdf --caption "Agenda"`

## Send voice notes (TTS)

This is the ONLY way to send WhatsApp voice notes. Do NOT use the Zee gateway, Baileys, or any other method.

1. Generate audio with `zee-tts`:
   ```bash
   AUDIO_FILE=$(~/.local/bin/zee-tts --file "your message here")
   ```
2. Send as native voice note with `--ptt`:
   ```bash
   wacli send file --to "<jid>" --file "$AUDIO_FILE" --ptt
   ```

One-liner:
```bash
wacli send file --to "436649137379@s.whatsapp.net" --file "$(~/.local/bin/zee-tts --file "hello world")" --ptt
```

### zee-tts reference
- Location: `~/.local/bin/zee-tts`
- API: MiniMax TTS (key in `~/.local/share/zee/auth.json`)
- Default voice: `Calm_Woman`, model: `speech-2.8-hd`
- `zee-tts "text"` -- returns audio URL (24h expiry)
- `zee-tts --file "text"` -- downloads MP3 to `/tmp/`, returns path
- `zee-tts --voice Deep_Voice_Man --file "text"` -- custom voice
- `zee-tts --model speech-2.8-turbo --file "text"` -- faster model

### The --ptt flag
The `--ptt` flag is a local patch (source at `/tmp/wacli-patch/`). It sets `PTT: true` on the WhatsApp AudioMessage proto, which makes the audio render as a native voice note bubble instead of a file attachment. If wacli is reinstalled from upstream, rebuild from `/tmp/wacli-patch/`:
```bash
cd /tmp/wacli-patch && CGO_CFLAGS="-DSQLITE_ENABLE_FTS5" CGO_LDFLAGS="-lm" go build -o ~/go/bin/wacli ./cmd/wacli/
```

## Known contacts
- Artur: `436649137379@s.whatsapp.net`
- Zee (bot, do not message self): `4367763605924@s.whatsapp.net`

## Notes
- Binary: `~/go/bin/wacli` (patched with --ptt support)
- Store dir: `~/.wacli` (override with `--store`).
- Use `--json` for machine-readable output when parsing.
- Backfill requires your phone online; results are best-effort.
- wacli uses a file lock -- cannot send while `wacli sync --follow` is running.
