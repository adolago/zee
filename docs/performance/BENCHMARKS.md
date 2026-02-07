# Benchmarks

Baseline commit (pinned for comparison):

- `b6c41c6c84` (origin/dev at the start of `fix/issue-207-release-0.3.0`)

These benchmarks are opt-in scripts intended for release verification and regression tracking.

## Tool Read (Bounded)

Measures the bounded line reader used by `tool.read`.

```bash
cd packages/agent-core
bun ./script/bench/read-lines-bounded.ts --size-mb 50 --max-bytes 262144 --limit 200
```

Record:
- time (ms)
- rss delta (bytes)
- bytesRead/bytesEmitted

## SSE Connection Overhead

Measures time to establish N SSE connections to the daemon.

Prereq: daemon running locally (default `http://127.0.0.1:3210`).

```bash
cd packages/agent-core
bun ./script/bench/sse-connect.ts --url http://127.0.0.1:3210 --path /event --n 32 --duration-ms 5000
```

Record:
- connect time (ms)
- ok/fail counts (should respect server SSE limits)

