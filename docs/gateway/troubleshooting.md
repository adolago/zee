---
summary: "Quick troubleshooting guide for common Zee failures"
read_when:
  - Investigating runtime issues or failures
---
# Troubleshooting 🔧

When Zee misbehaves, here's how to fix it.

Start with the FAQ’s [First 60 seconds](/start/faq#first-60-seconds-if-somethings-broken) if you just want a quick triage recipe. This page goes deeper on runtime failures and diagnostics.

## Common Issues

### Service Installed but Nothing is Running

If the gateway service is installed but the process exits immediately, the daemon
can appear “loaded” while nothing is running.

**Check:**
```bash
zee daemon status
zee doctor
```

Doctor/daemon will show runtime state (PID/last exit) and log hints.

**Logs:**
- Preferred: `zee logs --follow`
- File logs (always): `/tmp/zee/zee-YYYY-MM-DD.log` (or your configured `logging.file`)
- macOS LaunchAgent (if installed): `$ZEE_STATE_DIR/logs/gateway.log` and `gateway.err.log`
- Linux systemd (if installed): `journalctl --user -u zee-gateway.service -n 200 --no-pager`
- Windows: `schtasks /Query /TN "Zee Gateway" /V /FO LIST`

### Service Running but Port Not Listening

If the service reports **running** but nothing is listening on the gateway port,
the Gateway likely refused to bind.

**What "running" means here**
- `Runtime: running` means your supervisor (launchd/systemd/schtasks) thinks the process is alive.
- `RPC probe` means the CLI could actually connect to the gateway WebSocket and call `status`.
- Always trust `Probe target:` + `Config (daemon):` as the “what did we actually try?” lines.

**Check:**
- `gateway.mode` must be `local` for `zee gateway` and the daemon.
- If you set `gateway.mode=remote`, the **CLI defaults** to a remote URL. The daemon can still be running locally, but your CLI may be probing the wrong place. Use `zee daemon status` to see the daemon’s resolved port + probe target (or pass `--url`).
- `zee daemon status` and `zee doctor` surface the **last gateway error** from logs when the service looks running but the port is closed.
- Non-loopback binds (`lan`/`tailnet`/`auto`) require auth:
  `gateway.auth.token` (or `ZEE_GATEWAY_TOKEN`).
- `gateway.remote.token` is for remote CLI calls only; it does **not** enable local auth.
- `gateway.token` is ignored; use `gateway.auth.token`.

**If `zee daemon status` shows a config mismatch**
- `Config (cli): ...` and `Config (daemon): ...` should normally match.
- If they don’t, you’re almost certainly editing one config while the daemon is running another.
- Fix: rerun `zee daemon install --force` from the same `--profile` / `ZEE_STATE_DIR` you want the daemon to use.

**If `Last gateway error:` mentions “refusing to bind … without auth”**
- You set `gateway.bind` to a non-loopback mode (`lan`/`tailnet`/`auto`) but left auth off.
- Fix: set `gateway.auth.mode` + `gateway.auth.token` (or export `ZEE_GATEWAY_TOKEN`) and restart the daemon.

**If `zee daemon status` says `bind=tailnet` but no tailnet interface was found**
- The gateway tried to bind to a Tailscale IP (100.64.0.0/10) but none were detected on the host.
- Fix: bring up Tailscale on that machine (or change `gateway.bind` to `loopback`/`lan`).

**If `Probe note:` says the probe uses loopback**
- That’s expected for `bind=lan`: the gateway listens on `0.0.0.0` (all interfaces), and loopback should still connect locally.
- For remote clients, use a real LAN IP (not `0.0.0.0`) plus the port, and ensure auth is configured.

### Address Already in Use (Port 18789)

This means something is already listening on the gateway port.

**Check:**
```bash
zee daemon status
```

It will show the listener(s) and likely causes (gateway already running, SSH tunnel).
If needed, stop the service or pick a different port.

### Legacy Workspace Folders Detected

If you upgraded from older installs, you might still have `~/clawdis` or
`~/zee` on disk. Multiple workspace directories can cause confusing auth
or state drift because only one workspace is active.

**Fix:** keep a single active workspace and archive/remove the rest. See
[Agent workspace](/concepts/agent-workspace#legacy-workspace-folders).

### "Agent was aborted"

The agent was interrupted mid-response.

**Causes:**
- User sent `stop`, `abort`, `esc`, `wait`, or `exit`
- Timeout exceeded
- Process crashed

**Fix:** Just send another message. The session continues.

### Messages Not Triggering

**Check 1:** Is the sender allowlisted?
```bash
zee status
```
Look for `AllowFrom: ...` in the output.

**Check 2:** For group chats, is mention required?
```bash
# The message must match mentionPatterns or explicit mentions; defaults live in provider groups/guilds.
grep -n "routing\\|groupChat\\|mentionPatterns\\|whatsapp\\.groups\\|telegram\\.groups\\|imessage\\.groups\\|discord\\.guilds" \
  "${ZEE_CONFIG_PATH:-$HOME/.zee/zee.json}"
```

**Check 3:** Check the logs
```bash
zee logs --follow
# or if you want quick filters:
tail -f "$(ls -t /tmp/zee/zee-*.log | head -1)" | grep "blocked\\|skip\\|unauthorized"
```

### Image + Mention Not Working

Known issue: When you send an image with ONLY a mention (no other text), WhatsApp sometimes doesn't include the mention metadata.

**Workaround:** Add some text with the mention:
- ❌ `@clawd` + image
- ✅ `@clawd check this` + image

### Session Not Resuming

**Check 1:** Is the session file there?
```bash
ls -la ~/.zee/agents/<agentId>/sessions/
```

**Check 2:** Is `idleMinutes` too short?
```json
{
  "session": {
    "idleMinutes": 10080  // 7 days
  }
}
```

**Check 3:** Did someone send `/new`, `/reset`, or a reset trigger?

### Agent Timing Out

Default timeout is 30 minutes. For long tasks:

```json
{
  "reply": {
    "timeoutSeconds": 3600  // 1 hour
  }
}
```

Or use the `process` tool to background long commands.

### WhatsApp Disconnected

```bash
# Check local status (creds, sessions, queued events)
zee status
# Probe the running gateway + providers (WA connect + Telegram + Discord APIs)
zee status --deep

# View recent connection events
zee logs --limit 200 | grep "connection\\|disconnect\\|logout"
```

**Fix:** Usually reconnects automatically once the Gateway is running. If you’re stuck, restart the Gateway process (however you supervise it), or run it manually with verbose output:

```bash
zee gateway --verbose
```

If you’re logged out / unlinked:

```bash
zee providers logout
trash "${ZEE_STATE_DIR:-$HOME/.zee}/credentials" # if logout can't cleanly remove everything
zee providers login --verbose       # re-scan QR
```

### Media Send Failing

**Check 1:** Is the file path valid?
```bash
ls -la /path/to/your/image.jpg
```

**Check 2:** Is it too large?
- Images: max 6MB
- Audio/Video: max 16MB  
- Documents: max 100MB

**Check 3:** Check media logs
```bash
grep "media\\|fetch\\|download" "$(ls -t /tmp/zee/zee-*.log | head -1)" | tail -20
```

### High Memory Usage

ZEE keeps conversation history in memory.

**Fix:** Restart periodically or set session limits:
```json
{
  "session": {
    "historyLimit": 100  // Max messages to keep
  }
}
```

## macOS Specific Issues

### App Crashes when Granting Permissions (Speech/Mic)

If the app disappears or shows "Abort trap 6" when you click "Allow" on a privacy prompt:

**Fix 1: Reset TCC Cache**
```bash
tccutil reset All com.zee.mac.debug
```

**Fix 2: Force New Bundle ID**
If resetting doesn't work, change the `BUNDLE_ID` in [`scripts/package-mac-app.sh`](https://github.com/zee/zee/blob/main/scripts/package-mac-app.sh) (e.g., add a `.test` suffix) and rebuild. This forces macOS to treat it as a new app.

### Gateway stuck on "Starting..."

The app connects to a local gateway on port `18789`. If it stays stuck:

**Fix 1: Stop the supervisor (preferred)**
If the gateway is supervised by launchd, killing the PID will just respawn it. Stop the supervisor first:
```bash
zee daemon status
zee daemon stop
# Or: launchctl bootout gui/$UID/com.zee.gateway
```

**Fix 2: Port is busy (find the listener)**
```bash
lsof -nP -iTCP:18789 -sTCP:LISTEN
```

If it’s an unsupervised process, try a graceful stop first, then escalate:
```bash
kill -TERM <PID>
sleep 1
kill -9 <PID> # last resort
```

**Fix 3: Check embedded gateway**
Ensure the gateway relay was properly bundled. Run [`./scripts/package-mac-app.sh`](https://github.com/zee/zee/blob/main/scripts/package-mac-app.sh) and ensure `bun` is installed.

## Debug Mode

Get verbose logging:

```bash
# Turn on trace logging in config:
#   ${ZEE_CONFIG_PATH:-$HOME/.zee/zee.json} -> { logging: { level: "trace" } }
#
# Then run verbose commands to mirror debug output to stdout:
zee gateway --verbose
zee providers login --verbose
```

## Log Locations

| Log | Location |
|-----|----------|
| Gateway file logs (structured) | `/tmp/zee/zee-YYYY-MM-DD.log` (or `logging.file`) |
| Gateway service logs (supervisor) | macOS: `$ZEE_STATE_DIR/logs/gateway.log` + `gateway.err.log` (default: `~/.zee/logs/...`; profiles use `~/.zee-<profile>/logs/...`)<br>Linux: `journalctl --user -u zee-gateway.service -n 200 --no-pager`<br>Windows: `schtasks /Query /TN "Zee Gateway" /V /FO LIST` |
| Session files | `$ZEE_STATE_DIR/agents/<agentId>/sessions/` |
| Media cache | `$ZEE_STATE_DIR/media/` |
| Credentials | `$ZEE_STATE_DIR/credentials/` |

## Health Check

```bash
# Supervisor + probe target + config paths
zee daemon status
# Include system-level scans (legacy/extra services, port listeners)
zee daemon status --deep

# Is the gateway reachable?
zee health --json
# If it fails, rerun with connection details:
zee health --verbose

# Is something listening on the default port?
lsof -nP -iTCP:18789 -sTCP:LISTEN

# Recent activity (RPC log tail)
zee logs --follow
# Fallback if RPC is down
tail -20 /tmp/zee/zee-*.log
```

## Reset Everything

Nuclear option:

```bash
zee daemon stop
# If you installed a service and want a clean install:
# zee daemon uninstall

trash "${ZEE_STATE_DIR:-$HOME/.zee}"
zee providers login         # re-pair WhatsApp
zee daemon restart           # or: zee gateway
```

⚠️ This loses all sessions and requires re-pairing WhatsApp.

## Getting Help

1. Check logs first: `/tmp/zee/` (default: `zee-YYYY-MM-DD.log`, or your configured `logging.file`)
2. Search existing issues on GitHub
3. Open a new issue with:
   - ZEE version
   - Relevant log snippets
   - Steps to reproduce
   - Your config (redact secrets!)

---

*"Have you tried turning it off and on again?"* — Every IT person ever

🦞🔧

### Browser Not Starting (Linux)

If you see `"Failed to start Chrome CDP on port 18800"`:

**Most likely cause:** Snap-packaged Chromium on Ubuntu.

**Quick fix:** Install Google Chrome instead:
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
```

Then set in config:
```json
{
  "browser": {
    "executablePath": "/usr/bin/google-chrome-stable"
  }
}
```

**Full guide:** See [browser-linux-troubleshooting](/tools/browser-linux-troubleshooting)
