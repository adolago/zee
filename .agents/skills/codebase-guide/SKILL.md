---
name: codebase-guide
description: Detailed architecture reference for agent-core - package structure, directory trees, daemon management, gateway architecture, environment variables, and state management.
tags: [architecture, reference, codebase, daemon, gateway]
---

# Agent-Core Architecture Reference

## Architecture: agent-core -> swarm -> personas

```
agent-core (Engine)
  packages/agent-core/     Core TUI, daemon, SDK
  ~/.config/agent-core/    Config, auth, plugins
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
  PERSONAS (The Triad) -- .agents/skills/
    Zee (Personal) | Stanley (Investing) | Johny (Learning)
        |
    SHARED LAYER
      personas/    Orchestration, drones
      swarm/       Queen, workers, SPARC
```

### Flow Summary

1. **agent-core** = Core engine (built-in agents removed, only triad remains)
2. **swarm** = Orchestration layer (SPARC methodology, queen/worker coordination)
3. **personas** = The Triad (Zee/Stanley/Johny) + shared capabilities

No generic "build" or "plan" agents. Every interaction goes through a persona with domain expertise.

## Package Structure

```
packages/
  agent-core/          Core TUI, daemon, SDK, utils
  agent-core-adapter/  Adapter layer
  app/                 App shell
  desktop/             Desktop integration
  extensions/          Extension system
  hosted/              Hosted deployment
  personas/            Personas package (Zee gateway)
  plugin/              Plugin system
  sdk/                 SDK
  stanley-core/        Stanley core logic
  ui/                  UI components
  util/                Shared utilities
  web/                 Web interface
```

**Personas:**
- **Zee**: Messaging gateway in `packages/personas/zee/`
- **Stanley**: External Python repo (set `STANLEY_REPO` env var), core logic in `packages/stanley-core/`
- **Johny**: TypeScript implementation in `src/personas/johny/`

## Key Directories

```
agent-core/
  .agents/skills/           Agent Skills (Anthropic standard)
    @johny/                 Study assistant
    @stanley/               Trading assistant
    @zee/                   Personal assistant
    personas/               Persona identities
    swarm/                  Swarm orchestration
  packages/
    agent-core/             Core engine
      src/pkg/              Merged packages (sdk, plugin, util, script)
    personas/zee/           Messaging gateway
  src/
    domain/                 Domain-specific tools
      johny/                Learning tools
      stanley/              Financial tools (CLI bridge)
      zee/                  Personal tools
    swarm/                  Swarm orchestration (queen, workers, SPARC)
    personas/
      johny/                TypeScript learning system
        knowledge-graph.ts  Topic DAG
        mastery.ts          Mastery tracking
        review.ts           Spaced repetition
        practice.ts         Practice sessions
    memory/                 Qdrant vector storage types
  docs/                     Architecture docs, provider references
```

## Integration

Skills loaded from `.agents/skills/` and `~/.config/agent-core/skills/`:

```
.agents/skills/@johny/     Johny persona
.agents/skills/@stanley/   Stanley persona
.agents/skills/@zee/       Zee persona
.agents/skills/personas/   Persona identities
.agents/skills/swarm/      Orchestration (drones, memory, continuity)
```

## Development Guidelines

1. **Skills go in `.agents/skills/`** - Follow Anthropic Agent Skills standard
2. **Domain tools go in `src/domain/`** - TypeScript implementations
3. **Persona logic goes in `src/personas/`** - Knowledge graphs, strategies
4. **No upstream sync** - Standalone monolith for solo development

## Personas Capabilities (ALL Personas Have These)

**Spawn Drones**: Background workers that maintain persona identity, execute in parallel, report back, run in WezTerm panes.

**Shared Memory**: Qdrant vector memory, conversation continuity state, plan/objectives across sessions, key facts.

**Conversation Continuity**: Before compaction, summaries saved to Qdrant, key facts extracted, plan/objectives persist.

**WezTerm Pane Management**: Each drone gets its own pane, status pane shows state.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STANLEY_REPO` | Path to external Stanley Python repo (required for Stanley tools) |
| `JOHNY_DATA_DIR` | Directory for Johny data files (default: `~/.zee/johny`) |
| `AGENT_CORE_ROOT` | Path to agent-core installation (for bundled binaries) |

## State Management

| Data | Location |
|------|----------|
| Johny knowledge | `~/.zee/johny/knowledge-graph.json` |
| Johny mastery | `~/.zee/johny/mastery.json` |
| Johny reviews | `~/.zee/johny/reviews.json` |
| Johny practice | `~/.zee/johny/practice.json` |
| Stanley portfolio | `~/.zee/stanley/portfolio.json` |
| Zee memories | `~/.zee/zee/memories.json` |
| Credentials | `~/.zee/credentials/` |

## Daemon Management (systemd)

Managed by **systemd user service**. Always use `systemctl --user`. Never use `pkill`, `kill -9`, or `nohup`.

### Commands

```bash
systemctl --user restart agent-core        # Restart
systemctl --user stop agent-core           # Stop
systemctl --user status agent-core         # Status
journalctl --user -u agent-core -f         # Live logs
journalctl --user -u agent-core --since "5 min ago"  # Recent logs
./scripts/reload.sh                        # Full rebuild + restart
./scripts/reload.sh --no-build             # Restart only
./scripts/reload.sh --status               # Check status
./scripts/reload.sh --clean                # Clean rebuild
```

### Service File

Location: `~/.config/systemd/user/agent-core.service`
- `Restart=always`, `RestartSec=10` (auto-recovery)
- `loginctl enable-linger` (persists across logout)
- Env vars from `~/.config/agent-core/daemon.env`

### Binary

`~/.bun/bin/agent-core` (symlink to `dist/@agent-core/core-linux-x64/bin/agent-core`)

Install via `cd packages/agent-core && bun link`

### Common Processes

| Process | Description | Managed by |
|---------|-------------|------------|
| `agent-core daemon --hostname ...` | Daemon + embedded gateway | systemd |
| `agent-core --print-logs` | TUI instance | user |
| `bun run ... src/index.ts` | Dev server | user |

## Gateway Architecture

```
Zee Gateway (Transport) -- packages/personas/zee/
  WhatsApp (Baileys) | Telegram (grammY)
        |
  Persona Detection: @stanley->stanley, @johny->johny, default->zee
        |  HTTP POST /session/:id/message + agent: persona
        v
agent-core daemon (http://127.0.0.1:3210)
  ZEE Persona | STANLEY Persona | JOHNY Persona
```

- **Zee Gateway** = Transport only (WhatsApp/Telegram/Signal connections)
- **agent-core daemon** = All agent logic, personas, memory, tools
- **Persona routing** = Messages mentioning `@stanley` or `@johny` routed accordingly
- **Daemon-only mode** = Zee REQUIRES agent-core daemon running

### Running the Embedded Gateway

1. Daemon starts automatically via systemd. Manual restart: `systemctl --user restart agent-core`
2. Send messages via WhatsApp/Telegram:
   - "Hello" -> Zee (default)
   - "@stanley What's the market doing?" -> Stanley
   - "@johny Help me study" -> Johny

Messaging transport in Zee gateway at `packages/personas/zee/`, managed by daemon.
