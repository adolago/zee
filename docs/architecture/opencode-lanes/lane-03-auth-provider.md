# OpenCode Lane 03: Auth/Provider Plugin Parity

Tracking issue: `adolago/zee#288`

## Scope

- Compare auth and provider plugin surfaces between Zee and OpenCode.
- Make explicit `port` / `adapt` / `defer` / `non-goal` decisions per delta.
- Define migration guidance targets for users moving from OpenCode to Zee.

## Delta Table

| Delta item | Zee status | OpenCode status | Decision | Rationale | Upstream reference |
| --- | --- | --- | --- | --- | --- |
| Provider package breadth (`@ai-sdk/*` diversity) | Curated/smaller provider set in `packages/zee` | Broad provider package set in OpenCode monorepo | adapt | Preserve Zee reliability and support burden constraints while reducing migration friction for common providers. | `docs/architecture/upstream-differences.md` (Providers/model backends) |
| OAuth subscription-first login flow ergonomics | Partial support (less prescriptive UX) | Stronger subscription/OAuth-first messaging in ecosystem docs | adapt | Keep Zee auth model but improve user-facing profile rotation and onboarding guidance. | `docs/architecture/feature-comparison.md` (`model.oauth-subscriptions`) |
| Extension/plugin auth bootstrap conventions | Zee plugin/skills model differs from OpenCode extension model | OpenCode extension conventions are product-specific | non-goal | Avoid coupling Zee to OpenCode extension internals; maintain Zee-native skill/plugin lifecycle. | `docs/architecture/feature-comparison.md` (`platform.extensions`) |
| Config naming and migration from `.opencode/` provider defaults | Zee uses `.zee/` + Zee config shapes | OpenCode uses `.opencode/` config defaults | port | Straightforward migration-documentation and mapping improvements reduce setup friction without architecture risk. | `docs/architecture/upstream-differences.md` (Config and state model) |
| Auth secret handling defaults and operator guidance | Mixed env/config references and auth commands | OpenCode workflows vary by provider, often key-based | adapt | Strengthen Zee docs and command flow so secret handling defaults are explicit and recoverable. | `docs/architecture/feature-comparison.md` (`model.auth-profiles`) |

## Migration Guidance Targets

1. Publish an OpenCode-to-Zee auth/provider migration page with:
   - provider ID mapping table
   - `.opencode/` to `.zee/` key mapping
   - recommended Zee auth profile order and fallback behavior
2. Add command-level examples for:
   - subscription/OAuth-first onboarding
   - API key fallback onboarding
   - safe profile rotation and revocation handling

## Concrete Implementation Candidate

### Candidate A: `zee auth import-opencode` (implemented first slice 2026-02-25)

- Owner: `@adolago`
- Decision type: `adapt` (Zee-native interface with OpenCode-aware migration)
- Candidate behavior:
  - read `.opencode/opencode.jsonc` in a project
  - map recognized provider/auth defaults into `.zee/` project config
  - emit a migration report showing mapped, skipped, and non-goal keys
- Current implementation slice:
  - command added: `zee auth import-opencode [file] [--dry-run]`
  - supported mappings: provider/auth API keys, OAuth token blobs, provider base URLs, `models.url`, `models.path`, `server.mdns`, `server.mdnsDomain`
  - test coverage: `packages/zee/test/cli/auth-import-opencode.test.ts`
  - current gap: broader OpenCode-only key mapping and richer unknown-key remediation hints
- Minimum test scope:
  - unit tests for mapping rules and unknown-key handling
  - integration test with fixture `.opencode/opencode.jsonc` -> generated `.zee/*`
  - CLI acceptance test: import command exits non-zero on invalid config and shows actionable diagnostics

## Acceptance Checklist

- [x] Delta table with explicit decisions and upstream refs
- [x] Zee decision recorded for each tracked item
- [x] Concrete implementation candidate defined with owner and test scope
- [x] First executable migration slice implemented and fixture-tested
