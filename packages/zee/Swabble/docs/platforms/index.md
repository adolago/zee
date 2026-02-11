---
summary: "Platform support overview (Gateway only)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
---
# Platforms

Zee core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway runtime (channel connector bugs).

supported today, and the CLI/TUI provides the terminal interface across
platforms.


## Choose your OS

- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/platforms/fly)
- Hetzner (Docker): [Hetzner](/platforms/hetzner)
- GCP (Compute Engine): [GCP](/platforms/gcp)
- exe.dev (VM + HTTPS proxy): [exe.dev](/platforms/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `zee gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `zee onboard --install-daemon`
- Direct: `zee gateway install`
- Configure flow: `zee configure` → select **Gateway service**
- Repair/migrate: `zee doctor` (offers to install or fix the service)

The service target depends on OS:
- Linux/WSL2: systemd user service (`zee-gateway[-<profile>].service`)
