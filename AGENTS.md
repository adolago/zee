<!--
  CLAUDE.md is a SYMLINK to this file (AGENTS.md).
  Edit THIS file; the symlink reflects changes automatically.
-->

# Zee - opencode wrapped in openclaw

## Quick Reference

- Build and test: `cd packages/zee-core && bun run build && bun dev`
- Default branch: `dev`
- PRs target the fork at `origin` (e.g., `adolago/zee`), not upstream.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

### Binary Verification (CRITICAL)

After building, always verify the binary:
```bash
cd packages/zee-core && bun run build
./script/verify-binary.sh
```
If verification fails:
- `ln -sf ~/.local/src/zee/packages/zee-core/dist/@zee/core-linux-x64/bin/zee ~/.bun/bin/zee`
- Optional legacy alias: `ln -sf ~/.bun/bin/zee ~/.bun/bin/agent-core`

## Naming Convention

The user-facing name is **Zee**. The internal package infrastructure uses `zee`; `agent-core` exists only as an optional compatibility alias.
- CLI: `zee` (optional legacy alias: `agent-core`), Config: `~/.config/zee/`, State: `~/.local/state/zee/`

## No Emojis Policy

Do NOT use emojis in commits, PRs, code comments, docs, logs, or user-facing text.
Exceptions: third-party integrations, user content, skill metadata `emoji` fields.

## Ecosystem

| Project | Repo |
|---------|------|
| **Zee** | [adolago/zee](https://github.com/adolago/zee) -- this repo |
| **GMATE** | [adolago/gmate](https://github.com/adolago/gmate) -- AI-powered GMAT study platform |

## Zee - Unified Assistant

Zee is the single assistant handling all domains:
- **Life admin** (zee:* tools): Memory, messaging, calendar, contacts, browser, expenses
- **Investing** (stanley:* tools): Market data, portfolio, SEC filings, NautilusTrader
- **Learning** (johny:* tools): Knowledge graph, mastery tracking, spaced repetition

Zee can spawn drones (background workers), uses Qdrant memory, and preserves continuity across sessions.

## Key Paths

| What | Where |
|------|-------|
| Skills | `.agents/skills/@zee/`, `.agents/skills/personas/` |
| Domain tools | `src/domain/zee/`, `stanley/`, `johny/` |
| Persona logic | `src/personas/johny/` (TS), `packages/stanley-core/` |
| Swarm | `src/swarm/` (queen, workers, SPARC) |
| Core engine | `packages/zee-core/` |
| Gateway | `packages/personas/zee/` |
| Memory types | `src/memory/` |

## Daemon (systemd)

```bash
systemctl --user restart zee           # Restart (or agent-core)
systemctl --user status zee            # Status
journalctl --user -u zee -f            # Logs
./scripts/reload.sh                   # Full rebuild + restart
```

For detailed architecture, gateway flow, directory trees, and environment variables, use: `skill: { name: "codebase-guide" }`
