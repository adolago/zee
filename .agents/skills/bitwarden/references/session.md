# Bitwarden Session Management

## How Sessions Work

Bitwarden CLI requires an **unlocked session** to access vault data. When you unlock:

1. You provide your master password
2. The CLI returns a **session key** (base64 string)
3. This key must be provided for subsequent commands

## Session Key Methods

### Method 1: Environment Variable (Recommended)

```bash
# Unlock and export
export BW_SESSION=$(bw unlock --raw)

# All subsequent commands use it automatically
bw list items
bw get password "GitHub"
```

### Method 2: --session Flag

```bash
# Get session key
SESSION=$(bw unlock --raw)

# Pass explicitly
bw list items --session "$SESSION"
bw get password "GitHub" --session "$SESSION"
```

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│                    BITWARDEN SESSION                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  bw login          →  Authenticated (vault locked)      │
│                         │                               │
│  bw unlock --raw   →  Returns BW_SESSION key            │
│                         │                               │
│  export BW_SESSION →  Vault unlocked for this shell     │
│                         │                               │
│  bw get/list/...   →  Access vault data                 │
│                         │                               │
│  bw lock           →  Session invalidated               │
│                         │                               │
│  Shell closes      →  Session lost (env var gone)       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Session Persistence Patterns

### For Interactive Use

```bash
# Add to shell rc (~/.bashrc or ~/.zshrc)
alias bwu='export BW_SESSION=$(bw unlock --raw)'

# Then just run:
bwu
# Enter master password, vault is unlocked for session
```

### For Scripts

```bash
#!/bin/bash
set -e

# Check if already unlocked
STATUS=$(bw status | jq -r '.status')

if [ "$STATUS" != "unlocked" ]; then
  if [ -z "$BW_SESSION" ]; then
    echo "Error: Vault locked. Set BW_SESSION or run: export BW_SESSION=\$(bw unlock --raw)"
    exit 1
  fi
fi

# Proceed with operations
bw get password "MyItem"
```

### With Master Password (Automation)

```bash
# NOT RECOMMENDED for interactive use, but useful for CI/automation
# Store master password securely (e.g., in another secret manager or env)
echo "$BW_MASTER_PASSWORD" | bw unlock --raw
```

## Session Security

### Do's

- Keep session keys in memory only (env vars)
- Lock vault when done: `bw lock`
- Use short-lived sessions for scripts

### Don'ts

- Never log or echo `$BW_SESSION`
- Never write session key to files
- Never commit session keys to git
- Don't share sessions across machines

## Checking Session Status

```bash
# Full status
bw status | jq
# {
#   "serverUrl": "https://vault.bitwarden.com",
#   "lastSync": "2024-01-15T10:30:00.000Z",
#   "status": "unlocked"  # or "locked" or "unauthenticated"
# }

# Just status
bw status | jq -r '.status'

# One-liner check
[ "$(bw status | jq -r '.status')" = "unlocked" ] && echo "Ready" || echo "Locked"
```

## Troubleshooting

### "Vault is locked"

```bash
# Re-unlock
export BW_SESSION=$(bw unlock --raw)
```

### "Session key is invalid"

Session expired or was from different unlock. Re-unlock:

```bash
export BW_SESSION=$(bw unlock --raw)
```

### "You are not logged in"

```bash
# Login first (one-time)
bw login

# Then unlock
export BW_SESSION=$(bw unlock --raw)
```

### Session Lost After Command

Each `bw` invocation from Claude Code runs in a fresh shell. Export `BW_SESSION` in your terminal before starting, or handle unlock in your workflow.
