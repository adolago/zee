---
summary: "How the installer scripts work (install.sh + install-cli.sh), flags, and automation"
read_when:
  - You want to understand `zee-bot.com/install.sh`
  - You want to automate installs (CI / headless)
  - You want to install from a GitHub checkout
---

# Installer internals

Zee ships two installer scripts (served from `zee-bot.com`):

- `https://zee-bot.com/install.sh` — “recommended” installer (global npm install by default; can also install from a GitHub checkout)
- `https://zee-bot.com/install-cli.sh` — non-root-friendly CLI installer (installs into a prefix with its own Node)
 - `https://zee-bot.com/install.ps1` — Windows PowerShell installer (npm by default; optional git install)

To see the current flags/behavior, run:

```bash
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --help
```

Windows (PowerShell) help:

```powershell
& ([scriptblock]::Create((iwr -useb https://zee-bot.com/install.ps1))) -?
```

If the installer completes but `zee` is not found in a new terminal, it’s usually a Node/npm PATH issue. See: [Install](/install#nodejs--npm-path-sanity).

## install.sh (recommended)

What it does (high level):

- Detect OS (Linux / WSL).
- Ensure Node.js **22+** (via a package manager or version manager).
- Choose install method:
  - `npm` (default): `npm install -g zee@latest`
  - `git`: clone/build a source checkout and install a wrapper script
- On Linux: avoid global npm permission errors by switching npm’s prefix to `~/.npm-global` when needed.
- If upgrading an existing install: runs `zee doctor --non-interactive` (best effort).
- For git installs: runs `zee doctor --non-interactive` after install/update (best effort).
- Mitigates `sharp` native install gotchas by defaulting `SHARP_IGNORE_GLOBAL_LIBVIPS=1` (avoids building against system libvips).

If you *want* `sharp` to link against a globally-installed libvips (or you’re debugging), set:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=0 curl -fsSL https://zee-bot.com/install.sh | bash
```

### Discoverability / “git install” prompt

If you run the installer while **already inside a Zee source checkout** (detected via `package.json` + `pnpm-workspace.yaml`), it prompts:

- update and use this checkout (`git`)
- or migrate to the global npm install (`npm`)

In non-interactive contexts (no TTY / `--no-prompt`), you must pass `--install-method git|npm` (or set `ZEE_INSTALL_METHOD`), otherwise the script exits with code `2`.

### Why Git is needed

Git is required for the `--install-method git` path (clone / pull).

For `npm` installs, Git is *usually* not required, but some environments still end up needing it (e.g. when a package or dependency is fetched via a git URL). The installer currently ensures Git is present to avoid `spawn git ENOENT` surprises on fresh distros.

### Why npm hits `EACCES` on fresh Linux

On some Linux setups (especially after installing Node via the system package manager or NodeSource), npm’s global prefix points at a root-owned location. Then `npm install -g ...` fails with `EACCES` / `mkdir` permission errors.

`install.sh` mitigates this by switching the prefix to:

- `~/.npm-global` (and adding it to `PATH` in `~/.bashrc` / `~/.zshrc` when present)

## install-cli.sh (non-root CLI installer)

This script installs `zee` into a prefix (default: `~/.zee`) and also installs a dedicated Node runtime under that prefix, so it can work on machines where you don’t want to touch the system Node/npm.

Help:

```bash
curl -fsSL https://zee-bot.com/install-cli.sh | bash -s -- --help
```

## install.ps1 (Windows PowerShell)

What it does (high level):

- Ensure Node.js **22+** (winget/Chocolatey/Scoop or manual).
- Choose install method:
  - `npm` (default): `npm install -g zee@latest`
  - `git`: clone/build a source checkout and install a wrapper script
- Runs `zee doctor --non-interactive` on upgrades and git installs (best effort).

Examples:

```powershell
iwr -useb https://zee-bot.com/install.ps1 | iex
```

```powershell
iwr -useb https://zee-bot.com/install.ps1 | iex -InstallMethod git
```

```powershell
iwr -useb https://zee-bot.com/install.ps1 | iex -InstallMethod git -GitDir "C:\\zee"
```

Environment variables:

- `ZEE_INSTALL_METHOD=git|npm`
- `ZEE_GIT_DIR=...`

Git requirement:

If you choose `-InstallMethod git` and Git is missing, the installer will print the
Git for Windows link (`https://git-scm.com/download/win`) and exit.

Common Windows issues:

- **npm error spawn git / ENOENT**: install Git for Windows and reopen PowerShell, then rerun the installer.
- **"zee" is not recognized**: your npm global bin folder is not on PATH. Most systems use
  `%AppData%\\npm`. You can also run `npm config get prefix` and add `\\bin` to PATH, then reopen PowerShell.
