---
summary: "Stable, beta, and dev channels: semantics, switching, and tagging"
read_when:
  - You want to switch between stable/beta/dev
  - You are tagging or publishing prereleases
---

# Development channels

Last updated: 2026-01-21

Zee ships three update channels:

- **stable**: npm dist-tag `latest`.
- **beta**: npm dist-tag `beta` (builds under test).
- **dev**: moving head of `dev` (git). npm dist-tag: `dev` (when published).

We ship builds to **beta**, test them, then **promote a vetted build to `latest`**
without changing the version number — dist-tags are the source of truth for npm installs.

## Switching channels

Git checkout:

```bash
zee update --channel stable
zee update --channel beta
zee update --channel dev
```

- `stable`/`beta` check out the latest matching tag (often the same tag).
- `dev` switches to `dev` and rebases on `origin/dev`.

npm/pnpm global install:

```bash
zee update --channel stable
zee update --channel beta
zee update --channel dev
```

This updates via the corresponding npm dist-tag (`latest`, `beta`, `dev`).

When you **explicitly** switch channels with `--channel`, Zee also aligns
the install method:

- `dev` ensures a git checkout (default `~/zee`, override with `ZEE_GIT_DIR`),
  updates it, and installs the global CLI from that checkout.
- `stable`/`beta` installs from npm using the matching dist-tag.

Tip: if you want stable + dev in parallel, keep two clones and point your gateway at the stable one.

## Plugins and channels

When you switch channels with `zee update`, Zee also syncs plugin sources:

- `dev` prefers bundled plugins from the git checkout.
- `stable` and `beta` restore npm-installed plugin packages.

## Tagging best practices

- Tag releases you want git checkouts to land on (`vYYYY.M.D` or `vYYYY.M.D-<patch>`).
- Keep tags immutable: never move or reuse a tag.
- npm dist-tags remain the source of truth for npm installs:
  - `latest` → stable
  - `beta` → candidate build
  - `dev` → main snapshot (optional)
