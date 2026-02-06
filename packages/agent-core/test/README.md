# agent-core Test Directory

## Structure

Each subdirectory mirrors a source domain in `src/`:

| Directory        | What it tests                                      |
|------------------|----------------------------------------------------|
| `acp/`           | Agent Communication Protocol                       |
| `agent/`         | Agent lifecycle and orchestration                   |
| `agent-ergonomy/`| TUI interaction patterns and agent UX               |
| `auth/`          | Authentication and credential handling              |
| `cli/tui/`       | TUI components (dialog, keybind, layout)            |
| `compat/`        | Backward compatibility shims                        |
| `config/`        | Configuration loading, hold mode, settings          |
| `file/`          | File operations, ripgrep integration                |
| `format/`        | Output formatting                                   |
| `gateway/`       | Gateway server and routing                          |
| `ide/`           | IDE integration (LSP bridge, etc.)                  |
| `integration/`   | Cross-cutting integration tests                     |
| `lsp/`           | Language Server Protocol                            |
| `mcp/`           | Model Context Protocol                              |
| `patch/`         | Patch/diff application                              |
| `permission/`    | Permission system and policies                      |
| `plugin/`        | Plugin loading and lifecycle                        |
| `project/`       | Project detection and instance management           |
| `provider/`      | LLM provider adapters and transforms                |
| `question/`      | User question/prompt handling                       |
| `security/`      | Security policies and sandboxing                    |
| `server/`        | HTTP server and API routes                          |
| `session/`       | Session management, compaction, messages            |
| `skill/`         | Skill loading and execution                         |
| `snapshot/`      | Snapshot/checkpoint system                          |
| `tool/`          | Tool definitions and execution                      |
| `util/`          | Shared utilities                                    |
| `web/`           | Web-related functionality                           |
| `wiring/`        | Dependency wiring and initialization                |

Root-level test files cover cross-cutting concerns:
- `keybind.test.ts` -- Keybinding resolution
- `dictation.test.ts` -- Voice dictation
- `scheduler.test.ts` -- Cron/scheduler
- `permission-task.test.ts` -- Permission task integration
- `vim-mode-switching.integration.test.ts` -- Vim mode

## Shared Infrastructure

- **`fixture/fixture.ts`** -- `tmpdir()` for isolated temp directories (auto-cleanup)
- **`mock/`** -- Mock providers (`llm-provider.ts`, `whatsapp-api.ts`)
- **`preload.ts`** -- Runs before every test file (configured in `bunfig.toml`). Sets up isolated XDG dirs, clears API keys, resets global state after each test. No import needed.

## Running Tests

```bash
# All tests
bun test

# Single directory
bun test test/session/

# Single file
bun test test/session/compaction.test.ts

# Pattern match
bun test --grep "hold mode"

# With coverage
bun test --coverage
```
