# Zee Test Directory

## Framework

Zee uses **Vitest** (not Bun test). Configuration is in `vitest.config.ts` at the package root.

## Running Tests

```bash
# All tests
bun test

# Single file
npx vitest run src/channels/plugins/types.core.test.ts

# Watch mode
npx vitest

# With coverage
npx vitest run --coverage
```

## Test Layout

- Unit tests are colocated with source: `src/**/*.test.ts`
- Extension tests: `extensions/**/*.test.ts`
- E2E tests (excluded by default): `**/*.e2e.test.ts`
- Live tests (excluded by default, require `ZEE_LIVE_TEST=1`): `**/*.live.test.ts`
- Integration-level tests: `test/` directory (e.g., `test/inbound-contract.providers.test.ts`)

## Coverage Thresholds

Enforced in `vitest.config.ts`:
- Lines: 70%
- Functions: 70%
- Branches: 55%
- Statements: 70%

## Test Infrastructure

- **`test/setup.ts`** -- Global setup file (loaded via `setupFiles` in vitest config)
- **`test/global-setup.ts`** -- Vitest global setup
- **`test/test-env.ts`** -- Test environment configuration
- **`test/helpers/`** -- Shared test helpers
- **`test/mocks/`** -- Mock implementations
- **`test/fixtures/`** -- Test fixtures and sample data
