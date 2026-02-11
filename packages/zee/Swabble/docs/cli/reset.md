---
summary: "CLI reference for `zee reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `zee reset`

Reset local config/state (keeps the CLI installed).

```bash
zee reset
zee reset --dry-run
zee reset --scope config+creds+sessions --yes --non-interactive
```

