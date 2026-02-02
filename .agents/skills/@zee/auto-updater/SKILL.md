---
name: auto-updater
description: "Automatically update agent-core and all installed skills once daily. Runs via cron, checks for updates, applies them, and messages the user with a summary of what changed."
version: 1.0.0
author: maximeprades
tags: [updates, automation, cron, maintenance]
source: clawhub
metadata: {"clawhub":{"id":"maximeprades/auto-updater","emoji":"","os":["darwin","linux"]}}
---

# Auto-Updater Skill

Keep your agent-core and skills up to date automatically with daily update checks.

## What It Does

This skill sets up a daily cron job that:

1. Updates agent-core itself (via package manager or source rebuild)
2. Updates all installed skills (via `agent-core clawhub update --all`)
3. Messages you with a summary of what was updated

## Setup

### Quick Start

Ask your persona to set up the auto-updater:

```
Set up daily auto-updates for yourself and all your skills.
```

Or manually add the cron job:

```bash
agent-core cron add \
  --name "Daily Auto-Update" \
  --cron "0 4 * * *" \
  --tz "America/Los_Angeles" \
  --session isolated \
  --wake now \
  --deliver \
  --message "Run daily auto-updates: check for agent-core updates and update all skills. Report what was updated."
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| Time | 4:00 AM | When to run updates (use `--cron` to change) |
| Timezone | System default | Set with `--tz` |
| Delivery | Main session | Where to send the update summary |

## How Updates Work

### agent-core Updates

For **bun installs**:
```bash
cd ~/.local/src/agent-core/packages/agent-core && bun run build
```

For **source installs** (git checkout):
```bash
cd ~/.local/src/agent-core && git pull && cd packages/agent-core && bun run build && bun link
```

### Skill Updates

```bash
agent-core clawhub update --all
```

This checks all installed skills against the registry and updates any with new versions available.

## Update Summary Format

After updates complete, you'll receive a message like:

```
Daily Auto-Update Complete

agent-core: Updated to v2026.1.10 (was v2026.1.9)

Skills Updated (3):
- prd: 2.0.3 -> 2.0.4
- browser: 1.2.0 -> 1.2.1
- nano-banana-pro: 3.1.0 -> 3.1.2

Skills Already Current (5):
gemini, sag, things-mac, himalaya, peekaboo

No issues encountered.
```

## Manual Commands

Check for updates without applying:
```bash
agent-core clawhub update --all --dry-run
```

View current skill versions:
```bash
agent-core clawhub list
```

Check agent-core version:
```bash
agent-core --version
```

## Troubleshooting

### Updates Not Running

1. Verify cron is enabled: check `cron.enabled` in config
2. Confirm daemon is running continuously
3. Check cron job exists: `agent-core cron list`

### Update Failures

If an update fails, the summary will include the error. Common fixes:

- **Permission errors**: Ensure the daemon user can write to skill directories
- **Network errors**: Check internet connectivity
- **Package conflicts**: Rebuild from source

### Disabling Auto-Updates

Remove the cron job:
```bash
agent-core cron remove "Daily Auto-Update"
```

Or disable temporarily in config:
```json
{
  "cron": {
    "enabled": false
  }
}
```
