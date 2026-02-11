---
summary: "Install Zee (recommended installer, global install, or from source)"
read_when:
  - Installing Zee
  - You want to install from GitHub
---

# Install

Use the installer unless you have a reason not to. It sets up the CLI and runs onboarding.

## Quick install (recommended)

```bash
curl -fsSL https://zee-bot.com/install.sh | bash
```

Windows (PowerShell):

```powershell
iwr -useb https://zee-bot.com/install.ps1 | iex
```

Next step (if you skipped onboarding):

```bash
zee onboard --install-daemon
```

## System requirements

- **Node >=22**
- Linux or Windows via WSL2
- `pnpm` only if you build from source

## Choose your install path

### 1) Installer script (recommended)

Installs `zee` globally via npm and runs onboarding.

```bash
curl -fsSL https://zee-bot.com/install.sh | bash
```

Installer flags:

```bash
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --help
```

Details: [Installer internals](/install/installer).

Non-interactive (skip onboarding):

```bash
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --no-onboard
```

### 2) Global install (manual)

If you already have Node:

```bash
npm install -g zee@latest
```

If you have libvips installed globally and `sharp` fails to install, force prebuilt binaries:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g zee@latest
```

If you see `sharp: Please add node-gyp to your dependencies`, install build tooling (for example, `npm install -g node-gyp`) or use the `SHARP_IGNORE_GLOBAL_LIBVIPS=1` workaround above to skip the native build.

Or:

```bash
pnpm add -g zee@latest
```

Then:

```bash
zee onboard --install-daemon
```

### 3) From source (contributors/dev)

```bash
git clone https://github.com/zee/zee.git
cd zee
pnpm install
pnpm build
zee onboard --install-daemon
```

Tip: if you don’t have a global install yet, run repo commands via `pnpm zee ...`.

### 4) Other install options

- Docker: [Docker](/install/docker)
- Nix: [Nix](/install/nix)
- Ansible: [Ansible](/install/ansible)
- Bun (CLI only): [Bun](/install/bun)

## After install

- Run onboarding: `zee onboard --install-daemon`
- Quick check: `zee doctor`
- Check gateway health: `zee status` + `zee health`
- Open the TUI: `zee`

## Install method: npm vs git (installer)

The installer supports two methods:

- `npm` (default): `npm install -g zee@latest`
- `git`: clone/build from GitHub and run from a source checkout

### CLI flags

```bash
# Explicit npm
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --install-method npm

# Install from GitHub (source checkout)
curl -fsSL https://zee-bot.com/install.sh | bash -s -- --install-method git
```

Common flags:

- `--install-method npm|git`
- `--git-dir <path>` (default: `~/zee`)
- `--no-git-update` (skip `git pull` when using an existing checkout)
- `--no-prompt` (disable prompts; required in CI/automation)
- `--dry-run` (print what would happen; make no changes)
- `--no-onboard` (skip onboarding)

### Environment variables

Equivalent env vars (useful for automation):

- `ZEE_INSTALL_METHOD=git|npm`
- `ZEE_GIT_DIR=...`
- `ZEE_GIT_UPDATE=0|1`
- `ZEE_NO_PROMPT=1`
- `ZEE_DRY_RUN=1`
- `ZEE_NO_ONBOARD=1`
- `SHARP_IGNORE_GLOBAL_LIBVIPS=0|1` (default: `1`; avoids `sharp` building against system libvips)

## Troubleshooting: `zee` not found (PATH)

Quick diagnosis:

```bash
node -v
npm -v
npm prefix -g
echo "$PATH"
```

If `$(npm prefix -g)/bin` (Linux) or `$(npm prefix -g)` (Windows) is **not** present inside `echo "$PATH"`, your shell can’t find global npm binaries (including `zee`).

Fix: add it to your shell startup file (zsh: `~/.zshrc`, bash: `~/.bashrc`):

```bash
# Linux
export PATH="$(npm prefix -g)/bin:$PATH"
```

On Windows, add the output of `npm prefix -g` to your PATH.

Then open a new terminal (or `rehash` in zsh / `hash -r` in bash).

## Update / uninstall

- Updates: [Updating](/install/updating)
- Migrate to a new machine: [Migrating](/install/migrating)
- Uninstall: [Uninstall](/install/uninstall)
