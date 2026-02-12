---
summary: "CLI reference for `zee memory` (status/profile/index/search)"
read_when:
  - You want to index or search semantic memory
  - You’re debugging memory availability or indexing
---

# `zee memory`

Manage semantic memory indexing and search.
Provided by the active memory plugin (default: `memory-core`; set `plugins.slots.memory = "none"` to disable).

Related:
- Memory concept: [Memory](/concepts/memory)
 - Plugins: [Plugins](/plugins)

## Examples

```bash
zee memory status
zee memory status --deep
zee memory status --deep --index
zee memory status --deep --index --verbose
zee memory profile show
zee memory profile set local
zee memory index
zee memory index --verbose
zee memory search "release checklist"
zee memory status --agent main
zee memory index --agent main --verbose
```

## Options

Common:

- `--agent <id>`: scope to a single agent (default: all configured agents).
- `--verbose`: emit detailed logs during probes and indexing.

Notes:
- `memory status --deep` probes vector + embedding availability.
- `memory status --deep --index` runs a reindex if the store is dirty.
- `memory index --verbose` prints per-phase details (provider, model, sources, batch activity).
- `memory status` includes any extra paths configured via `memorySearch.extraPaths`.

## Local profile

Use the built-in local indexing profile (SQLite-backed):

```bash
zee memory profile set local
zee memory profile show
zee memory index
```

This profile keeps memory search local and does not require an external vector DB service.
