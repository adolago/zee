# @zee/zee

Zee engine (CLI + daemon).

## Install

```bash
npm install -g @zee/zee
# or nightly
npm install -g @zee/zee@nightly
```

## Build From Source

```bash
git clone https://github.com/adolago/zee.git
cd zee
bun install
cd packages/zee
bun run build
cd ../..
./script/verify-binary.sh
```

If verification fails:

```bash
ln -sf ~/.local/src/zee/packages/zee/dist/@zee/zee-linux-x64/bin/zee ~/.bun/bin/zee
```

## Run

```bash
zee
zee daemon --hostname 127.0.0.1 --port 3210 --gateway
```

## Config

Zee reads config from:

- `~/.config/zee/zee.jsonc` (default user config)
- `.zee/zee.jsonc` (project-local override)

Use `~/.config/zee/daemon.env` for secrets.
