# Windows Enterprise Install

Zee supports a native Windows enterprise installation path built around a signed machine-wide MSI and a Windows Service.

## Defaults

- Install root: `C:\Program Files\Zee`
- Service name: `Zee`
- Service account: `NT SERVICE\Zee`
- Machine state: `C:\ProgramData\Zee\state`
- Machine data: `C:\ProgramData\Zee\data`
- Machine config: `C:\ProgramData\Zee\config`
- Machine logs: `C:\ProgramData\Zee\logs`
- Machine workspace: `C:\ProgramData\Zee\workspace`
- Machine policy: `C:\ProgramData\Zee\policy.jsonc`
- Machine memory: `C:\ProgramData\Zee\state\memory`
- Machine embedding cache: `C:\ProgramData\Zee\cache\memory\models`
- Machine OpenBB runtime: `C:\ProgramData\Zee\data\openbb`

Per-user CLI runs outside the service use:

- Config: `%AppData%\Zee`
- State/data/cache/logs/workspace: `%LocalAppData%\Zee\...`
- Managed OpenBB runtime: `%LocalAppData%\Zee\data\openbb`

Explicit environment overrides still win: `ZEE_STATE_DIR`, `ZEE_CONFIG_DIR`, `ZEE_WORKSPACE_DIR`, and `ZEE_LOG_DIR`.

## Service Commands

```powershell
zee daemon-install --non-interactive --force --binary "C:\Program Files\Zee\bin\zee.exe" --scope machine --service-account virtual --start
zee daemon-service-status
zee daemon-uninstall
```

The service uses delayed auto-start and restart-on-failure recovery. It writes runtime logs to `C:\ProgramData\Zee\logs`.
`daemon-install` also runs `zee memory prepare --scope machine`, so local SQLite memory and local embeddings are ready before the service starts.

## MSI Build

```powershell
cd packages\zee
bun run build -- --targets win32-x64

cd ..\zee-installer-windows
bun run build
```

Outputs:

- `packages\zee-installer-windows\dist\ZeeSetup-x64.msi`
- `packages\zee-installer-windows\dist\ZeeSetup-x64.sha256`
- `packages\zee-installer-windows\dist\winget\*.yaml`

## Silent Deployment

```powershell
msiexec /i ZeeSetup-x64.msi /qn ZEE_START_SERVICE=1
```

Use Intune, GPO, SCCM, or winget with the MSI artifact. Keep updates admin-controlled through MSI or winget rather than daemon self-update.

## Policy

Machine policy is loaded after user and project config, so it has highest precedence for enterprise-controlled settings. Configure enterprise OpenBB access here; remote OpenBB Platform API is the recommended machine-wide default. Local managed OpenBB is still supported, but provision it explicitly under the service account and machine data root.

```jsonc
{
  "openbb": {
    "apiUrl": "https://openbb.example.internal",
  },
  "server": {
    "hostname": "127.0.0.1",
    "port": 3210,
  },
  "daemon": {
    "enabled": true,
  },
  "memory": {
    "backend": "sqlite",
    "embedding": {
      "provider": "local",
    },
  },
}
```

Keep non-loopback binds disabled unless enterprise policy also configures authentication.
