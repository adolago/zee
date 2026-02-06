# Repository Guidelines
- Repo: agent-core (origin fork). Default branch: `dev`.
- GitHub issues/comments/PR comments: use literal multiline strings or `-F - <<'EOF'` for real newlines; never embed "\\n".

## Project Structure & Module Organization
- Source code: `src/` (CLI wiring in `src/cli`, commands in `src/commands`, gateway in `src/gateway`, infra in `src/infra`, media pipeline in `src/media`).
- Tests: colocated `*.test.ts`.
- Docs: `docs/` (Mintlify). Built output lives in `dist/`.
- Plugins/extensions: `extensions/*` (workspace packages). Keep plugin-only deps in the extension `package.json`; do not add them to the root `package.json` unless core uses them.
- Plugins: install runs `npm install --omit=dev` in plugin dir; runtime deps must live in `dependencies`. Avoid `workspace:*` in `dependencies` (npm install breaks); put `zee` in `devDependencies` or `peerDependencies` instead (runtime resolves `zee/plugin-sdk` via jiti alias).
- Messaging channels: focus on WhatsApp + Matrix when refactoring routing, allowlists, pairing, command gating, onboarding, or docs.
  - Core channel docs: `docs/channels/`
  - Core channel code: `src/web` (WhatsApp web), `src/channels`, `src/routing`
  - Matrix channel plugin: `extensions/matrix`
  - Extensions (channel plugins): `extensions/*` (if present)

## Docs Linking (Mintlify)
- Docs live in `packages/personas/zee/docs` and are published via Mintlify.
- Internal doc links in `docs/**/*.md`: root-relative, no `.md`/`.mdx` (example: `[Config](/configuration)`).
- Section cross-references: use anchors on root-relative paths (example: `[Hooks](/configuration#hooks)`).
- Doc headings and anchors: avoid em dashes and apostrophes in headings because they break Mintlify anchor links.
- Docs content must be generic: no personal device names/hostnames/paths; use placeholders like `user@gateway-host` and “gateway host”.

## Build, Test, and Development Commands
- Runtime baseline: Node **22+** (keep Node + Bun paths working).
- Install deps: `pnpm install`
- Pre-commit hooks: `prek install` (runs same checks as CI)
- Also supported: `bun install` (keep `pnpm-lock.yaml` + Bun patching in sync when touching deps/patches).
- Prefer Bun for TypeScript execution (scripts, dev, tests): `bun <file.ts>` / `bunx <tool>`.
- Run CLI in dev: `pnpm zee ...` or `pnpm dev`.
- Type-check/build: `pnpm build` (tsc)
- Lint/format: `pnpm lint` (oxlint), `pnpm format` (oxfmt)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Prefer strict typing; avoid `any`.
- Formatting/linting via Oxlint and Oxfmt; run `pnpm lint` before commits.
- Add brief code comments for tricky or non-obvious logic.
- Keep files concise; extract helpers instead of “V2” copies. Use existing patterns for CLI options and dependency injection via `createDefaultDeps`.
- Naming: use **Zee** for product/app/docs headings; use `zee` for CLI command, package/binary, paths, and config keys.

## Release Channels (Naming)
- stable: tagged releases only (e.g. `vYYYY.M.D`), npm dist-tag `latest`.
- beta: prerelease tags `vYYYY.M.D-beta.N`, npm dist-tag `beta`.
- dev: moving head on `dev` (no tag; git checkout dev).

## Testing Guidelines
- Framework: Vitest with V8 coverage thresholds (70% lines/branches/functions/statements).
- Naming: match source names with `*.test.ts`; e2e in `*.e2e.test.ts`.
- Run `pnpm test` (or `pnpm test:coverage`) before pushing when you touch logic.
- Live tests (real keys): `ZEE_LIVE_TEST=1 pnpm test:live` (gateway + providers) or `LIVE=1 pnpm test:live` (includes provider live tests). Docker: `pnpm test:docker:live-models`, `pnpm test:docker:live-gateway`. Onboarding Docker E2E: `pnpm test:docker:onboard`.
- Full kit + what’s covered: `docs/testing.md`.
- Pure test additions/fixes generally do **not** need a changelog entry unless they alter user-facing behavior or the user asks for one.

## Security & Configuration Tips
- Web provider stores creds at `~/.zee/credentials/`; rerun `zee login` if logged out.
- Pi sessions live under `~/.zee/sessions/` by default; the base directory is not configurable.
- Never commit or publish real phone numbers, videos, or live configuration values. Use obviously fake placeholders in docs, tests, and examples.
- Release flow: always read `docs/reference/RELEASING.md` before any release work; do not ask routine questions once those docs answer them.

## Troubleshooting
- Rebrand/migration issues or legacy config/service warnings: run `zee doctor` (see `docs/gateway/doctor.md`).

## Agent-Specific Notes
- Never edit `node_modules` (global/Homebrew/npm/git installs too). Updates overwrite. Skill notes go in `tools.md` or `AGENTS.md`.
- When working on a GitHub Issue or PR, print the full URL at the end of the task.
- When answering questions, respond with high-confidence answers only: verify in code; do not guess.
- Never update the Carbon dependency.
- Any dependency with `pnpm.patchedDependencies` must use an exact version (no `^`/`~`).
- Patching dependencies (pnpm patches, overrides, or vendored changes) requires explicit approval; do not do this by default.
- CLI progress: use `src/cli/progress.ts` (`osc-progress` + `@clack/prompts` spinner); don’t hand-roll spinners/bars.
- Status output: keep tables + ANSI-safe wrapping (`src/terminal/table.ts`); `status --all` = read-only/pasteable, `status --deep` = probes.
- Logs: check `~/.local/state/agent-core/logs/daemon.log` and `~/.local/state/agent-core/logs/daemon.err.log`.
- Connection providers: when adding a new connection, update CLI/TUI surfaces and onboarding/overview docs, and add matching status + configuration forms so provider lists and settings stay in sync.
- Version locations: `package.json` (CLI), `docs/install/updating.md` (pinned npm version).
- A2UI bundle hash: `src/canvas-host/a2ui/.bundle.hash` is auto-generated; ignore unexpected changes, and only regenerate via `pnpm canvas:a2ui:bundle` (or `scripts/bundle-a2ui.sh`) when needed. Commit the hash as a separate commit.
- Multi-agent safety: do not create/apply/drop `git stash` entries unless explicitly requested. Do not switch branches or modify worktrees unless explicitly requested.
- Lint/format churn:
  - If staged+unstaged diffs are formatting-only, auto-resolve without asking.
  - If commit/push already requested, auto-stage and include formatting-only follow-ups in the same commit (or a tiny follow-up commit if needed), no extra confirmation.
  - Only ask when changes are semantic (logic/data/behavior).
- Release guardrails: do not change version numbers without operator’s explicit consent; always ask permission before running any npm publish/release step.

