---
summary: "Step-by-step release checklist for npm releases"
read_when:
  - Cutting a new npm release
  - Verifying metadata before publishing
---

# Release Checklist (npm)

Use `pnpm` (Node 22+) from the repo root. Keep the working tree clean before tagging/publishing.

## Operator trigger
When the operator says “release”, immediately do this preflight (no extra questions unless blocked):
- Read this doc.

1) **Version & metadata**
- [ ] Bump `package.json` version (e.g., `2026.1.27-beta.1`).
- [ ] Run `pnpm plugins:sync` to align extension package versions + changelogs.
- [ ] Update CLI/version strings: [`src/cli/program.ts`](https://github.com/zee/zee/blob/main/src/cli/program.ts) and the Baileys user agent in [`src/provider-web.ts`](https://github.com/zee/zee/blob/main/src/provider-web.ts).
- [ ] Confirm package metadata (name, description, repository, keywords, license) and `bin` map points to [`zee.mjs`](https://github.com/zee/zee/blob/main/zee.mjs) for `zee`.
- [ ] If dependencies changed, run `pnpm install` so `pnpm-lock.yaml` is current.

2) **Build & artifacts**
- [ ] If A2UI inputs changed, run `pnpm canvas:a2ui:bundle` and commit any updated [`src/canvas-host/a2ui/a2ui.bundle.js`](https://github.com/zee/zee/blob/main/src/canvas-host/a2ui/a2ui.bundle.js).
- [ ] `pnpm run build` (regenerates `dist/`).
- [ ] Verify npm package `files` includes all required `dist/*` folders (notably `dist/node-host/**` and `dist/acp/**` for headless node + ACP CLI).
- [ ] Confirm `dist/build-info.json` exists and includes the expected `commit` hash (CLI banner uses this for npm installs).
- [ ] Optional: `npm pack --pack-destination /tmp` after the build; inspect the tarball contents and keep it handy for the GitHub release (do **not** commit it).

3) **Changelog & docs**
- [ ] Update `CHANGELOG.md` with user-facing highlights (create the file if missing); keep entries strictly descending by version.
- [ ] Ensure README examples/flags match current CLI behavior (notably new commands or options).

4) **Validation**
- [ ] `pnpm lint`
- [ ] `pnpm test` (or `pnpm test:coverage` if you need coverage output)
- [ ] `pnpm run build` (last sanity check after tests)
- [ ] `pnpm release:check` (verifies npm pack contents)
- [ ] `ZEE_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke` (Docker install smoke test, fast path; required before release)
  - If the immediate previous npm release is known broken, set `ZEE_INSTALL_SMOKE_PREVIOUS=<last-good-version>` or `ZEE_INSTALL_SMOKE_SKIP_PREVIOUS=1` for the preinstall step.
- [ ] (Optional) Full installer smoke (adds non-root + CLI coverage): `pnpm test:install:smoke`
- [ ] (Optional) Installer E2E (Docker, runs `curl -fsSL https://zee-bot.com/install.sh | bash`, onboards, then runs real tool calls):
  - `pnpm test:install:e2e:openai` (requires `OPENAI_API_KEY`)
  - `pnpm test:install:e2e:anthropic` (requires `ANTHROPIC_API_KEY`)
  - `pnpm test:install:e2e` (requires both keys; runs both providers)
- [ ] (Optional) Spot-check the web gateway if your changes affect send/receive paths.

5) **Publish (npm)**
- [ ] Confirm git status is clean; commit and push as needed.
- [ ] `npm login` (verify 2FA) if needed.
- [ ] `npm publish --access public` (use `--tag beta` for pre-releases).
- [ ] Verify the registry: `npm view zee version`, `npm view zee dist-tags`, and `npx -y zee@X.Y.Z --version` (or `--help`).

### Troubleshooting (notes from 2.0.0-beta2 release)
- **npm auth web loop for dist-tags**: use legacy auth to get an OTP prompt:
  - `NPM_CONFIG_AUTH_TYPE=legacy npm dist-tag add zee@X.Y.Z latest`
- **`npx` verification fails with `ECOMPROMISED: Lock compromised`**: retry with a fresh cache:
  - `NPM_CONFIG_CACHE=/tmp/npm-cache-$(date +%s) npx -y zee@X.Y.Z --version`
- **Tag needs repointing after a late fix**: force-update and push the tag, then ensure the GitHub release assets still match:
  - `git tag -f vX.Y.Z && git push -f origin vX.Y.Z`

6) **GitHub release**
- [ ] Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (or `git push --tags`).
- [ ] Create/refresh the GitHub release for `vX.Y.Z` with **title `zee X.Y.Z`** (not just the tag); body should include the **full** changelog section for that version (Highlights + Changes + Fixes), inline (no bare links), and **must not repeat the title inside the body**.
- [ ] Attach artifacts: `npm pack` tarball (optional).
- [ ] From a clean temp directory (no `package.json`), run `npx -y zee@X.Y.Z send --help` to confirm install/CLI entrypoints work.
- [ ] Announce/share release notes.

## Plugin publish scope (npm)

We only publish **existing npm plugins** under the `@zee/*` scope. Bundled
plugins that are not on npm stay **disk-tree only** (still shipped in
`extensions/**`).

Process to derive the list:
1) `npm search @zee --json` and capture the package names.
2) Compare with `extensions/*/package.json` names.
3) Publish only the **intersection** (already on npm).

Current npm plugin list (update as needed):
- @zee/diagnostics-otel
- @zee/lobster
- @zee/voice-call

Release notes must also call out **new optional bundled plugins** that are **not
on by default**.
