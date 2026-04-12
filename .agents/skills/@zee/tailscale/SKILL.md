---
name: tailscale
version: 1.0.0
description: Manage local Tailscale operations via CLI. Use when the user asks to "check tailscale status", "list tailscale peers", "ping a device", "send file via tailscale", "tailscale funnel", "check who's online", or mentions Tailscale network management.
---

# Tailscale Skill

Use the local `tailscale` CLI for status, diagnostics, peer connectivity, Taildrop, Serve/Funnel, and SSH.

## Setup

Install and authenticate the `tailscale` CLI on the local machine.

---

## Local Operations (CLI)

These work on the current machine only.

### Status & Diagnostics

```bash
# Current status (peers, connection state)
tailscale status
tailscale status --json | jq '.Peer | to_entries[] | {name: .value.HostName, ip: .value.TailscaleIPs[0], online: .value.Online}'

# Network diagnostics (NAT type, DERP, UDP)
tailscale netcheck
tailscale netcheck --format=json

# Get this machine's Tailscale IP
tailscale ip -4

# Identify a Tailscale IP
tailscale whois 100.x.x.x
```

### Connectivity

```bash
# Ping a peer (shows direct vs relay)
tailscale ping <hostname-or-ip>

# Connect/disconnect
tailscale up
tailscale down

# Use an exit node
tailscale up --exit-node=<node-name>
tailscale exit-node list
tailscale exit-node suggest
```

### File Transfer (Taildrop)

```bash
# Send files to a device
tailscale file cp myfile.txt <device-name>:

# Receive files (moves from inbox to directory)
tailscale file get ~/Downloads
tailscale file get --wait ~/Downloads  # blocks until file arrives
```

### Expose Services

```bash
# Share locally within tailnet (private)
tailscale serve 3000
tailscale serve https://localhost:8080

# Share publicly to internet
tailscale funnel 8080

# Check what's being served
tailscale serve status
tailscale funnel status
```

### SSH

```bash
# SSH via Tailscale (uses MagicDNS)
tailscale ssh user@hostname

# Enable SSH server on this machine
tailscale up --ssh
```

---

## Common Use Cases

**"Who's online right now?"**
```bash
tailscale status
```

**"Send this file to my phone"**
```bash
tailscale file cp document.pdf my-phone:
```

**"Expose my dev server publicly"**
```bash
tailscale funnel 3000
```

**"Is the connection direct or relayed?"**
```bash
tailscale ping my-server
```
