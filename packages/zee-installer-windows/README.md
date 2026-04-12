# Zee Windows Installer

This package builds the Windows enterprise MSI from an existing Zee Windows dist folder.

Default input:

```powershell
cd packages/zee
bun run build -- --targets win32-x64
cd ../zee-installer-windows
bun run build
```

The MSI installs Zee under `C:\Program Files\Zee`, registers the `Zee` Windows Service, and configures service state under `C:\ProgramData\Zee`.

## Requirements

- Windows x64
- WiX Toolset v4 or newer on `PATH` as `wix.exe`
- Optional signing should happen after MSI creation and before winget manifest generation

## Useful Properties

- `INSTALLFOLDER`: install root, default `C:\Program Files\Zee`
- `ZEE_START_SERVICE`: `1` to start the service during install, `0` to install without starting
- `ZEE_ADD_PATH`: reserved for package-manager wrappers
- `ZEE_KEEP_DATA_ON_UNINSTALL`: reserved; service uninstall keeps data by default

## Outputs

- `dist/ZeeSetup-x64.msi`
- `dist/ZeeSetup-x64.sha256`
- `dist/winget/Adolago.Zee.installer.yaml`
