# Tailscale Skill

Manage local Tailscale operations from Zee.

## What It Does

**CLI (local operations):**
- **Status** — check connection status, peers, NAT type
- **Ping** — test connectivity to peers (direct vs relay)
- **File transfer** — send/receive files via Taildrop
- **Serve/Funnel** — expose local services privately or publicly
- **SSH** — connect via Tailscale SSH

## Setup

The `tailscale` CLI works out of the box for local operations:

```bash
tailscale status
tailscale ping my-server
tailscale file cp document.pdf my-phone:
```

No tailnet-wide admin setup is needed for this skill.

## Usage Examples

### Local CLI operations

```bash
# Status and diagnostics
tailscale status
tailscale netcheck

# Ping a peer
tailscale ping my-server

# Send a file
tailscale file cp myfile.txt my-phone:

# Expose a local service
tailscale serve 3000           # Private (tailnet only)
tailscale funnel 8080          # Public (internet)
```

## Troubleshooting

**"tailscale: command not found"**  
→ Install Tailscale: https://tailscale.com/download

**Device not found by name**  
→ The script searches by hostname. Use the full device ID if name lookup fails.

## License

MIT
