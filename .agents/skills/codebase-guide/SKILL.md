---
name: codebase-guide
description: Detailed architecture reference for zee - package structure, directory trees, daemon management, gateway architecture, environment variables, and state management.
version: "2.0.0"
tags: [architecture, reference, codebase, daemon, gateway]
---

# Zee Architecture Reference

## Architecture: zee -> swarm -> personas

```
zee (Engine)
  packages/zee/     Core TUI, daemon, SDK
  ~/.config/zee/    Config, auth, plugins
        |
        v
  SWARM (Orchestration) -- src/swarm/
    SPARC methodology (Specification->Pseudocode->Architecture->Refinement->Completion)
    Queen/worker swarm coordination
    Concurrent execution patterns
    Agent spawning via Task tool
    Memory coordination
        |
        v
  ZEE (Unified) -- .agents/skills/@zee/
    Handles all domains: life admin, investing, learning
    Tool namespaces: zee:*, stanley:*, johny:*
        |
    SHARED LAYER
      swarm/       Queen, workers, SPARC
```

### Flow Summary

1. **zee** = Core engine (CLI, TUI, daemon, gateway)
2. **swarm** = Orchestration layer (SPARC methodology, queen/worker coordination)
3. **Zee** = The single persona, with domain tool namespaces preserved

No generic "build" or "plan" agents. Every interaction goes through Zee with domain expertise via namespaced tools.

## Package Structure

```
packages/
  zee/               Core TUI, daemon, SDK, utils (main binary)
  zee-adapter/       Adapter layer for OpenCode Web UI
  app/               SolidJS web app (Vite)
  desktop/           Tauri desktop application
  extensions/        VSCode extension
  hosted/            Hono-based hosted deployment
  plugin/            Plugin system
  sdk/               TypeScript SDK (v1 & v2 client/server)
  stanley-core/      Stanley investing core logic
  ui/                SolidJS component library (Kobalte)
  util/              Zod schemas & TypeScript utilities
  web/               Astro documentation site
```

**Domain implementations (all under Zee):**
- **Life admin**: Tools in `src/domain/zee/`
- **Investing (Stanley)**: External Python repo (set `STANLEY_REPO` env var), core logic in `packages/stanley-core/`
- **Learning (Johny)**: Tools in `src/domain/johny/`, runtime in `src/personas/johny/`

## Key Directories

```
zee/
  .agents/skills/           Agent Skills
    @zee/                   Zee skills (life admin, investing, learning)
    @codex/                 Codex automation suite
    @clawhub/               ClawHub marketplace skills
    codebase-guide/         This architecture reference
    parallel-orchestration/ Parallel task patterns
  packages/
    zee/                    Core engine (CLI, TUI, daemon, gateway)
      src/
        cli/cmd/            CLI commands (run, agent, auth, daemon, mcp, etc.)
        server/             HTTP server (Hono), routes, SSE
        gateway/            Embedded gateway, token management
        provider/           LLM provider abstractions, circuit breaker
        session/            Session management, compaction
        mcp/                MCP server orchestration
        orchestration/      Worker orchestration, parallelization
        skill/              Skill registry
  src/
    domain/                 Domain-specific tools
      johny/                Learning tools
      stanley/              Financial tools (CLI bridge)
      zee/                  Life admin tools (memory, messaging, calendar, etc.)
    swarm/                  Swarm orchestration (queen, workers, SPARC)
    memory/                 Unified memory system
      unified.ts            Unified memory API
      qdrant.ts             Qdrant client integration
      embedding.ts          Embeddings generation
      entity-pages.ts       Entity/relationship storage
      hybrid.ts             Hybrid search (vector + FTS)
      sqlite-fts.ts         Full-text search fallback
      reranker.ts           Result reranking
    provider/               LLM provider abstractions (15+ providers)
    session/                Session state and lifecycle
    mcp/                    MCP servers (builtin, domain, security)
    transport/              Communication protocols
  docs/                     Architecture docs, provider references
```

## Integration

Skills loaded from `.agents/skills/` and `~/.config/zee/skills/`:

