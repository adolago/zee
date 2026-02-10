# zee-core

The core CLI + daemon that powers Zee's persona system (Zee, Stanley, Johny).

- **Version:** 0.2.0-alpha
- **Prebuilt targets:** Linux x64
- **Other platforms:** build from source

## Install from source

```bash
git clone https://github.com/adolago/zee.git
cd zee

bun install
cd packages/zee-core
bun run build

ln -sf ~/.local/src/zee/packages/zee-core/dist/@zee/core-linux-x64/bin/zee ~/.bun/bin/zee
```

## Configure

Zee reads JSONC config from `~/.config/zee/zee.jsonc` or `.zee/zee.jsonc`.
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
zee
zee --no-daemon
zee daemon --hostname 127.0.0.1 --port 3210
```

## Benchmark

```bash
cd packages/zee-core
bun run bench --durationSeconds 10 --seedCount 500 --concurrency 5
```

- Writes JSON reports to `output/bench/<timestamp>.json`
- Memory benches require Qdrant at `QDRANT_URL` (default: `http://localhost:6333`)
- Inference bench uses your configured provider/model and measures streaming latency/throughput (FlashAttention is server-side; validate via throughput metrics)
- Bench disables config dependency installation (`ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL=1`) to avoid mutating your config dirs
