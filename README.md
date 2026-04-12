# Zee

[![Version](https://img.shields.io/npm/v/%40adolago%2Fzee?style=flat-square)](https://www.npmjs.com/package/@adolago/zee)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

Zee is a unified CLI agent engine for life admin, investing, and learning. Semantic memory, tool orchestration, and multi-surface support across the TUI, daemon APIs, OpenBB Workspace, and messaging channels.

## Release

- **Version:** see `zee --version`
- **Prebuilt targets:** Linux x64, macOS x64/arm64, and Windows x64
- **Other platforms:** build from source

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) satisfying the package `engines.bun` range
- [OpenBB Platform API](https://docs.openbb.co/platform/developer_guide/api) for investing workflows (`http://127.0.0.1:6900` by default or `ZEE_OPENBB_API_URL`)
- API key for your model provider (Anthropic, OpenAI, Google, etc.)

### Install (npm)

```bash
npm install -g @adolago/zee
# or nightly builds
npm install -g @adolago/zee@nightly
```

### Install (script)

```bash
curl -fsSL https://raw.githubusercontent.com/adolago/zee/main/install | ZEE_NPM_PACKAGE=@adolago/zee bash
```

### Install from source

```bash
# Clone the repository
git clone https://github.com/adolago/zee.git
cd zee

# Install dependencies
bun install

# Build the native local binary and link the local launcher
cd packages/zee
bun run build
bun run verify:binary
```

### OpenBB setup

For investing workflows and the OpenBB copilot surface, point Zee at an OpenBB Platform API instance:

```bash
export ZEE_OPENBB_API_URL=http://127.0.0.1:6900
# optional if you use a custom launcher name/path
export ZEE_OPENBB_API_CMD=openbb-api
```

To create a local finance workspace with local memory and OpenBB provider setup prompts:

```bash
zee onboard --profile dcm --openbb-mode remote --acquire-keys
```

Provider keys can also be acquired one at a time:

```bash
zee auth acquire fred
zee auth acquire polygon
```

### Configuration

Zee reads JSONC config from `~/.config/zee/zee.jsonc` or `.zee/zee.jsonc`.
Environment variables are used only for secrets and explicit path overrides.

For a step-by-step guide to local `.env` setup, OAuth flows, and live service dependencies, see `docs/integrations/README.md`.

#### Paths and overrides

Defaults follow XDG:

- Config: `~/.config/zee`
- Data: `~/.local/share/zee`
- Cache: `~/.cache/zee`
- State: `~/.local/state/zee`
- Workspace (default worktree): `~/.local/share/zee/worktree`

To co-locate everything under a single state root, set `ZEE_STATE_DIR`.
This makes config/data/cache/logs/workspace resolve under that directory as `config/`, `data/`, `cache/`, `logs/`,
and `workspace/`.

To override only the workspace location, set `ZEE_WORKSPACE_DIR`.

Use `zee paths` to print the resolved locations.

Zee installs with local SQLite memory and local embeddings enabled. Package installation, `zee setup`, `zee onboard`, and `zee daemon-install` all prepare the local memory runtime.

```jsonc
{
  "memory": {
    "backend": "sqlite",
    "embedding": {
      "provider": "local"
    },
    "localIndex": {
      "enabled": true,
      "backend": "sqlite-fts",
      "degradedRead": "keyword_only"
    }
  },
}
```

Inspect or repair local memory:

```bash
zee memory status
zee memory prepare

export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."     # Optional if using `zee auth login openai`
export GEMINI_API_KEY="..."     # Optional if using `zee auth login google`
```

Optional: Google Antigravity (plugin-based OAuth):

```bash
zee auth login google-antigravity
```

Memory embeddings are local-only by default.

### Running

**Interactive TUI (attaches to a running daemon):**

```bash
zee
zee --no-daemon   # run without the daemon (local worker only)
```

Ensure the daemon is running first (systemd service recommended for always-on messaging).
See `docs/tui-vim-mode.md` for Vim keybindings.

**Daemon mode (gateway embedded):**

```bash
zee daemon --hostname 127.0.0.1 --port 3210
```

**Remote client/server (explicit):**

```bash
# On the server
zee daemon --hostname 0.0.0.0 --port 3210

# On the client machine
zee client http://server:3210
# or:
ZEE_URL=http://server:3210 zee
```

**OpenBB Workspace copilot:**

```bash
zee daemon --hostname 127.0.0.1 --port 3210
```

Then configure OpenBB Workspace to use Zee at:

- agent metadata: `http://127.0.0.1:3210/openbb/agents.json`
- query endpoint: `http://127.0.0.1:3210/openbb/query`
- auth: `Authorization: Bearer $ZEE_SERVER_PASSWORD` or `X-Zee-Token: $ZEE_SERVER_PASSWORD`

**Gateway control plane helpers:**

```bash
zee gateway status
zee gateway url
```

## Architecture

```
zee/
├── packages/zee/    # Main CLI/TUI/daemon
├── src/
│   ├── agent/              # Assistant profiles and wiring
│   ├── memory/             # Local SQLite memory with vector and FTS search
│   └── domain/             # Domain tools (zee/, learning/)
└── .agents/skills/         # Skills
```

### Assistant Model

Zee is the only active assistant. The engine still exposes domain toolsets under namespaces:

- `zee:*` for life admin
- `zee:invest-*` for investing
- `zee:learn-*` for learning

### Key Features

- **Memory**: Local SQLite memory with local embeddings, vector search, and FTS keyword fallback
- **Single Assistant Runtime**: No assistant switching or delegation required
- **Embedded Gateway**: Zee messaging gateway launched and supervised by the daemon

## Usage with Zee Gateway

The Zee gateway is always embedded and supervised by the daemon:

```bash
zee daemon --hostname 127.0.0.1 --port 3210
```

For always-on messaging at boot, install the systemd service:

```bash
sudo ./scripts/systemd/install.sh --polkit --systemd-only
sudo systemctl enable zee
sudo systemctl start zee
```

The install script will prompt for sudo if needed. With `--polkit`, you can run start/stop/restart and enable/disable without sudo:

```bash
systemctl restart zee
systemctl enable zee
```

The systemd unit disables `ProtectHome` so the daemon can read/write projects in any directory under your home.

The `--systemd-only` flag writes `daemon.systemd_only=true` to enforce a systemd-only policy.

## Development

```bash
# Typecheck
bun run typecheck

# Core tests
cd packages/zee && bun test

# Build + verify binary
cd packages/zee && bun run build && bun run verify:binary
```

## Wide events

Zee emits wide event JSONL logs for per-request diagnostics:

```bash
zee logs wide --lines 50
zee logs wide --where sessionId=session_123
```

## Acknowledgements

See `CREDITS.md` for upstream projects and forks.

## License

See `LICENSE`.
