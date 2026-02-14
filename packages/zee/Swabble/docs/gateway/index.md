---
summary: "Runbook for the Gateway service, lifecycle, and operations"
read_when:
  - Running or debugging the gateway process
---
# Gateway service runbook

Last updated: 2025-12-09

## What it is
- The always-on process that owns the channel connections and the control/event plane.
- Replaces the legacy `gateway` command. CLI entry point: `zee gateway`.
- Runs until stopped; exits non-zero on fatal errors so the supervisor restarts it.

## How to run (local)
```bash
zee gateway --port 18789
# for full debug/trace logs in stdio:
zee gateway --port 18789 --verbose
# if the port is busy, terminate listeners then start:
zee gateway --force
# dev loop (auto-reload on TS changes):
bun run gateway:watch
```
- Config hot reload watches `~/.zee/zee.json` (or `ZEE_CONFIG_PATH`).
  - Default mode: `gateway.reload.mode="hybrid"` (hot-apply safe changes, restart on critical).
  - Hot reload uses in-process restart via **SIGUSR1** when needed.
  - Disable with `gateway.reload.mode="off"`.
- Binds WebSocket control plane to `127.0.0.1:<port>` (default 18789).
- The same port also serves HTTP (hooks, A2UI, and API endpoints). Single-port multiplex.
  - OpenAI Chat Completions (HTTP): [`/v1/chat/completions`](/gateway/openai-http-api).
  - OpenResponses (HTTP): [`/v1/responses`](/gateway/openresponses-http-api).
  - Tools Invoke (HTTP): [`/tools/invoke`](/gateway/tools-invoke-http-api).
- Starts a Canvas file server by default on `canvasHost.port` (default `18793`), serving `http://<gateway-host>:18793/__zee__/canvas/` from `~/zee/canvas`. Disable with `canvasHost.enabled=false` or `ZEE_SKIP_CANVAS_HOST=1`.
- Logs to stdout; use systemd to keep it alive and rotate logs.
- Pass `--verbose` to mirror debug logging (handshakes, req/res, events) from the log file into stdio when troubleshooting.
- `--force` uses `lsof` to find listeners on the chosen port, sends SIGTERM, logs what it killed, then starts the gateway (fails fast if `lsof` is missing).
- If you run under a supervisor (systemd), a stop/restart typically sends **SIGTERM**; older builds may surface this as `pnpm` `ELIFECYCLE` exit code **143** (SIGTERM), which is a normal shutdown, not a crash.
- **SIGUSR1** triggers an in-process restart when authorized (gateway tool/config apply/update, or enable `commands.restart` for manual restarts).
- Gateway auth is required by default: set `gateway.auth.token` (or `ZEE_GATEWAY_TOKEN`) or `gateway.auth.password`. Clients must send `connect.params.auth.token/password` unless using Tailscale Serve identity.
- The wizard now generates a token by default, even on loopback.
- Port precedence: `--port` > `ZEE_GATEWAY_PORT` > `gateway.port` > default `18789`.

## Remote access
- Tailscale/VPN preferred; otherwise SSH tunnel:
  ```bash
  ssh -N -L 18789:127.0.0.1:18789 user@host
  ```
- Clients then connect to `ws://127.0.0.1:18789` through the tunnel.
- If a token is configured, clients must include it in `connect.params.auth.token` even over the tunnel.

## Multiple gateways (same host)

Usually unnecessary: one Gateway can serve multiple messaging channels and agents. Use multiple Gateways only for redundancy or strict isolation (ex: rescue bot).

Supported if you isolate state + config and use unique ports. Full guide: [Multiple gateways](/gateway/multiple-gateways).

Service names are profile-aware:
- Linux: `zee-gateway-<profile>.service`
- Windows: `Zee Gateway (<profile>)`

Install metadata is embedded in the service config:
- `ZEE_SERVICE_MARKER=zee`
- `ZEE_SERVICE_KIND=gateway`
- `ZEE_SERVICE_VERSION=<version>`

