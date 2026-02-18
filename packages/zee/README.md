# @adolago/zee

Zee engine (CLI + daemon).

## Install

```bash
npm install -g @adolago/zee
# or nightly
npm install -g @adolago/zee@nightly
```

For full Stanley investing-module support, install Python 3.10-3.13 and bootstrap dependencies:

```bash
python3.12 -m venv ~/.local/share/zee/stanley/.venv
curl -fsSL https://raw.githubusercontent.com/adolago/zee/main/stanley/requirements-lock.txt | \
  ~/.local/share/zee/stanley/.venv/bin/pip install -r /dev/stdin
export STANLEY_PYTHON=~/.local/share/zee/stanley/.venv/bin/python
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
ln -sf ~/.local/src/zee/packages/zee/dist/@adolago/zee-linux-x64/bin/zee ~/.bun/bin/zee
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
