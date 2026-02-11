---
summary: "Linux support (Gateway + CLI/TUI)"
read_when:
  - Looking for Linux support status
  - Planning platform coverage or contributions
---
# Linux

The Gateway is fully supported on Linux. **Node is the recommended runtime**.
Bun is not recommended for the Gateway runtime (channel connector bugs).

No native Linux app is shipped in this repo. Use the Gateway and CLI/TUI.

## Beginner quick path (VPS)

1) Install Node 22+  
2) `npm i -g zee@latest`  
3) `zee onboard --install-daemon`  
4) From your laptop: `ssh -N -L 18789:127.0.0.1:18789 <user>@<host>`  
5) Open `http://127.0.0.1:18789/` and paste your token

Step-by-step VPS guide: [exe.dev](/platforms/exe-dev)

## Install
- [Getting Started](/start/getting-started)
- [Install & updates](/install/updating)
- Optional flows: [Bun (experimental)](/install/bun), [Nix](/install/nix), [Docker](/install/docker)

## Gateway
- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

Use one of these:

```
zee onboard --install-daemon
```

Or:

```
zee gateway install
```

Or:

```
zee configure
```

Select **Gateway service** when prompted.

Repair/migrate:

```
zee doctor
```

## System control (systemd user unit)
Zee installs a systemd **user** service by default. Use a **system**
service for shared or always-on servers. The full unit example and guidance
live in the [Gateway runbook](/gateway).

Minimal setup:

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

[Install]
WantedBy=default.target
```

Enable it:

```
systemctl --user enable --now zee-gateway[-<profile>].service
```
