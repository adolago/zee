# Node Client (macOS-first) Architecture

This document captures the reference node-client product path introduced for gateway pairing.

## Scope delivered
- Persistent pairing registry at `~/.local/state/zee/gateway-node-clients.json`
- API lifecycle:
  - `POST /gateway/node/pair`
  - `POST /gateway/node/reconnect`
  - `POST /gateway/node/revoke`
  - `POST /gateway/node/tool/authorize`
  - `GET /gateway/node`
- Policy model in config:
  - `gateway.nodeClient.enabled`
  - `gateway.nodeClient.securityMode` (`deny`, `allowlist`, `full`)
  - `gateway.nodeClient.allowRemotePairing`
  - `gateway.nodeClient.toolAllowlist`
  - `gateway.nodeClient.maxPairedNodes`

## Security behavior
- Pairing is blocked when `gateway.nodeClient.enabled=false`.
- On non-loopback server bind, pairing requires `allowRemotePairing=true`.
- Tokens are stored hashed (SHA-256), never in plaintext.
- Revoked nodes cannot reconnect or authorize tools.
- Tool authorization enforces policy mode:
  - `deny`: always deny
  - `allowlist`: require tool in merged allowlist (global + node-local)
  - `full`: allow all tools (flagged by security audit)

## Audit integration
- `zee security audit --deep` and `zee doctor security --deep` now include:
  - config-level node-client exposure checks
  - state-level checks on active/revoked pair counts and policy mismatch

## Follow-up hooks (iOS/Android)
- Data model keeps `platform` as `macos|ios|android|linux|windows|unknown`.
- Current delivery is macOS-first, with route and registry contracts ready for mobile node clients.
