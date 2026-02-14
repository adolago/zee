---
summary: "Bun workflow (experimental): installs and gotchas vs pnpm"
read_when:
  - You want the fastest local dev loop (bun + watch)
  - You hit Bun install/patch/lifecycle script issues
---

# Bun (experimental)

Goal: run this repo with **Bun** (optional, not recommended for the Gateway runtime)
without diverging from pnpm workflows.

Warning: Bun is **not recommended for the Gateway runtime** (channel connector bugs). Use Node for production.

## Status

- Bun is an optional local runtime for running TypeScript directly (`bun run …`, `bun --watch …`).
- `pnpm` is the default for builds and remains fully supported (and used by some docs tooling).
- Bun cannot use `pnpm-lock.yaml` and will ignore it.

## Install

Default:

```sh
bun install
```

Note: `bun.lock`/`bun.lockb` are gitignored, so there’s no repo churn either way. If you want *no lockfile writes*:

```sh
bun install --no-save
```

## Build / Test (Bun)

```sh
bun run build
bun run vitest run
```

## Bun lifecycle scripts (blocked by default)

Bun may block dependency lifecycle scripts unless explicitly trusted (`bun pm untrusted` / `bun pm trust`).
For this repo, the commonly blocked scripts are not required:

- `@whiskeysockets/baileys` `preinstall`: checks Node major >= 20 (we run Node 22+).
- `protobufjs` `postinstall`: emits warnings about incompatible version schemes (no build artifacts).

If you hit a real runtime issue that requires these scripts, trust them explicitly:

```sh
bun pm trust @whiskeysockets/baileys protobufjs
```

## Caveats

- Some workflows intentionally use `pnpm` in non-local install/release docs (for example, Docker/installer examples). For day-to-day local dev, use Bun-native commands as shown above.
