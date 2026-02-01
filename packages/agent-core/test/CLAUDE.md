# Test Directory -- Agent Instructions

- After modifying source in `src/X/`, always run `bun test test/X/` to verify.
- Before writing a new test, check `test/fixture/` and `test/mock/` for existing helpers.
- Integration tests go in `test/integration/`, not alongside unit tests.
- Use `tmpdir()` from `test/fixture/fixture.ts` for filesystem isolation. Never write to real paths.
- Import from `bun:test` (`describe`, `test`, `expect`, `beforeEach`, `afterEach`).
- `test/preload.ts` runs automatically before every test file (sets up isolated XDG dirs, clears API keys, resets global state). Do not import it manually.
- Use mocks from `test/mock/` for LLM providers and channel APIs. Never make real API calls in unit tests.
- Test file naming: `<feature>.test.ts`, placed in the directory matching the source domain.
- One behavior per test, descriptive test names.
