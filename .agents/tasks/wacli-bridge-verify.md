# Task: Verify wacli-bridge inbound messaging end-to-end

## Context

A wacli-bridge script was created at `scripts/wacli-bridge` and a systemd service
at `~/.config/systemd/user/zee-wacli-bridge.service` to forward inbound WhatsApp
messages from wacli to the Zee gateway at `POST /gateway/whatsapp/inbound`.

The bridge:
1. Runs `wacli sync --follow` as a subprocess (keeps WhatsApp connected, stores messages to local DB)
2. Polls `wacli messages list --after <cursor> --json` every 2 seconds
3. Skips FromMe messages and deduplicates by MsgID
4. Transforms wacli message format to the gateway WhatsAppInboundInput schema
5. POSTs to `http://localhost:3210/gateway/whatsapp/inbound`

## Steps to verify

### 1. Ensure services are running
```bash
systemctl --user restart zee.service
sleep 15
systemctl --user status zee.service   # should be active (running)
systemctl --user status zee-wacli-bridge.service  # should be active (running)
# If bridge is not running (BindsTo=zee.service should auto-start it):
systemctl --user start zee-wacli-bridge.service
```

### 2. Test gateway inbound endpoint directly
```bash
curl -s -X POST http://localhost:3210/gateway/whatsapp/inbound \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "test-verify-001",
    "senderId": "436649137379@s.whatsapp.net",
    "senderName": "Artur",
    "body": "ping from bridge verification",
    "timestamp": '"$(date +%s)"',
    "isGroup": false,
    "platform": "whatsapp"
  }'
```
Expected: `{"success":true}`

### 3. Check daemon logs for message processing
```bash
grep -i "inbound\|surface.*message\|routing.*engine\|session.*whatsapp" \
  ~/.local/state/zee/logs/daemon.log | tail -10
grep -i "inbound\|surface\|whatsapp" \
  ~/.local/state/zee/logs/daemon.err.log | tail -10
```

### 4. Check bridge logs
```bash
journalctl --user -u zee-wacli-bridge.service --no-pager -n 30
```

### 5. Live test with real WhatsApp message
Ask the user to send a WhatsApp message to their own number (+4367763605924 or
the number linked to wacli). Then check:
```bash
# Bridge should detect and forward it
journalctl --user -u zee-wacli-bridge.service -f
```

### 6. Fix media path in toPlatformMessage
In `packages/zee/src/surface/platforms/whatsapp.ts:77`, the media path uses
`meta://media/${m.mediaId}` which is a leftover from the Meta Business API.
Update it to reference wacli local media. The wacli store keeps media in
`~/.wacli/media/` or accessible via `wacli media download --id <msgId>`.

Change:
```typescript
path: `meta://media/${m.mediaId}`,
```
To:
```typescript
path: `wacli://media/${m.mediaId}`,
```
Or better, resolve to the actual file path if wacli stores media locally.

After editing, rebuild and verify:
```bash
cd packages/zee && bun run build && ./script/verify-binary.sh
```

### 7. Restart daemon after any code changes
```bash
systemctl --user restart zee.service
sleep 10
systemctl --user status zee.service
systemctl --user status zee-wacli-bridge.service
```

## Key files
- Bridge script: `/home/artur/Repositories/zee/scripts/wacli-bridge`
- Bridge service: `~/.config/systemd/user/zee-wacli-bridge.service`
- Gateway inbound route: `packages/zee/src/server/route/gateway.ts:317-359`
- WhatsApp platform: `packages/zee/src/surface/platforms/whatsapp.ts`
- Surface bootstrap: `packages/zee/src/bootstrap/surface.ts`
- Surface router: `packages/zee/src/surface/router.ts`
- Zee daemon service: `~/.config/systemd/user/zee.service`

## Important rules
- No emojis in commits, code, or docs
- After building: `./script/verify-binary.sh`
- Pass `--repo adolago/zee` to any `gh` commands
