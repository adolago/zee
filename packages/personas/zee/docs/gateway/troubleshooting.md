---
summary: "Quick troubleshooting guide for common Zee failures"
read_when:
  - Investigating runtime issues or failures
---
# Troubleshooting 🔧

When Zee misbehaves, here's how to fix it.

Start with the FAQ’s [First 60 seconds](/help/faq#first-60-seconds-if-somethings-broken) if you just want a quick triage recipe. This page goes deeper on runtime failures and diagnostics.

Provider-specific shortcuts: [/channels/troubleshooting](/channels/troubleshooting)

## Status & Diagnostics

Quick triage commands (in order):

| Command | What it tells you | When to use it |
|---|---|---|
| `zee status` | Local summary: OS + update, gateway reachability/mode, service, agents/sessions, provider config state | First check, quick overview |
| `zee status --all` | Full local diagnosis (read-only, pasteable, safe-ish) incl. log tail | When you need to share a debug report |
| `zee status --deep` | Runs gateway health checks (incl. provider probes; requires reachable gateway) | When “configured” doesn’t mean “working” |
| `zee gateway probe` | Gateway discovery + reachability (local + remote targets) | When you suspect you’re probing the wrong gateway |
| `zee channels status --probe` | Asks the running gateway for channel status (and optionally probes) | When gateway is reachable but channels misbehave |
| `zee gateway status` | Supervisor state (systemd/schtasks), runtime PID/exit, last gateway error | When the service “looks loaded” but nothing runs |
| `zee logs --follow` | Live logs (best signal for runtime issues) | When you need the actual failure reason |

**Sharing output:** prefer `zee status --all` (it redacts tokens). If you paste `zee status`, consider setting `ZEE_SHOW_SECRETS=0` first (token previews).

See also: [Health checks](/gateway/health) and [Logging](/logging).

## Common Issues

### No API key found for provider "anthropic"

This means the **agent’s auth store is empty** or missing Anthropic credentials.
Auth is **per agent**, so a new agent won’t inherit the main agent’s keys.

Fix options:
- Re-run onboarding and choose **Anthropic** for that agent.
- Or paste a setup-token on the **gateway host**:
  ```bash
  zee models auth setup-token --provider anthropic
  ```
- Or copy `auth-profiles.json` from the main agent dir to the new agent dir.

Verify:
```bash
zee models status
```

### OAuth token refresh failed (Anthropic Claude subscription)

This means the stored Anthropic OAuth token expired and the refresh failed.
If you’re on a Claude subscription (no API key), the most reliable fix is to
switch to a **Claude Code setup-token** and paste it on the **gateway host**.

**Recommended (setup-token):**

```bash
# Run on the gateway host (paste the setup-token)
zee models auth setup-token --provider anthropic
zee models status
```

If you generated the token elsewhere:

```bash
zee models auth paste-token --provider anthropic
zee models status
```

More detail: [Anthropic](/providers/anthropic) and [OAuth](/concepts/oauth).

### CI Secrets Scan Failed

This means `detect-secrets` found new candidates not yet in the baseline.
Follow [Secret scanning](/gateway/security#secret-scanning-detect-secrets).

### Service Installed but Nothing is Running

If the gateway service is installed but the process exits immediately, the service
can appear “loaded” while nothing is running.

**Check:**
```bash
zee gateway status
zee doctor
```

Doctor/service will show runtime state (PID/last exit) and log hints.

**Logs:**
- Preferred: `zee logs --follow`
- File logs (always): `/tmp/zee/zee-YYYY-MM-DD.log` (or your configured `logging.file`)
- Linux systemd (if installed): `journalctl --user -u zee-gateway.service -n 200 --no-pager`
- Linux systemd (if installed): `journalctl --user -u zee-gateway[-<profile>].service -n 200 --no-pager`
- Windows: `schtasks /Query /TN "Zee Gateway (<profile>)" /V /FO LIST`

**Enable more logging:**
- Bump file log detail (persisted JSONL):
  ```json
  { "logging": { "level": "debug" } }
  ```
- Bump console verbosity (TTY output only):
  ```json
  { "logging": { "consoleLevel": "debug", "consoleStyle": "pretty" } }
  ```
- Quick tip: `--verbose` affects **console** output only. File logs remain controlled by `logging.level`.

See [/logging](/logging) for a full overview of formats, config, and access.

### "Gateway start blocked: set gateway.mode=local"

This means the config exists but `gateway.mode` is unset (or not `local`), so the
Gateway refuses to start.

**Fix (recommended):**
- Run the wizard and set the Gateway run mode to **Local**:
  ```bash
  zee configure
  ```
- Or set it directly:
  ```bash
  zee config set gateway.mode local
  ```

**If you meant to run a remote Gateway instead:**
- Set a remote URL and keep `gateway.mode=remote`:
  ```bash
  zee config set gateway.mode remote
  zee config set gateway.remote.url "wss://gateway.example.com"
  ```

**Ad-hoc/dev only:** pass `--allow-unconfigured` to start the gateway without
`gateway.mode=local`.

**No config file yet?** Run `zee setup` to create a starter config, then rerun
the gateway.

### Service Environment (PATH + runtime)

The gateway service runs with a **minimal PATH** to avoid shell/manager cruft:
- Linux: `/usr/local/bin`, `/usr/bin`, `/bin`

This intentionally excludes version managers (nvm/fnm/volta/asdf) and package
managers (pnpm/npm) because the service does not load your shell init. Runtime
variables like `DISPLAY` should live in `~/.zee/.env` (loaded early by the
gateway).
Exec runs on `host=gateway` merge your login-shell `PATH` into the exec environment,
so missing tools usually mean your shell init isn’t exporting them (or set
`tools.exec.pathPrepend`). See [/tools/exec](/tools/exec).

Channel connectors require **Node**; Bun is unsupported. If your
service was installed with Bun or a version-managed Node path, run `zee doctor`
to migrate to a system Node install.

### Skill missing API key in sandbox

**Symptom:** Skill works on host but fails in sandbox with missing API key.

**Why:** sandboxed exec runs inside Docker and does **not** inherit host `process.env`.

**Fix:**
- set `agents.defaults.sandbox.docker.env` (or per-agent `agents.list[].sandbox.docker.env`)
- or bake the key into your custom sandbox image
- then run `zee sandbox recreate --agent <id>` (or `--all`)

### Service Running but Port Not Listening

If the service reports **running** but nothing is listening on the gateway port,
the Gateway likely refused to bind.

**What "running" means here**
- `Runtime: running` means your supervisor (systemd/schtasks) thinks the process is alive.
- `RPC probe` means the CLI could actually connect to the gateway WebSocket and call `status`.
- Always trust `Probe target:` + `Config (service):` as the “what did we actually try?” lines.

**Check:**
- `gateway.mode` must be `local` for `zee gateway` and the service.
- If you set `gateway.mode=remote`, the **CLI defaults** to a remote URL. The service can still be running locally, but your CLI may be probing the wrong place. Use `zee gateway status` to see the service’s resolved port + probe target (or pass `--url`).
- `zee gateway status` and `zee doctor` surface the **last gateway error** from logs when the service looks running but the port is closed.
- Non-loopback binds (`lan`/`tailnet`/`custom`, or `auto` when loopback is unavailable) require auth:
  `gateway.auth.token` (or `ZEE_GATEWAY_TOKEN`).
- `gateway.remote.token` is for remote CLI calls only; it does **not** enable local auth.
- `gateway.token` is ignored; use `gateway.auth.token`.

**If `zee gateway status` shows a config mismatch**
- `Config (cli): ...` and `Config (service): ...` should normally match.
- If they don’t, you’re almost certainly editing one config while the service is running another.
- Fix: rerun `zee gateway install --force` from the same `--profile` / `ZEE_STATE_DIR` you want the service to use.

**If `zee gateway status` reports service config issues**
- The supervisor config (systemd/schtasks) is missing current defaults.
- Fix: run `zee doctor` to update it (or `zee gateway install --force` for a full rewrite).

**If `Last gateway error:` mentions “refusing to bind … without auth”**
- You set `gateway.bind` to a non-loopback mode (`lan`/`tailnet`/`custom`, or `auto` when loopback is unavailable) but didn’t configure auth.
- Fix: set `gateway.auth.mode` + `gateway.auth.token` (or export `ZEE_GATEWAY_TOKEN`) and restart the service.

**If `zee gateway status` says `bind=tailnet` but no tailnet interface was found**
- The gateway tried to bind to a Tailscale IP (100.64.0.0/10) but none were detected on the host.
- Fix: bring up Tailscale on that machine (or change `gateway.bind` to `loopback`/`lan`).

**If `Probe note:` says the probe uses loopback**
- That’s expected for `bind=lan`: the gateway listens on `0.0.0.0` (all interfaces), and loopback should still connect locally.
- For remote clients, use a real LAN IP (not `0.0.0.0`) plus the port, and ensure auth is configured.

### Address Already in Use (Port 18789)

This means something is already listening on the gateway port.

**Check:**
```bash
zee gateway status
```

It will show the listener(s) and likely causes (gateway already running, SSH tunnel).
If needed, stop the service or pick a different port.

### Extra Workspace Folders Detected

If you upgraded from older installs, you might still have `~/zee` on disk.
Multiple workspace directories can cause confusing auth or state drift because
only one workspace is active.

**Fix:** keep a single active workspace and archive/remove the rest. See
[Agent workspace](/concepts/agent-workspace#extra-workspace-folders).

### Main chat running in a sandbox workspace

Symptoms: `pwd` or file tools show `~/.zee/sandboxes/...` even though you
expected the host workspace.

**Why:** `agents.defaults.sandbox.mode: "non-main"` keys off `session.mainKey` (default `"main"`).
Group/channel sessions use their own keys, so they are treated as non-main and
get sandbox workspaces.

**Fix options:**
- If you want host workspaces for an agent: set `agents.list[].sandbox.mode: "off"`.
- If you want host workspace access inside sandbox: set `workspaceAccess: "rw"` for that agent.

### "Agent was aborted"

The agent was interrupted mid-response.

**Causes:**
- User sent `stop`, `abort`, `esc`, `wait`, or `exit`
- Timeout exceeded
- Process crashed

**Fix:** Just send another message. The session continues.

### "Agent failed before reply: Unknown model: anthropic/claude-haiku-3-5"

Zee intentionally rejects **older/insecure models** (especially those more
vulnerable to prompt injection). If you see this error, the model name is no
longer supported.

**Fix:**
- Pick a **latest** model for the provider and update your config or model alias.
- If you’re unsure which models are available, run `zee models list` or
  `zee models scan` and choose a supported one.
- Check gateway logs for the detailed failure reason.

See also: [Models CLI](/cli/models) and [Model providers](/concepts/model-providers).

### Messages Not Triggering

**Check 1:** Is the sender allowlisted?
```bash
zee status
```
Look for `AllowFrom: ...` in the output.

**Check 2:** For group chats, is mention required?
```bash
# The message must match mentionPatterns or explicit mentions; defaults live in channel groups/guilds.
# Multi-agent: `agents.list[].groupChat.mentionPatterns` overrides global patterns.
  "${ZEE_CONFIG_PATH:-$HOME/.zee/zee.json}"
```

**Check 3:** Check the logs
```bash
zee logs --follow
# or if you want quick filters:
tail -f "$(ls -t /tmp/zee/zee-*.log | head -1)" | grep "blocked\\|skip\\|unauthorized"
```

### Pairing Code Not Arriving

If `dmPolicy` is `pairing`, unknown senders should receive a code and their message is ignored until approved.

**Check 1:** Is a pending request already waiting?
```bash
zee pairing list <channel>
```

Pending DM pairing requests are capped at **3 per channel** by default. If the list is full, new requests won’t generate a code until one is approved or expires.

**Check 2:** Did the request get created but no reply was sent?
```bash
zee logs --follow | grep "pairing request"
```

**Check 3:** Confirm `dmPolicy` isn’t `open`/`allowlist` for that channel.

### Image + Mention Not Working

Known issue: When you send an image with ONLY a mention (no other text), WhatsApp sometimes doesn't include the mention metadata.

**Workaround:** Add some text with the mention:
- ❌ `@zee` + image
- ✅ `@zee check this` + image

### Session Not Resuming

**Check 1:** Is the session file there?
```bash
ls -la ~/.zee/agents/<agentId>/sessions/
```

**Check 2:** Is the reset window too short?
```json
{
  "session": {
    "reset": {
      "mode": "daily",
      "atHour": 4,
      "idleMinutes": 10080  // 7 days
    }
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
# Probe the running gateway + channels (WA connect + channel APIs)
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
zee channels logout
trash "${ZEE_STATE_DIR:-$HOME/.zee}/credentials" # if logout can't cleanly remove everything
zee channels login --verbose       # re-scan QR
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

Zee keeps conversation history in memory.

**Fix:** Restart periodically or set session limits:
```json
{
  "session": {
    "historyLimit": 100  // Max messages to keep
  }
}
```

## Common troubleshooting

### “Gateway won’t start — configuration invalid”

Zee now refuses to start when the config contains unknown keys, malformed values, or invalid types.
This is intentional for safety.

Fix it with Doctor:
```bash
zee doctor
zee doctor --fix
```

Notes:
- `zee doctor` reports every invalid entry.
- `zee doctor --fix` applies migrations/repairs and rewrites the config.
- Diagnostic commands like `zee logs`, `zee health`, `zee status`, `zee gateway status`, and `zee gateway probe` still run even if the config is invalid.

### “All models failed” — what should I check first?

- **Credentials** present for the provider(s) being tried (auth profiles + env vars).
- **Model routing**: confirm `agents.defaults.model.primary` and fallbacks are models you can access.
- **Gateway logs** in `/tmp/zee/…` for the exact provider error.
- **Model status**: use `/model status` (chat) or `zee models status` (CLI).

### I’m running on my personal WhatsApp number — why is self-chat weird?

Enable self-chat mode and allowlist your own number:

```json5
{
  channels: {
    whatsapp: {
      selfChatMode: true,
      dmPolicy: "allowlist",
      allowFrom: ["+15555550123"]
    }
  }
}
```

See [WhatsApp setup](/channels/whatsapp).

### WhatsApp logged me out. How do I re‑auth?

Run the login command again and scan the QR code:

```bash
zee channels login
```

### Build errors on `main` — what’s the standard fix path?

1) `git pull origin main && pnpm install`
2) `zee doctor`
3) Check GitHub issues or docs
4) Temporary workaround: check out an older commit

### npm install fails (allow-build-scripts / missing tar or yargs). What now?

If you’re running from source, use the repo’s package manager: **pnpm** (preferred).
The repo declares `packageManager: "pnpm@…"`.

Typical recovery:
```bash
git status   # ensure you’re in the repo root
pnpm install
pnpm build
zee doctor
zee gateway restart
```

Why: pnpm is the configured package manager for this repo.

### How do I switch between git installs and npm installs?

Use the **website installer** and select the install method with a flag. It
upgrades in place and rewrites the gateway service to point at the new install.

Switch **to git install**:
```bash
curl -fsSL https://docs.zee/install.sh | bash -s -- --install-method git --no-onboard
```

Switch **to npm global**:
```bash
curl -fsSL https://docs.zee/install.sh | bash
```

Notes:
- The git flow only rebases if the repo is clean. Commit or stash changes first.
- After switching, run:
  ```bash
  zee doctor
  zee gateway restart
  ```

### Block streaming isn't splitting text between tool calls. Why?

Block streaming only sends **completed text blocks**. Common reasons you see a single message:
- `agents.defaults.blockStreamingDefault` is still `"off"`.
- `channels.<id>.blockStreaming` is `false` or missing for the active channel.
- Your `minChars` / coalesce settings are too high, so chunks get merged.
- The model emits one large text block (no mid‑reply flush points).

Fix checklist:
1) Put block streaming settings under `agents.defaults`, not the root.
2) Enable block streaming for the channel (for example `channels.whatsapp.blockStreaming: true` or `channels.matrix.blockStreaming: true`).
3) Use smaller chunk/coalesce thresholds while debugging.

See [Streaming](/concepts/streaming).

### Cloud Code Assist API error: invalid tool schema (400). What now?

This is almost always a **tool schema compatibility** issue. The Cloud Code Assist
endpoint accepts a strict subset of JSON Schema. Zee scrubs/normalizes tool
schemas in current `main`, but the fix is not in the last release yet (as of
January 13, 2026).

Fix checklist:
1) **Update Zee**:
   - If you can run from source, pull `main` and restart the gateway.
   - Otherwise, wait for the next release that includes the schema scrubber.
2) Avoid unsupported keywords like `anyOf/oneOf/allOf`, `patternProperties`,
   `additionalProperties`, `minLength`, `maxLength`, `format`, etc.
3) If you define custom tools, keep the top‑level schema as `type: "object"` with
   `properties` and simple enums.

See [Tools](/tools) and [TypeBox schemas](/concepts/typebox).

## Debug Mode

Get verbose logging:

```bash
# Turn on trace logging in config:
#   ${ZEE_CONFIG_PATH:-$HOME/.zee/zee.json} -> { logging: { level: "trace" } }
#
# Then run verbose commands to mirror debug output to stdout:
zee gateway --verbose
zee channels login --verbose
```

## Log Locations

| Log | Location |
|-----|----------|
| Gateway file logs (structured) | `/tmp/zee/zee-YYYY-MM-DD.log` (or `logging.file`) |
| Gateway service logs (supervisor) | Linux: `journalctl --user -u zee-gateway[-<profile>].service -n 200 --no-pager`<br />Windows: `schtasks /Query /TN "Zee Gateway (<profile>)" /V /FO LIST` |
| Session files | `$ZEE_STATE_DIR/agents/<agentId>/sessions/` |
| Media cache | `$ZEE_STATE_DIR/media/` |
| Credentials | `$ZEE_STATE_DIR/credentials/` |

## Health Check

```bash
# Supervisor + probe target + config paths
zee gateway status
# Include system-level scans (legacy/extra services, port listeners)
zee gateway status --deep

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
zee gateway stop
# If you installed a service and want a clean install:
# zee gateway uninstall

trash "${ZEE_STATE_DIR:-$HOME/.zee}"
zee channels login         # re-pair WhatsApp
zee gateway restart           # or: zee gateway
```

⚠️ This loses all sessions and requires re-pairing WhatsApp.

## Getting Help

1. Check logs first: `/tmp/zee/` (default: `zee-YYYY-MM-DD.log`, or your configured `logging.file`)
2. Search existing issues on GitHub
3. Open a new issue with:
   - Zee version
   - Relevant log snippets
   - Steps to reproduce
   - Your config (redact secrets!)

---

*"Have you tried turning it off and on again?"* — Every IT person ever

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
