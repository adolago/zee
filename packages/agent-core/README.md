# agent-core

Agent-core is a CLI + daemon that powers the Personas system (Zee, Stanley, Johny).

- **Version:** v0.1.0-20260114
- **Prebuilt targets:** Linux x64
- **Other platforms:** build from source

## Install

```bash
npm install -g @adolago/agent-core@0.1.0-20260114
```

## Configure

Agent-core reads JSONC config from `~/.config/agent-core/agent-core.jsonc` or `.agent-core/agent-core.jsonc`.
Environment variables are used only for secrets.

Minimal memory configuration:

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

## Run

```bash
agent-core
agent-core --no-daemon
agent-core daemon --hostname 127.0.0.1 --port 3210
```

## Benchmark

```bash
cd packages/agent-core
bun run bench --durationSeconds 10 --seedCount 500 --concurrency 5
```

- Writes JSON reports to `output/bench/<timestamp>.json`
- Memory benches require Qdrant at `QDRANT_URL` (default: `http://localhost:6333`)
- Inference bench uses your configured provider/model and measures streaming latency/throughput (FlashAttention is server-side; validate via throughput metrics)
- Bench disables config dependency installation (`AGENT_CORE_DISABLE_CONFIG_DEPENDENCY_INSTALL=1`) to avoid mutating your config dirs
