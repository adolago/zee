# ADR-010: Release & Distribution

## Status

Accepted (Implemented)

## Context

`agent-core` ships as a CLI binary plus supporting assets (themes, skills, bundled Zee gateway sources). Releases must:

- install cleanly via npm
- select the correct platform binary (linux/windows; x64/arm64; musl where applicable)
- be verifiable locally before running privileged commands

## Decision

Adopt a “wrapper + platform optionalDependencies” distribution model:

1. **Wrapper package**: `@adolago/agent-core`
   - contains the JS wrapper `bin/agent-core`
   - includes a `postinstall` that verifies the platform binary package is present
2. **Platform packages** (optionalDependencies):
   - `@adolago/agent-core-linux-x64`, `@adolago/agent-core-linux-arm64`, ...
   - contain the compiled `bin/agent-core` binary and bundled assets
3. **Deterministic dist naming** for platform packages:
   - `agent-core-<os>-<arch>[-baseline][-musl]`

Local development uses a symlinked binary:

- `packages/agent-core && bun run build` builds `dist/agent-core-linux-x64/bin/agent-core` (default)
- build also symlinks to `~/.bun/bin/agent-core`
- `./script/verify-binary.sh` ensures the symlink points at the local build

## Consequences

### Positive

- npm installs select the correct binary without requiring native compilation.
- Wrapper package remains small; platform packages contain large binaries/assets.
- Local verification reduces “testing the wrong binary” mistakes.

### Negative

- Publishing requires publishing multiple packages per release.
- Dist layout changes must update verification scripts and packaging scripts together.

## Implemented By (Evidence)

- Build + dist naming: `packages/agent-core/script/build.ts`
- Wrapper + npm publishing: `packages/agent-core/script/publish.ts`, `packages/agent-core/script/postinstall.mjs`
- Binary verification: `script/verify-binary.sh`
- Local reload tooling: `scripts/reload.sh`

