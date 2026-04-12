# @adolago/zee

Zee is a local-first CLI and daemon for day-to-day assistant workflows. This guide is written for new users and focuses on getting to a reliable working setup fast.

## Prerequisites

`Required`
- Node.js 20+ and Bun installed
- Shell with `zee` on `PATH`

`Linux (primary path in this guide)`
- `systemd --user` available for daemon install and always-on runtime

`macOS and Windows notes`
- You can install and run Zee normally.
- `zee daemon-install` is Linux systemd oriented.
- On macOS/Windows, run the daemon directly in a terminal session:

```bash
zee daemon --hostname 127.0.0.1 --port 3210
```

## Install

```bash
# stable
npm install -g @adolago/zee

# nightly
npm install -g @adolago/zee@nightly
```

## New-user onboarding flow (Linux, mandatory daemon setup)

### 1) Verify install

```bash
which zee
zee --version
```

`Expected`
- `which zee` returns a valid binary path.
- `zee --version` prints a version.

### 2) Run Zee once interactively

```bash
zee
```

`Expected`
- TUI starts and accepts input.

### 3) Install the daemon service

```bash
zee daemon-install --port 3210 --hostname 127.0.0.1
```

`Expected`
- Successful install message.
- Service unit created for `zee.service`.

### 4) Verify daemon health

```bash
zee daemon-service-status
systemctl --user status zee.service --no-pager
```

`Expected`
- Daemon reports installed and running.
- `systemctl` shows `active (running)`.

### 5) Check logs and attach workflow

```bash
journalctl --user -u zee.service -f
```

`Expected`
- Startup logs include daemon initialization.

## Curated skills are included by default

Zee ships with curated skills and mirrors them to machine-level config during install/startup.

`Important behavior`
- Skills are bundled in the Zee distribution.
- Machine-level mirror path is `~/.config/zee/skills`.
- If a required dependency is missing, a skill remains visible but is blocked with a clear reason.

`Inspect skills and readiness`

```bash
zee debug skill
zee debug skill-audit
zee check --categories skills --full
```

## Provider and credential onboarding

Use the built-in auth flow to configure providers and skill credentials:

```bash
zee auth
```

`Config location`
- `~/.config/zee/zee.jsonc`

`Secrets and daemon env`
- `~/.config/zee/daemon.env`

## First successful workflow checklist

Use this as your onboarding completion checklist:

1. `zee --version` works.
2. `zee daemon-install` completed (Linux).
3. `zee daemon-service-status` reports running daemon.
4. `zee debug skill-audit` shows curated skills loaded.
5. `zee` opens and accepts a prompt.

## Optional: OpenBB investing backend setup

For investing workflows and the OpenBB Workspace copilot, point Zee at an OpenBB Platform API instance:

```bash
export ZEE_OPENBB_API_URL=http://127.0.0.1:6900
export ZEE_OPENBB_API_CMD=openbb-api
```

Alternatively, set `ZEE_OPENBB_API_URL` to an already-running remote OpenBB Platform API.

## Build from source

```bash
git clone https://github.com/adolago/zee.git
cd zee
bun install
cd packages/zee
bun run build
bun run verify:binary
```

On Windows PowerShell, `bun run build` writes a local `zee.cmd` launcher into `%USERPROFILE%\\.bun\\bin`.
On Linux and macOS, it links the built binary into `~/.bun/bin/zee`.

If verification fails:

```bash
bun run build
bun run verify:binary
```

## Troubleshooting

`Binary mismatch`
- Run `bun run verify:binary` from `packages/zee`.

`Daemon not running`
- Run `systemctl --user status zee.service --no-pager`.
- Restart with `systemctl --user restart zee.service`.

`Skill is visible but blocked`
- Run `zee debug skill-audit` and check missing env/binary requirements.
- Install missing binaries or configure missing env vars, then restart daemon.

`Auth problems`
- Re-run `zee auth`.
- Validate config in `~/.config/zee/zee.jsonc`.

## Upgrade and maintenance

```bash
zee upgrade
systemctl --user restart zee.service
zee daemon-service-status
zee check --categories skills
```

## Configuration summary

Zee reads config from:
- `~/.config/zee/zee.jsonc` (default user config)
- `.zee/zee.jsonc` (project-local override)

## Next docs

- `docs/architecture/` for internal architecture and operational differences
- `docs/hosted/README.md` for hosted quick start
