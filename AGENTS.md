<!--
  AGENTS.md is the canonical agent instruction file for this repository.
-->

# Zee - The Engine

## Quick Reference

- Build and test: `cd packages/zee && bun run build && bun dev`
- Repo helper: `./z dev`, `./z build`, `./z reload`
- Default branch: `main`
- PRs target the fork at `origin` (e.g., `adolago/zee`), not upstream.
- Always run `./scripts/verify-pr-target.sh` before any `gh pr` or `gh issue` command.
- Always pass `--repo adolago/zee` to `gh` commands in this repository.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

### Binary Verification (CRITICAL)

After building, always verify the binary:
```bash
cd packages/zee && bun run build
./script/verify-binary.sh
```
If verification fails:
- `ln -sf ~/.local/src/zee/packages/zee/dist/@adolago/zee-linux-x64/bin/zee ~/.bun/bin/zee`

## Naming Convention

The user-facing name is **Zee**. The internal package infrastructure uses `zee`.
- CLI: `zee`, Config: `~/.config/zee/`, State: `~/.local/state/zee/`

## No Emojis Policy

Do NOT use emojis in commits, PRs, code comments, docs, logs, or user-facing text.
Exceptions: third-party integrations, user content, skill metadata `emoji` fields.

## Zee - Unified Assistant

Zee is the single assistant handling all domains:
- **Life admin** (zee:* tools): Memory, messaging, calendar, contacts, browser, expenses
- **Investing** (zee:invest-* tools): Market data, portfolio, SEC filings, NautilusTrader
- **Learning** (zee:learn-* tools): Knowledge graph, mastery tracking, spaced repetition

Zee can spawn drones (background workers), uses Qdrant memory, and preserves continuity across sessions.

## Key Paths

| What | Where |
|------|-------|
| Skills | `.agents/skills/@zee/` |
| Domain tools | `src/domain/zee/`, `learning/` |
| Swarm | `src/swarm/` (queen, workers, SPARC) |
| Engine | `packages/zee/` |
| Memory types | `src/memory/` |

## Daemon (systemd)

```bash
systemctl --user restart zee           # Restart daemon
systemctl --user status zee            # Daemon status
journalctl --user -u zee -f            # Daemon logs
./scripts/reload.sh                    # Full rebuild + restart
```

For detailed architecture, gateway flow, directory trees, and environment variables, use: `skill: { name: "codebase-guide" }`

## Codebase Study Artifacts (2026-02-20)

- Full codebase navigation map with file:line anchors: `atris/MAP.md`
- Daemon startup dependency graph and failure/degradation matrix:
  `docs/architecture/runtime-startup-dependency-graph.md`
