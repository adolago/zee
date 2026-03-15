# Gateway WS Control Plane

Zee includes an optional **Gateway**: a WebSocket (WS) control plane designed for channel integrations (WhatsApp, etc) and remote clients.

Primary web operator guidance: `docs/architecture/control-ui-primary.md`.
Explicit HTTP operator scope assignments: `docs/architecture/control-plane-scope-matrix.md`.

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

## Control UI Auth Guardrails

Control UI auth defaults should remain strict:

- `gateway.controlUi.auth.required: true`
- `gateway.controlUi.auth.mode: "token"`
- `gateway.controlUi.auth.allowPasswordOnly: false`
- `gateway.controlUi.auth.allowInsecureHttp: false`

Recommended config baseline:

```jsonc
{
  "gateway": {
    "controlUi": {
      "auth": {
        "required": true,
        "mode": "token",
        "allowPasswordOnly": false,
        "allowInsecureHttp": false
      },
      "trustedOrigins": ["https://control.example.com"]
    }
  }
}
```

Dangerous downgrade settings (`mode: "none"`, `allowPasswordOnly`, `allowInsecureHttp`) require explicit break-glass acknowledgement:

- config: `gateway.controlUi.auth.breakGlassAck`
- env: `ZEE_CONTROL_UI_BREAK_GLASS_ACK`
- required value: `I_UNDERSTAND_CONTROL_UI_AUTH_IS_INSECURE`

Audit commands:

```bash
zee security audit
zee security audit --deep --strict
zee doctor security
zee doctor security --deep --strict
```

Header semantics:

- token mode: use `Authorization: Bearer <token>` or `X-Zee-Token: <token>` for browser-originated Control UI requests.
- password downgrade: Basic auth is only accepted for browser-originated Control UI requests when `mode: "password"` or `allowPasswordOnly: true`.
- denial challenge follows policy:
  - token mode returns `WWW-Authenticate: Bearer realm="zee"`
  - password mode returns `WWW-Authenticate: Basic realm="zee"`

For non-loopback deployments, terminate TLS at a reverse proxy and keep `trustedOrigins` explicit.

Deep audit operator checks:

- paired-node exposure: active paired nodes while `gateway.nodeClient.enabled=false`
- policy drift: active paired nodes above `maxPairedNodes` or while `securityMode=full`
- state integrity: unknown node statuses, missing token hashes, duplicate token hashes
- audit trail completeness: active nodes missing `lastSeenAt`, revoked nodes missing `revokedAt` or `revokeReason`

Audit telemetry:

- `security.audit.checked`: summary event with error/warning totals plus paired-node metrics
- `security.audit.finding`: one event per audit finding code for downstream dashboards or release gates

## Telegram Channel-Native Action Pack

Zee now ships a non-WhatsApp channel-native action pack for Telegram with per-category policy toggles:

- `gateway.actionPacks.telegram.messageActions`
- `gateway.actionPacks.telegram.metadataActions`
- `gateway.actionPacks.telegram.moderationActions`

Example policy config:

```jsonc
{
  "gateway": {
    "actionPacks": {
      "telegram": {
        "enabled": true,
        "messageActions": true,
        "metadataActions": true,
        "moderationActions": false
      }
    }
  }
}
```

Action endpoints:

- `POST /gateway/telegram/send`
- `POST /gateway/telegram/metadata/chat`
- `POST /gateway/telegram/moderation/delete`

Security notes:

- moderation actions are intended for tightly controlled operator use.
- run `zee security audit` or `zee doctor security` to surface risky action-pack exposures.