```
.agents/skills/@zee/                   Zee skills (20+ skills)
.agents/skills/@codex/                 Codex automation (31 skills)
.agents/skills/@clawhub/               ClawHub marketplace skills
.agents/skills/codebase-guide/         Architecture reference
.agents/skills/parallel-orchestration/ Parallel task patterns
```

## Development Guidelines

1. **Skills go in `.agents/skills/`** - Follow Agent Skills standard
2. **Domain tools go in `src/domain/`** - TypeScript implementations
3. **Domain logic goes in `src/domain/`** - Knowledge graphs, strategies
4. **Upstream syncs** - Zee syncs from opencode and openclaw upstreams periodically

## Persona Capabilities

**Spawn Drones**: Background workers that maintain persona identity, execute in parallel, report back, run in WezTerm panes.

**Shared Memory**: Qdrant vector memory, conversation continuity state, plan/objectives across sessions, key facts.

**Conversation Continuity**: Before compaction, summaries saved to Qdrant, key facts extracted, plan/objectives persist.

**WezTerm Pane Management**: Each drone gets its own pane, status pane shows state.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STANLEY_REPO` | Path to external Stanley Python repo (required for Stanley tools) |
| `JOHNY_DATA_DIR` | Directory for Johny data files (default: `~/.local/state/zee/johny`) |
| `ZEE_STATE_DIR` | Co-locate all state under a single root |
| `ZEE_WORKSPACE_DIR` | Override workspace location |

## State Management

Defaults follow XDG:

| Data | Location |
|------|----------|
| Config | `~/.config/zee/` |
| State | `~/.local/state/zee/` |
| Data | `~/.local/share/zee/` |
| Cache | `~/.cache/zee/` |
| Credentials | `~/.config/zee/credentials/` |

Use `zee paths` to print resolved locations.

## Daemon Management (systemd)

Managed by **systemd user service**. Always use `systemctl --user`. Never use `pkill`, `kill -9`, or `nohup`.

### Commands

```bash
systemctl --user restart zee              # Restart
systemctl --user stop zee                 # Stop
systemctl --user status zee               # Status
journalctl --user -u zee -f              # Live logs
journalctl --user -u zee --since "5 min ago"  # Recent logs
./scripts/reload.sh                       # Full rebuild + restart
./scripts/reload.sh --no-build            # Restart only
./scripts/reload.sh --status              # Check status
./scripts/reload.sh --clean               # Clean rebuild
```

### Service File

Location: `~/.config/systemd/user/zee.service`
- `Restart=always`, `RestartSec=10` (auto-recovery)
- `loginctl enable-linger` (persists across logout)
- Env vars from `~/.config/zee/daemon.env`

### Binary

`~/.bun/bin/zee` (symlink to `dist/@zee/zee-linux-x64/bin/zee`)

Install via `cd packages/zee && bun link`

### Common Processes

| Process | Description | Managed by |
|---------|-------------|------------|
| `zee daemon --hostname ...` | Daemon + embedded gateway | systemd |
| `zee --print-logs` | TUI instance | user |
| `bun run ... src/index.ts` | Dev server | user |

## Gateway Architecture

The gateway is always embedded in the daemon (no separate `--gateway` flag needed).

```
Zee Gateway (Transport) -- embedded in daemon
  WhatsApp (Baileys) | Telegram (grammY)
        |
  Persona Detection: @stanley->stanley, @johny->johny, default->zee
        |  HTTP POST /session/:id/message + agent: persona
        v
zee daemon (http://127.0.0.1:3210)
  ZEE Persona | STANLEY Tools | JOHNY Tools
```

- **Zee Gateway** = Transport only (WhatsApp/Telegram connections)
- **zee daemon** = All agent logic, memory, tools
- **Persona routing** = Messages mentioning `@stanley` or `@johny` route to those tool namespaces
- **Daemon requirement** = Gateway requires zee daemon running

### Running the Embedded Gateway

1. Daemon starts automatically via systemd. Manual restart: `systemctl --user restart zee`
2. Send messages via WhatsApp/Telegram:
   - "Hello" -> Zee (default)
   - "@stanley What's the market doing?" -> Stanley tools
   - "@johny Help me study" -> Johny tools

Gateway transport managed by the daemon process.
