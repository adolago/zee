---
summary: "Remote access using SSH tunnels (Gateway WS) and tailnets"
read_when:
  - Running or troubleshooting remote gateway setups
---
# Remote access (SSH, tunnels, and tailnets)

This repo supports “remote over SSH” by keeping a single Gateway (the master) running on a dedicated host (desktop/server) and connecting clients to it.

- For **operators (CLI/TUI)**: SSH tunneling is the universal fallback.
- For **node hosts**: connect to the Gateway **WebSocket** (LAN/tailnet or SSH tunnel as needed).

## The core idea

- The Gateway WebSocket binds to **loopback** on your configured port (defaults to 18789).
- For remote use, you forward that loopback port over SSH (or use a tailnet/VPN and tunnel less).

## Common VPN/tailnet setups (where the agent lives)

Think of the **Gateway host** as “where the agent lives.” It owns sessions, auth profiles, channels, and state.
Your laptop/desktop (and nodes) connect to that host.

### 1) Always-on Gateway in your tailnet (VPS or home server)

Run the Gateway on a persistent host and reach it via **Tailscale** or SSH.

- **Best UX:** keep `gateway.bind: "loopback"` and use **Tailscale Serve** for Gateway access.
- **Fallback:** keep loopback + SSH tunnel from any machine that needs access.
- **Examples:** [exe.dev](/platforms/exe-dev) (easy VM) or [Hetzner](/platforms/hetzner) (production VPS).

This is ideal when your laptop sleeps often but you want the agent always-on.

### 2) Home desktop runs the Gateway, laptop is remote control

The laptop does **not** run the agent. It connects remotely:

- Use an SSH tunnel or tailnet connection.
- Use CLI/TUI over the tunnel.

### 3) Laptop runs the Gateway, remote access from other machines

Keep the Gateway local but expose it safely:

- SSH tunnel to the laptop from other machines, or
- Tailscale Serve the Gateway and keep it loopback-only.

Guide: [Tailscale](/gateway/tailscale).

## Command flow (what runs where)

One gateway service owns state + channels. Nodes are peripherals.

Flow example (channel → node):
- Inbound message arrives at the **Gateway**.
- Gateway runs the **agent** and decides whether to call a node tool.
- Gateway calls the **node** over the Gateway WebSocket (`node.*` RPC).
- Node returns the result; Gateway replies back out to the channel.

Notes:
- **Nodes do not run the gateway service.** Only one gateway should run per host unless you intentionally run isolated profiles (see [Multiple gateways](/gateway/multiple-gateways)).

## SSH tunnel (CLI + tools)

Create a local tunnel to the remote Gateway WS:

```bash
ssh -N -L 18789:127.0.0.1:18789 user@host
```

With the tunnel up:
- `zee health` and `zee status --deep` now reach the remote gateway via `ws://127.0.0.1:18789`.
- `zee gateway {status,health,send,agent,call}` can also target the forwarded URL via `--url` when needed.

Note: replace `18789` with your configured `gateway.port` (or `--port`/`ZEE_GATEWAY_PORT`).

## CLI remote defaults

You can persist a remote target so CLI commands use it by default:

```json5
{
  gateway: {
    mode: "remote",
    remote: {
      url: "ws://127.0.0.1:18789",
      token: "your-token"
    }
  }
}
```

When the gateway is loopback-only, keep the URL at `ws://127.0.0.1:18789` and open the SSH tunnel first.

## Security rules (remote/VPN)

Short version: **keep the Gateway loopback-only** unless you’re sure you need a bind.

- **Loopback + SSH/Tailscale Serve** is the safest default (no public exposure).
- **Non-loopback binds** (`lan`/`tailnet`/`custom`, or `auto` when loopback is unavailable) must use auth tokens/passwords.
- `gateway.remote.token` is **only** for remote CLI calls — it does **not** enable local auth.
- `gateway.remote.tlsFingerprint` pins the remote TLS cert when using `wss://`.
- **Tailscale Serve** can authenticate via identity headers when `gateway.auth.allowTailscale: true`.
  Set it to `false` if you want tokens/passwords instead.
- Treat browser control like operator access: tailnet-only + deliberate node pairing.

Deep dive: [Security](/gateway/security).
