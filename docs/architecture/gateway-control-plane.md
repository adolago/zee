# Gateway WS Control Plane

Zee includes an optional **Gateway**: a WebSocket (WS) control plane designed for channel integrations (WhatsApp, etc) and remote clients.

At a high level:

- **Zee server/daemon** runs the agent runtime and exposes an HTTP API.
- **Zee Gateway** exposes a WS RPC API for channels/tools/events and is typically embedded and supervised by the daemon.
- Server routes can bridge some gateway WS methods to HTTP for browser/web clients.

## Where It Lives

- Gateway runtime (server + methods): `packages/zee/Swabble/src/gateway/`
- Embedded gateway wiring: `packages/zee/src/gateway/embedded-gateway.ts`
- Server REST bridge (HTTP -> WS): `packages/zee/src/server/route/gateway.ts`
- CLI helpers: `packages/zee/src/cli/cmd/gateway/`

## CLI

Common commands:

```bash
zee gateway status
zee gateway url
zee gateway token
```

To run a foreground gateway process (mostly for debugging):

```bash
zee gateway start
```

## Auth Notes

Gateway connections can be authenticated via:

- `ZEE_GATEWAY_TOKEN` (preferred) or a local token file (see `ZEE_GATEWAY_TOKEN_FILE`)
- `ZEE_GATEWAY_PASSWORD` (alternative)

The CLI never prints the token unless you pass `--print`:

```bash
zee gateway token --print
```

