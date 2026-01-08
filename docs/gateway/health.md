---
summary: "Health check steps for Baileys/WhatsApp connectivity"
read_when:
  - Diagnosing web provider health
---
# Health Checks (CLI)

Short guide to verify the WhatsApp Web / Baileys stack without guessing.

## Quick checks
- `zee status` — local summary: whether creds exist, auth age, session store path + recent sessions.
- `zee status --deep` — also probes the running Gateway (WhatsApp connect + Telegram + Discord APIs).
- `zee health --json` — asks the running Gateway for a full health snapshot (WS-only; no direct Baileys socket).
- Send `/status` as a standalone message in WhatsApp/WebChat to get a status reply without invoking the agent.
- Logs: tail `/tmp/zee/zee-*.log` and filter for `web-heartbeat`, `web-reconnect`, `web-auto-reply`, `web-inbound`.

## Deep diagnostics
- Creds on disk: `ls -l ~/.zee/credentials/whatsapp/<accountId>/creds.json` (mtime should be recent).
- Session store: `ls -l ~/.zee/agents/<agentId>/sessions/sessions.json` (path can be overridden in config). Count and recent recipients are surfaced via `status`.
- Relink flow: `zee providers logout && zee providers login --verbose` when status codes 409–515 or `loggedOut` appear in logs. (Note: the QR login flow auto-restarts once for status 515 after pairing.)

## When something fails
- `logged out` or status 409–515 → relink with `zee providers logout` then `zee providers login`.
- Gateway unreachable → start it: `zee gateway --port 18789` (use `--force` if the port is busy).
- No inbound messages → confirm linked phone is online and the sender is allowed (`whatsapp.allowFrom`); for group chats, ensure allowlist + mention rules match (`whatsapp.groups`, `routing.groupChat.mentionPatterns`).

## Dedicated "health" command
`zee health --json` asks the running Gateway for its health snapshot (no direct Baileys socket from the CLI). It reports linked creds, auth age, Baileys connect result/status code, session-store summary, and a probe duration. It exits non-zero if the Gateway is unreachable or the probe fails/timeouts. Use `--timeout <ms>` to override the 10s default.
