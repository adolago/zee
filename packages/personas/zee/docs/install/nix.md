---
summary: "Install Zee declaratively with Nix"
read_when:
  - You want reproducible, rollback-able installs
  - You're already using Nix/NixOS/Home Manager
  - You want everything pinned and managed declaratively
---

# Nix Installation

The recommended way to run Zee with Nix is via **[nix-zee](https://github.com/zee/nix-zee)** — a batteries-included Home Manager module.

## Quick Start

Paste this to your AI agent (Claude, Cursor, etc.):

```text
I want to set up nix-zee on my Linux host.
Repository: github:zee/nix-zee

What I need you to do:
1. Check if Determinate Nix is installed (if not, install it)
2. Create a local flake at ~/code/zee-local using templates/agent-first/flake.nix
3. Help me create a WhatsApp bot account and get: homeserver URL, user ID, and access token
4. Set up secrets (WhatsApp access token, Anthropic key) - plain files at ~/.secrets/ is fine
5. Fill in the template placeholders and run home-manager switch
6. Verify: service running, account responds to messages

Reference the nix-zee README for module options.
```

> **Full guide: [github.com/zee/nix-zee](https://github.com/zee/nix-zee)**
>
> The nix-zee repo is the source of truth for Nix installation. This page is just a quick overview.

## What you get

- Gateway + tools (whisper, spotify, cameras) - all pinned
- Service manager entry that survives reboots
- Plugin system with declarative config
- Instant rollback: `home-manager switch --rollback`

---

## Nix Mode Runtime Behavior

When `ZEE_NIX_MODE=1` is set (automatic with nix-zee):

Zee supports a **Nix mode** that makes configuration deterministic and disables auto-install flows.
Enable it by exporting:

```bash
ZEE_NIX_MODE=1
```

### Config + state paths

Zee reads JSON5 config from `ZEE_CONFIG_PATH` and stores mutable data in `ZEE_STATE_DIR`.

- `ZEE_STATE_DIR` (default: `~/.zee`)
- `ZEE_CONFIG_PATH` (default: `$ZEE_STATE_DIR/zee.json`)

When running under Nix, set these explicitly to Nix-managed locations so runtime state and config
stay out of the immutable store.

### Runtime behavior in Nix mode

- Auto-install and self-mutation flows are disabled
- Missing dependencies surface Nix-specific remediation messages
- UI surfaces a read-only Nix mode banner when present

## Related

- [nix-zee](https://github.com/zee/nix-zee) — full setup guide
- [Wizard](/start/wizard) — non-Nix CLI setup
- [Docker](/install/docker) — containerized setup
