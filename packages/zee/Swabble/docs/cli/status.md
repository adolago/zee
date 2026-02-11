---
summary: "CLI reference for `zee status` (diagnostics, probes, usage snapshots)"
read_when:
  - You want a quick diagnosis of channel health + recent session recipients
  - You want a pasteable “all” status for debugging
---

# `zee status`

Diagnostics for channels + sessions.

```bash
zee status
zee status --all
zee status --deep
zee status --usage
```

Notes:
- Output includes per-agent session stores when multiple agents are configured.
- Overview includes Gateway + node host service install/runtime status when available.
- Overview includes update channel + git SHA (for source checkouts).
- Update info surfaces in the Overview; if an update is available, status prints a hint to run `zee update` (see [Updating](/install/updating)).
