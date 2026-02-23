# Task: Setup Telegram bridge for Zee

## Context

The Telegram bridge script at `scripts/telegram-bridge` runs a Telegram bot via
long polling and forwards inbound messages to Zee sessions through:
- `POST /session` (create or map chat -> session)
- `POST /session/:sessionID/message` (prompt Zee)

Replies are sent back to Telegram with `sendMessage`.

## Quick local run

```bash
export TELEGRAM_BOT_TOKEN="123456:abc..."
export ZEE_API_URL="http://127.0.0.1:3210"
export ZEE_TELEGRAM_AGENT="zee"
export ZEE_TELEGRAM_ALLOWED_CHAT_IDS="123456789"   # optional

scripts/telegram-bridge
```

## Optional systemd user service

Create environment file:

```bash
mkdir -p ~/.config/zee
cat > ~/.config/zee/telegram-bridge.env <<'EOF'
TELEGRAM_BOT_TOKEN=123456:abc...
ZEE_API_URL=http://127.0.0.1:3210
ZEE_TELEGRAM_AGENT=zee
# ZEE_TELEGRAM_ALLOWED_CHAT_IDS=123456789
EOF
```

Create service:

```bash
cat > ~/.config/systemd/user/zee-telegram-bridge.service <<'EOF'
[Unit]
Description=Zee Telegram Bridge
After=network-online.target zee.service
Wants=network-online.target
BindsTo=zee.service

[Service]
Type=simple
WorkingDirectory=/home/artur/Repositories/zee
EnvironmentFile=%h/.config/zee/telegram-bridge.env
ExecStart=/home/artur/Repositories/zee/scripts/telegram-bridge
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now zee-telegram-bridge.service
```

## Verification checklist

1. Confirm services:
```bash
systemctl --user status zee.service
systemctl --user status zee-telegram-bridge.service
```

2. Watch bridge logs:
```bash
journalctl --user -u zee-telegram-bridge.service -f
```

3. Send `/start` to the Telegram bot and then a normal message.

Expected:
- bot returns help for `/start`
- bot returns Zee response for a normal message
- `~/.local/state/zee/telegram-bridge.json` contains chat session mapping and updated offset
