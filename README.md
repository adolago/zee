# Zee

[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

Zee is [opencode](https://github.com/sst/opencode) wrapped in [openclaw](https://github.com/openclaw/openclaw) -- a CLI agent engine for life admin, investing, and learning. Semantic memory, tool orchestration, multi-surface support (CLI, Web, WhatsApp, Matrix).

## Ecosystem

| Project | Description |
|---------|-------------|
| [**Zee**](https://github.com/adolago/zee) | CLI agent engine (this repo) |
| [**GMATE**](https://github.com/adolago/gmate) | AI-powered GMAT study platform with adaptive tutor and Socratic pedagogy |

## Release

- **Version:** 0.2.0-alpha
- **Prebuilt targets:** Linux x64
- **Other platforms:** build from source

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- [Qdrant](https://qdrant.tech) (local or cloud) for semantic memory
- API key for your model provider (Anthropic, OpenAI, Google, etc.)
- Python 3.8+ (for Stanley persona)

### Install from source

```bash
# Clone the repository
git clone https://github.com/adolago/zee.git
cd zee

# Install dependencies
bun install

# Build the project
cd packages/zee-core
bun run build

# Link the binary
ln -sf ~/.local/src/zee/packages/zee-core/dist/@zee/core-linux-x64/bin/zee ~/.bun/bin/zee
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

To co-locate everything under a single state root, set `ZEE_STATE_DIR` (legacy: `AGENT_CORE_STATE_DIR`).
This makes config/data/cache/logs/workspace resolve under that directory as `config/`, `data/`, `cache/`, `logs/`,
and `workspace/`.

To override only the workspace location, set `ZEE_WORKSPACE_DIR` (legacy: `AGENT_CORE_WORKSPACE_DIR`).

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
      "dimensions": 3072,
      "apiKey": "{env:GEMINI_API_KEY}"
    }
  }
}
```

Set secrets via environment variables:

```bash
export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."     # If using OpenAI embeddings
export GEMINI_API_KEY="..."     # If using Google Gemini embeddings
export VOYAGE_API_KEY="..."     # If using Voyage embeddings/reranking
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

- `google/gemini-embedding-001` (3072 dims, recommended) + `google/gemini-embedding-001-1536` / `-768`
- `openai/text-embedding-3-small` (1536 dims) + `openai/text-embedding-3-small-512` / `-1024`
- `openai/text-embedding-3-large` (3072 dims) + `openai/text-embedding-3-large-1024` / `-1536`
- `voyage/voyage-3-large` (1024 dims)

You can also override with `provider`, `model`, `dimensions`, `baseUrl`, and `apiKey`.

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

**Daemon mode (gateway is opt-in; development/manual use only):**

```bash
zee daemon --hostname 127.0.0.1 --port 3210
zee daemon --gateway
```

## Architecture

```
zee/
├── packages/zee-core/    # Main CLI/TUI/daemon
├── src/
│   ├── personas/           # Persona logic and routing
│   ├── memory/             # Qdrant semantic memory
│   └── domain/             # Domain tools (zee/, stanley/)
└── .claude/skills/         # Persona skill definitions
```

### Personas

| Persona     | Domain             | Description                                |
| ----------- | ------------------ | ------------------------------------------ |
| **Zee**     | Personal Assistant | Memory, messaging, calendar, notifications |
| **Stanley** | Investing          | Markets, portfolio, trading strategies     |
| **Johny**   | Learning           | Knowledge graphs, spaced repetition        |

### Key Features

- **Semantic Memory**: Vector-based memory with Qdrant for context persistence
- **Multi-Persona Routing**: Route messages to specialized personas
- **Embedded Gateway**: Optional Zee messaging gateway launched by the daemon

## Usage with Zee Gateway

The Zee gateway is launched and supervised by the daemon only when explicitly enabled:

```bash
zee daemon --gateway
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

Messages mentioning `@stanley` or `@johny` are routed to those personas; all others go to Zee.

## Development

```bash
# Run tests
bun test

# Build
bun run build

# Type check
bun run typecheck
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