Rescue-Bot Pattern: keep a second Gateway isolated with its own profile, state dir, workspace, and base port spacing. Full guide: [Rescue-bot guide](/gateway/multiple-gateways#rescue-bot-guide).

### Dev profile (`--dev`)

Fast path: run a fully-isolated dev instance (config/state/workspace) without touching your primary setup.

```bash
zee --dev setup
zee --dev gateway --allow-unconfigured
# then target the dev instance:
zee --dev status
zee --dev health
```

Defaults (can be overridden via env/flags/config):
- `ZEE_STATE_DIR=~/.zee-dev`
- `ZEE_CONFIG_PATH=~/.zee-dev/zee.json`
- `ZEE_GATEWAY_PORT=19001` (Gateway WS + HTTP)
- `canvasHost.port=19005` (derived: `gateway.port+4`)
- `agents.defaults.workspace` default becomes `~/zee-dev` when you run `setup`/`onboard` under `--dev`.

Derived ports (rules of thumb):
- Base port = `gateway.port` (or `ZEE_GATEWAY_PORT` / `--port`)
- `canvasHost.port = base + 4` (or `ZEE_CANVAS_HOST_PORT` / config override)

Checklist per instance:
- unique `gateway.port`
- unique `ZEE_CONFIG_PATH`
- unique `ZEE_STATE_DIR`
- unique `agents.defaults.workspace`
- separate WhatsApp numbers (if using WA)

Service install per profile:
```bash
zee --profile main gateway install
zee --profile rescue gateway install
```

Example:
```bash
ZEE_CONFIG_PATH=~/.zee/a.json ZEE_STATE_DIR=~/.zee-a zee gateway --port 19001
ZEE_CONFIG_PATH=~/.zee/b.json ZEE_STATE_DIR=~/.zee-b zee gateway --port 19002
```

## Protocol (operator view)
- Full docs: [Gateway protocol](/gateway/protocol) and [Bridge protocol (legacy)](/gateway/bridge-protocol).
- Mandatory first frame from client: `req {type:"req", id, method:"connect", params:{minProtocol,maxProtocol,client:{id,displayName?,version,platform,deviceFamily?,modelIdentifier?,mode,instanceId?}, caps, auth?, locale?, userAgent? } }`.
- Gateway replies `res {type:"res", id, ok:true, payload:hello-ok }` (or `ok:false` with an error, then closes).
- After handshake:
  - Requests: `{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`
  - Events: `{type:"event", event, payload, seq?, stateVersion?}`
- Structured presence entries: `{host, ip, version, platform?, deviceFamily?, modelIdentifier?, mode, lastInputSeconds?, ts, reason?, tags?[], instanceId? }` (for WS clients, `instanceId` comes from `connect.client.instanceId`).
- `agent` responses are two-stage: first `res` ack `{runId,status:"accepted"}`, then a final `res` `{runId,status:"ok"|"error",summary}` after the run finishes; streamed output arrives as `event:"agent"`.

## Methods (initial set)
- `health` — full health snapshot (same shape as `zee health --json`).
- `status` — short summary.
- `system-presence` — current presence list.
- `system-event` — post a presence/system note (structured).
- `send` — send a message via the active channel(s).
- `agent` — run an agent turn (streams events back on same connection).
- `node.list` — list paired + currently-connected nodes (includes `caps`, `deviceFamily`, `modelIdentifier`, `paired`, `connected`, and advertised `commands`).
- `node.describe` — describe a node (capabilities + supported `node.invoke` commands; works for paired nodes and for currently-connected unpaired nodes).
- `node.invoke` — invoke a command on a node (e.g. `canvas.*`, `camera.*`).
- `node.pair.*` — pairing lifecycle (`request`, `list`, `approve`, `reject`, `verify`).

See also: [Presence](/concepts/presence) for how presence is produced/deduped and why a stable `client.instanceId` matters.

## Events
- `agent` — streamed tool/output events from the agent run (seq-tagged).
- `presence` — presence updates (deltas with stateVersion) pushed to all connected clients.
- `tick` — periodic keepalive/no-op to confirm liveness.
- `shutdown` — Gateway is exiting; payload includes `reason` and optional `restartExpectedMs`. Clients should reconnect.

## Client integration
- CLI/TUI connects directly to the Gateway WebSocket for history, sends, abort, and events.
- Remote use goes through the same SSH/Tailscale tunnel; if a gateway token is configured, the client includes it during `connect`.

## Typing and validation
- Server validates every inbound frame with AJV against JSON Schema emitted from the protocol definitions.
- Clients (TS) consume generated types from the schema output.
- Protocol definitions are the source of truth; regenerate schema/models with:
  - `bun run protocol:gen`

## Connection snapshot
- `hello-ok` includes a `snapshot` with `presence`, `health`, `stateVersion`, and `uptimeMs` plus `policy {maxPayload,maxBufferedBytes,tickIntervalMs}` so clients can render immediately without extra requests.
- `health`/`system-presence` remain available for manual refresh, but are not required at connect time.

## Error codes (res.error shape)
- Errors use `{ code, message, details?, retryable?, retryAfterMs? }`.
- Standard codes:
  - `NOT_LINKED` — WhatsApp not authenticated.
  - `AGENT_TIMEOUT` — agent did not respond within the configured deadline.
  - `INVALID_REQUEST` — schema/param validation failed.
  - `UNAVAILABLE` — Gateway is shutting down or a dependency is unavailable.

## Keepalive behavior
- `tick` events (or WS ping/pong) are emitted periodically so clients know the Gateway is alive even when no traffic occurs.
- Send/agent acknowledgements remain separate responses; do not overload ticks for sends.

## Replay / gaps
- Events are not replayed. Clients detect seq gaps and should refresh (`health` + `system-presence`) before continuing.

## Supervision (systemd example)
- Use systemd user services to keep the gateway alive.
  - `zee gateway install` writes `~/.config/systemd/user/zee-gateway.service`
    (or `zee-gateway-<profile>.service`).
  - `systemctl --user enable --now zee-gateway.service`
- On failure, systemd restarts; fatal misconfig should keep exiting so the operator notices.
- `zee doctor` audits the service config and can update it to current defaults.

## Gateway service management (CLI)

Use the Gateway CLI for install/start/stop/restart/status:

```bash
zee gateway status
zee gateway install
zee gateway stop
zee gateway restart
zee logs --follow
```

Notes:
- `gateway status` probes the Gateway RPC by default using the service’s resolved port/config (override with `--url`).
- `gateway status --deep` adds system-level scans (system units).
- `gateway status --no-probe` skips the RPC probe (useful when networking is down).
- `gateway status --json` is stable for scripts.
- `gateway status` reports **supervisor runtime** (systemd running) separately from **RPC reachability** (WS connect + status RPC).
- `gateway status` prints config path + probe target to avoid “localhost vs LAN bind” confusion and profile mismatches.
- `gateway status` includes the last gateway error line when the service looks running but the port is closed.
- `logs` tails the Gateway file log via RPC (no manual `tail`/`grep` needed).
- If other gateway-like services are detected, the CLI warns unless they are Zee profile services.
  We still recommend **one gateway per machine** for most setups; use isolated profiles/ports for redundancy or a rescue bot. See [Multiple gateways](/gateway/multiple-gateways).
  - Cleanup: `zee gateway uninstall` (current service) and `zee doctor` (legacy migrations).
- `gateway install` is a no-op when already installed; use `zee gateway install --force` to reinstall (profile/env/path changes).

## Supervision (systemd user unit)
Zee installs a **systemd user service** by default on Linux/WSL2. We
recommend user services for single-user machines (simpler env, per-user config).
Use a **system service** for multi-user or always-on servers (no lingering
required, shared supervision).

`zee gateway install` writes the user unit. `zee doctor` audits the
unit and can update it to match the current recommended defaults.

Create `~/.config/systemd/user/zee-gateway[-<profile>].service`:
```
[Unit]
Description=Zee Gateway (profile: <profile>, v<version>)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/zee gateway --port 18789
Restart=always
RestartSec=5
Environment=ZEE_GATEWAY_TOKEN=
WorkingDirectory=/home/youruser

[Install]
WantedBy=default.target
```
Enable lingering (required so the user service survives logout/idle):
```
sudo loginctl enable-linger youruser
```
Onboarding runs this on Linux/WSL2 (may prompt for sudo; writes `/var/lib/systemd/linger`).
Then enable the service:
```
systemctl --user enable --now zee-gateway[-<profile>].service
```

**Alternative (system service)** - for always-on or multi-user servers, you can
install a systemd **system** unit instead of a user unit (no lingering needed).
Create `/etc/systemd/system/zee-gateway[-<profile>].service` (copy the unit above,
switch `WantedBy=multi-user.target`, set `User=` + `WorkingDirectory=`), then:
```
sudo systemctl daemon-reload
sudo systemctl enable --now zee-gateway[-<profile>].service
```

## Windows (WSL2)

Windows installs should use **WSL2** and follow the Linux systemd section above.

## Operational checks
- Liveness: open WS and send `req:connect` → expect `res` with `payload.type="hello-ok"` (with snapshot).
- Readiness: call `health` → expect `ok: true` and a linked channel in `linkChannel` (when applicable).
- Debug: subscribe to `tick` and `presence` events; ensure `status` shows linked/auth age; presence entries show Gateway host and connected clients.

## Safety guarantees
- Assume one Gateway per host by default; if you run multiple profiles, isolate ports/state and target the right instance.
- No fallback to direct Baileys connections; if the Gateway is down, sends fail fast.
- Non-connect first frames or malformed JSON are rejected and the socket is closed.
- Graceful shutdown: emit `shutdown` event before closing; clients must handle close + reconnect.

## CLI helpers
- `zee gateway health|status` — request health/status over the Gateway WS.
- `zee message send --target <num> --message "hi" [--media ...]` — send via Gateway (idempotent for WhatsApp).
- `zee agent --message "hi" --to <num>` — run an agent turn (waits for final by default).
- `zee gateway call <method> --params '{"k":"v"}'` — raw method invoker for debugging.
- `zee gateway stop|restart` — stop/restart the supervised gateway service (systemd).
- Gateway helper subcommands assume a running gateway on `--url`; they no longer auto-spawn one.

## Migration guidance
- Retire uses of `zee gateway` and the legacy TCP control port.
- Update clients to speak the WS protocol with mandatory connect and structured presence.
