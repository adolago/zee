---
name: bitwarden
description: Manage secrets with Bitwarden CLI (bw). Use for unlocking vault, retrieving passwords/usernames/TOTP codes, and injecting secrets into commands.
version: 1.0.0
author: Artur
tags: [security, secrets, credentials, cli]
homepage: https://bitwarden.com/help/cli/
metadata: {"zee":{"emoji":"🔐","requires":{"bins":["bw"]},"install":[{"id":"pacman","kind":"pacman","package":"bitwarden-cli","bins":["bw"],"label":"Install Bitwarden CLI (pacman)"},{"id":"npm","kind":"npm","package":"@bitwarden/cli","bins":["bw"],"label":"Install Bitwarden CLI (npm)"}]}}
---

# Bitwarden CLI

Secure credential management via the `bw` CLI.

## References

- `references/commands.md` (common bw commands)
- `references/session.md` (session key management)

## Quick Start

```bash
# Check if installed
bw --version

# Login (first time only, stores credentials)
bw login

# Unlock vault (required each session, returns BW_SESSION)
export BW_SESSION=$(bw unlock --raw)

# Verify unlocked
bw status | jq -r '.status'  # should be "unlocked"

# Sync vault
bw sync
```

## Common Operations

### Get Credentials

```bash
# Get password by item name
bw get password "GitHub"

# Get username
bw get username "GitHub"

# Get TOTP code
bw get totp "GitHub"

# Get full item as JSON
bw get item "GitHub" | jq

# Get specific field
bw get item "GitHub" | jq -r '.login.password'
```

### Search Items

```bash
# List all items
bw list items | jq -r '.[].name'

# Search by name
bw list items --search "github" | jq -r '.[].name'

# List items in folder
bw list items --folderid <folder-id>

# List folders
bw list folders | jq -r '.[] | "\(.id) \(.name)"'
```

### Create/Update

```bash
# Create login item (use template)
bw get template item.login | jq '.name="New Item" | .login.username="user" | .login.password="pass"' | bw encode | bw create item

# Edit item (get, modify, update)
bw get item <id> | jq '.login.password="newpass"' | bw encode | bw edit item <id>
```

## Session Management

Bitwarden requires an unlocked session. The session key must be:
1. Exported as `BW_SESSION` environment variable, OR
2. Passed with `--session <key>` flag

### Unlock Pattern

```bash
# Unlock and capture session (interactive password prompt)
BW_SESSION=$(bw unlock --raw)
export BW_SESSION

# Verify
bw status | jq -r '.status'
```

### For Scripts/Automation

```bash
# If session exists in env, use it
if [ -z "$BW_SESSION" ]; then
  echo "Vault locked. Run: export BW_SESSION=\$(bw unlock --raw)"
  exit 1
fi
```

## Guardrails

- **Never** log, echo, or paste secrets into chat/code
- **Never** write secrets to disk unless absolutely necessary
- Prefer piping directly: `bw get password "item" | some-command`
- Session keys are sensitive - don't log them
- Lock when done: `bw lock`

## Status Check

```bash
bw status | jq
# Returns: { "serverUrl": "...", "lastSync": "...", "status": "unlocked|locked|unauthenticated" }
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Vault is locked" | Run `export BW_SESSION=$(bw unlock --raw)` |
| "You are not logged in" | Run `bw login` |
| "Session key is invalid" | Re-unlock: `export BW_SESSION=$(bw unlock --raw)` |
| Stale data | Run `bw sync` |
