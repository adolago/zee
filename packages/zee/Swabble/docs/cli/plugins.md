---
summary: "CLI reference for `zee plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
---

# `zee plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:
- Plugin system: [Plugins](/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
zee plugins list
zee plugins info <id>
zee plugins enable <id>
zee plugins disable <id>
zee plugins doctor
zee plugins update <id>
zee plugins update --all
```

Bundled plugins ship with Zee but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `zee.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
zee plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
zee plugins install -l ./my-plugin
```

### Update

```bash
zee plugins update <id>
zee plugins update --all
zee plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
