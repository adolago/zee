---
summary: "Platform support overview (Gateway + companion apps)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
---
# Platforms

Zee core is written in TypeScript, so the CLI + Gateway run anywhere Node or Bun runs.

Companion apps exist for macOS (menu bar app) and mobile nodes (iOS/Android). Windows and
Linux companion apps are planned, but the core Gateway is fully supported today.

## Choose your OS

- macOS: [macOS](/platforms/macos)
- iOS: [iOS](/platforms/ios)
- Android: [Android](/platforms/android)
- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `zee daemon status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `zee onboard --install-daemon`
- Direct: `zee daemon install`
- Configure flow: `zee configure` → select **Gateway daemon**
- Repair/migrate: `zee doctor` (offers to install or fix the service)

The service target depends on OS:
- macOS: LaunchAgent (`com.zee.gateway`)
- Linux/WSL2: systemd user service
