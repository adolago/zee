---
summary: "Linux support + companion app status"
read_when:
  - Looking for Linux companion app status
  - Planning platform coverage or contributions
---
# Linux App

Zee core is fully supported on Linux. The core is written in TypeScript, so it runs anywhere Node or Bun runs.

We do not have a Linux companion app yet. It is planned, and we would love contributions to make it happen.

## Install
- [Getting Started](/start/getting-started)
- [Install & updates](/install/updating)
- Optional flows: [Bun](/install/bun), [Nix](/install/nix), [Docker](/install/docker)

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
zee daemon install
```

Or:

```
zee daemon install
```

Or:

```
zee configure
```

Select **Gateway daemon** when prompted.

Repair/migrate:

```
zee doctor
```

## System control (systemd user unit)
Full unit example lives in the [Gateway runbook](/gateway). Minimal setup:

Create `~/.config/systemd/user/zee-gateway.service`:

```
[Unit]
Description=Zee Gateway
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
systemctl --user enable --now zee-gateway.service
```
