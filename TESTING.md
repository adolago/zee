# Testing

## Quick Reference

```bash
# agent-core unit/integration (Bun)
cd packages/zee-core && bun test

# agent-core single file
cd packages/zee-core && bun test test/session/compaction.test.ts

# agent-core pattern match
cd packages/zee-core && bun test --grep "hold mode"

# zee unit/integration (pnpm + Vitest)
cd packages/personas/zee && pnpm test

# app e2e
cd packages/app && npx playwright test

# typecheck
cd packages/zee-core && bun run typecheck
```

## Test Location Convention

- Tests live in `packages/zee-core/test/`, mirroring `src/` structure
- Directory name = source domain (e.g., `test/session/` tests `src/session/`)
- Loose files in `test/` root are for cross-cutting concerns (keybind, dictation, scheduler)
- Integration tests go in `test/integration/`
- TUI component tests go in `test/cli/tui/`

## When You Change Code, Run These Tests

| Source path           | Test path                    |
|-----------------------|------------------------------|
| src/session/*         | test/session/                |
| src/provider/*        | test/provider/               |
| src/config/*          | test/config/                 |
| src/server/*          | test/server/                 |
| src/cli/cmd/tui/*     | test/cli/tui/                |
| src/permission/*      | test/permission/             |
| src/skill/*           | test/skill/                  |
| src/snapshot/*        | test/snapshot/               |
| src/tool/*            | test/tool/                   |
| src/file/*            | test/file/                   |
| src/mcp/*             | test/mcp/                    |
| src/security/*        | test/security/               |
| (cross-cutting)       | test/integration/            |

## Shared Test Infrastructure

### Fixtures (`test/fixture/fixture.ts`)

- `tmpdir(opts?)` -- Creates an isolated temp directory with optional git init, config, custom setup
- Auto-cleans after test completes via `Symbol.asyncDispose`
- Use for any test that touches the filesystem

### Mocks (`test/mock/`)

- `llm-provider.ts` -- Mock LLM provider (use for any test that would otherwise call an API)
- `whatsapp-api.ts` -- WhatsApp channel mock
- `index.ts` -- Re-exports all mocks

### Preload (`test/preload.ts`)

- Runs before every test file (configured in `bunfig.toml` under `[test].preload`)
- Sets up isolated XDG dirs so tests never touch real user config
- Clears all provider API keys from the environment
- Pre-fetches `models.json` to avoid network calls during tests
- Resets global state (Instance, Config, Bus, Scheduler, etc.) after each test
- You do NOT need to import this; it runs automatically

## Writing New Tests

1. Create `test/<domain>/<feature>.test.ts`
2. Import from `bun:test` (`describe`, `test`, `expect`, `beforeEach`, `afterEach`)
3. Use `tmpdir()` from `../fixture/fixture.ts` for filesystem isolation
4. Use mocks from `../mock/` for external dependencies
5. Keep tests focused: one behavior per test, descriptive names
6. No real API calls in unit tests

## Manual / Smoke Testing

```bash
cd packages/zee-core
bun dev
```

Smoke checklist:

- TUI launches and renders without crashing
- `Ctrl+X H` toggles `HOLD`/`RELEASE` mode
- `Ctrl+T` cycles model variants (for models that define variants)
- Provider dialog accepts an API key and shows success toast
