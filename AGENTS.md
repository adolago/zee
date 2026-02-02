<!--
  CLAUDE.md is a SYMLINK to this file (AGENTS.md).
  Edit THIS file; the symlink reflects changes automatically.
-->

# Agent-Core - The Engine

## Quick Reference

- Build and test: `cd packages/agent-core && bun run build && bun dev`
- Default branch: `dev`
- PRs target the fork at `origin` (e.g., `adolago/agent-core`), not upstream.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

### Binary Verification (CRITICAL)

After building, always verify the binary:
```bash
cd packages/agent-core && bun run build
./script/verify-binary.sh
```
If verification fails: `ln -sf /home/artur/.local/src/agent-core/packages/agent-core/dist/@adolago/agent-core-linux-x64/bin/agent-core ~/.bun/bin/agent-core`

## CRITICAL: Naming Convention

This project is `agent-core`. NEVER use the legacy name in new code, docs, or user-facing text.
- CLI: `agent-core`, Config: `~/.config/agent-core/`, State: `~/.local/state/agent-core/`

## No Emojis Policy

Do NOT use emojis in commits, PRs, code comments, docs, logs, or user-facing text.
Exceptions: third-party integrations, user content, skill metadata `emoji` fields.

## The Personas (Triad)

Three AI personas share orchestration (swarm) and memory (Qdrant):
- **Zee** (`@zee`): Personal assistant - memory, messaging, calendar, contacts
- **Stanley** (`@stanley`): Investing - market data, portfolio, SEC filings, NautilusTrader
- **Johny** (`@johny`): Learning - knowledge graph, mastery tracking, spaced repetition

Personas can spawn drones (background workers), share Qdrant memory, and preserve continuity across sessions.

## Key Paths

| What | Where |
|------|-------|
| Skills | `.agents/skills/@zee/`, `@stanley/`, `@johny/`, `swarm/`, `personas/` |
| Domain tools | `src/domain/zee/`, `stanley/`, `johny/` |
| Persona logic | `src/personas/johny/` (TS), `packages/stanley-core/` |
| Swarm | `src/swarm/` (queen, workers, SPARC) |
| Core engine | `packages/agent-core/` |
| Gateway | `packages/personas/zee/` |
| Memory types | `src/memory/` |

## Daemon (systemd)

```bash
systemctl --user restart agent-core   # Restart
systemctl --user status agent-core    # Status
journalctl --user -u agent-core -f    # Logs
./scripts/reload.sh                   # Full rebuild + restart
```

For detailed architecture, gateway flow, directory trees, and environment variables, use: `skill: { name: "codebase-guide" }`
