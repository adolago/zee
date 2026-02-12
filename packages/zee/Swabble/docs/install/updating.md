---
summary: "Updating Zee safely (global install or source), plus rollback strategy"
read_when:
  - Updating Zee
  - Something breaks after an update
---

# Updating

Zee is moving fast (pre “1.0”). Treat updates like shipping infra: update → run checks → restart (or use `zee update`, which restarts) → verify.

## Recommended: re-run the website installer (upgrade in place)

The **preferred** update path is to re-run the installer from the website. It
detects existing installs, upgrades in place, and runs `zee doctor` when
needed.

```bash
curl -fsSL https://zee-bot.com/install.sh | bash
```

Notes:
- Add `--no-onboard` if you don’t want the onboarding wizard to run again.
- For **source installs**, use:
  ```bash
  curl -fsSL https://zee-bot.com/install.sh | bash -s -- --install-method git --no-onboard
  ```
  The installer will `git pull --rebase` **only** if the repo is clean.
- For **global installs**, the script uses `npm install -g zee@latest` under the hood.
- Legacy note: `zee` remains available as a compatibility shim.

## Before you update

- Know how you installed: **global** (npm/pnpm) vs **from source** (git clone).
- Know how your Gateway is running: **foreground terminal** vs **supervised service** (systemd/schtasks).
- Snapshot your tailoring:
  - Config: `~/.zee/zee.json`
  - Credentials: `~/.zee/credentials/`
  - Workspace: `~/zee`

## Update (global install)

Global install (pick one):

```bash
npm i -g zee@latest
```

```bash
pnpm add -g zee@latest
```
We do **not** recommend Bun for the Gateway runtime (channel connector bugs).

To switch update channels (git + npm installs):

```bash
zee update --channel beta
zee update --channel dev
zee update --channel stable
```

Use `--tag <dist-tag|version>` for a one-off install tag/version.

See [Development channels](/install/development-channels) for channel semantics and release notes.

Note: on npm installs, the gateway logs an update hint on startup (checks the current channel tag). Disable via `update.checkOnStart: false`.

Then:

```bash
zee doctor
zee gateway restart
zee health
```

Notes:
- If your Gateway runs as a service, `zee gateway restart` is preferred over killing PIDs.
- If you’re pinned to a specific version, see “Rollback / pinning” below.

## Update (`zee update`)

For **source installs** (git checkout), prefer:

```bash
zee update
```

It runs a safe-ish update flow:
- Requires a clean worktree.
- Switches to the selected channel (tag or branch).
- Fetches + rebases against `origin/main` (dev channel).
- Installs deps, builds, builds the CLI/TUI, and runs `zee doctor`.
- Restarts the gateway by default (use `--no-restart` to skip).

If you installed via **npm/pnpm** (no git metadata), `zee update` will try to update via your package manager. If it can’t detect the install, use “Update (global install)” instead.

## Update (from source)

From the repo checkout:

Preferred:

```bash
zee update
```

Manual (equivalent-ish):

```bash
git pull
pnpm install
pnpm build
zee doctor
zee health
```

Notes:
- `pnpm build` matters when you run the packaged `zee` binary ([`zee.mjs`](https://github.com/zee/zee/blob/main/zee.mjs)) or use Node to run `dist/`.
- If you run from a repo checkout without a global install, use `pnpm zee ...` for CLI commands.
- If you run directly from TypeScript (`pnpm zee ...`), a rebuild is usually unnecessary, but **config migrations still apply** → run doctor.
- Switching between global and git installs is easy: install the other flavor, then run `zee doctor` so the gateway service entrypoint is rewritten to the current install.

## Always Run: `zee doctor`

Doctor is the “safe update” command. It’s intentionally boring: repair + migrate + warn.

Note: if you’re on a **source install** (git checkout), `zee doctor` will offer to run `zee update` first.

Typical things it does:
- Migrate deprecated config keys / legacy config file locations.
- Audit DM policies and warn on risky “open” settings.
- Check Gateway health and can offer to restart.
- Detect and migrate older gateway services (systemd; legacy schtasks) to current Zee services.
- On Linux, ensure systemd user lingering (so the Gateway survives logout).

Details: [Doctor](/gateway/doctor)

## Start / stop / restart the Gateway

CLI (works regardless of OS):

```bash
zee gateway status
zee gateway stop
zee gateway restart
zee gateway --port 18789
zee logs --follow
```

If you’re supervised:
- Linux systemd user service: `systemctl --user restart zee-gateway[-<profile>].service`
- Windows (WSL2): `systemctl --user restart zee-gateway[-<profile>].service`
  - `launchctl`/`systemctl` only work if the service is installed; otherwise run `zee gateway install`.

Runbook + exact service labels: [Gateway runbook](/gateway)

## Rollback / pinning (when something breaks)

### Pin (global install)

Install a known-good version (replace `<version>` with the last working one):

```bash
npm i -g zee@<version>
```

```bash
pnpm add -g zee@<version>
```

Tip: to see the current published version, run `npm view zee version`.

Then restart + re-run doctor:

```bash
zee doctor
zee gateway restart
```

### Pin (source) by date

Pick a commit from a date (example: “state of main as of 2026-01-01”):

```bash
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
```

Then reinstall deps + restart:

```bash
pnpm install
pnpm build
zee gateway restart
```

If you want to go back to latest later:

```bash
git checkout main
git pull
```

## If you’re stuck

- Run `zee doctor` again and read the output carefully (it often tells you the fix).
- Check: [Troubleshooting](/gateway/troubleshooting)
