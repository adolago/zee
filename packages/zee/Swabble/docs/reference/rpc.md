---
read_when:
  - Adding or changing external CLI integrations
---
# RPC adapters

Zee integrates external CLIs via JSON-RPC. Two patterns are used today.

## Pattern A: HTTP daemon (JSON-RPC)
- External CLI runs as a daemon with JSON-RPC over HTTP.
- Event stream can be SSE for inbound updates.
- Health probes are HTTP endpoints.
- Zee can own lifecycle when the provider is enabled.

## Pattern B: stdio JSON-RPC
- JSON-RPC is line-delimited over stdin/stdout (one JSON object per line).
- No TCP port and no daemon required.


## Adapter guidelines
- Gateway owns the process (start/stop tied to provider lifecycle).
- Keep RPC clients resilient: timeouts, restart on exit.
- Prefer stable IDs (e.g., `chat_id`) over display strings.
