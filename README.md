# Zee

[![Version](https://img.shields.io/npm/v/%40zee%2Fzee?style=flat-square)](https://www.npmjs.com/package/@zee/zee)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

Zee is a unified CLI agent engine for life admin, investing, and learning. Semantic memory, tool orchestration, multi-surface support (CLI, Web, WhatsApp).

## Release

- **Version:** see `zee --version`
- **Prebuilt targets:** Linux x64
- **Other platforms:** build from source

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- [Qdrant](https://qdrant.tech) (local) for semantic memory
- API key for your model provider (Anthropic, OpenAI, Google, etc.)

### Install (npm)

```bash
npm install -g @zee/zee
# or nightly builds
npm install -g @zee/zee@nightly
```

### Install (script)

```bash
curl -fsSL https://raw.githubusercontent.com/adolago/zee/main/install | bash
```

### Install from source

```bash
# Clone the repository
git clone https://github.com/adolago/zee.git
cd zee

# Install dependencies
bun install

# Build the project
cd packages/zee
bun run build

# Link the binary
ln -sf ~/.local/src/zee/packages/zee/dist/@zee/zee-linux-x64/bin/zee ~/.bun/bin/zee
```

### Install Stanley (optional, for investing features)

Stanley is the investing persona. Install it from GitHub:

```bash
# Clone Stanley
git clone https://github.com/adolago/stanley ~/.local/src/stanley
cd ~/.local/src/stanley

# Install Python dependencies
pip install -e .
# Or with all optional dependencies:
pip install -e ".[all]"

# Set environment variable
export STANLEY_REPO=~/.local/src/stanley
```

Add to your shell profile (`~/.bashrc` or `~/.zshrc`):
```bash
export STANLEY_REPO=~/.local/src/stanley
```

### Configuration

Zee reads JSONC config from `~/.config/zee/zee.jsonc` or `.zee/zee.jsonc`.
Environment variables are used only for secrets (Qdrant settings are config-only).

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

Example memory + embeddings configuration:

```jsonc
{
  "memory": {
    "qdrant": {
      "url": "http://localhost:6333",
      "collection": "personas_memory"
    },
    "embedding": {
      "profile": "google/gemini-embedding-001",
      "dimensions": 3072
    }
  }
}
```

Configure Google embeddings credentials (single source of truth):

```bash
zee auth login google

export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."     # Optional if using `zee auth login openai`
export VOYAGE_API_KEY="..."     # Optional (Voyage reranking)
```

Optional: Google Antigravity (plugin-based OAuth):

```bash
zee plugin install opencode-google-auth
zee auth login
```

Select **Google** when prompted.

Start Qdrant (if running locally):

```bash
docker run -p 6333:6333 qdrant/qdrant
```

### Embedding profiles

Common profiles you can set in `memory.embedding.profile`:

- `google/gemini-embedding-001` (3072 dims, recommended)

Zee supports Google-only embeddings. You can also override with `model`, `dimensions`, and `baseUrl`.

Keep Qdrant collection dimensions aligned with your embedding dimensions by setting
`memory.embedding.dimensions` to the same value as your collection vectors.

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
│   ├── personas/           # Persona logic and routing
│   ├── memory/             # Qdrant semantic memory
│   └── domain/             # Domain tools (zee/, stanley/)
└── .agents/skills/         # Skills
```

### Persona Model

Zee is the only active persona. The engine still exposes domain toolsets under namespaces:

- `zee:*` for life admin
- `stanley:*` for investing
- `johny:*` for learning

### Key Features

- **Semantic Memory**: Vector-based memory with Qdrant for context persistence
- **Single Persona Runtime**: No persona switching or delegation required
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
cd packages/zee && bun run build && ./script/verify-binary.sh
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
