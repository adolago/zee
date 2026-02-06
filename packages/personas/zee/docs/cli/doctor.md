---
summary: "CLI reference for `zee doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
---

# `zee doctor`

Health checks + quick fixes for the gateway and channels.

Related:
- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Examples

```bash
zee doctor
zee doctor --repair
zee doctor --deep
```

Notes:
- Interactive prompts (like keychain/OAuth fixes) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, no terminal) will skip prompts.
- `--fix` (alias for `--repair`) writes a backup to `~/.zee/zee.json.bak` and drops unknown config keys, listing each removal.
