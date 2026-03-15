# Node Client (macOS-first) Architecture

This document captures the reference node-client product path introduced for gateway pairing.

## Scope delivered
- Persistent pairing registry at `~/.local/state/zee/gateway-node-clients.json`
- API lifecycle:
  - `POST /gateway/node/pair`
  - `POST /gateway/node/reconnect`
  - `POST /gateway/node/rotate`
  - `POST /gateway/node/revoke`
  - `POST /gateway/node/tool/authorize`
  - `GET /gateway/node`
- Policy model in config:
  - `gateway.nodeClient.enabled`
  - `gateway.nodeClient.securityMode` (`deny`, `allowlist`, `full`)
  - `gateway.nodeClient.allowRemotePairing`
  - `gateway.nodeClient.toolAllowlist`
  - `gateway.nodeClient.maxPairedNodes`
  - `gateway.nodeClient.credentialMaxAgeHours`

## Security behavior
- Pairing is blocked when `gateway.nodeClient.enabled=false`.
- On non-loopback server bind, pairing requires `allowRemotePairing=true`.
- Tokens are stored hashed (SHA-256), never in plaintext.
- Active node credentials expire after `credentialMaxAgeHours` and must be refreshed via `POST /gateway/node/rotate`.
- Credential rotation increments `tokenVersion` and records `tokenIssuedAt` / `tokenRotatedAt` for operator auditability.
- Revoked nodes cannot reconnect or authorize tools.
- Tool authorization enforces policy mode:
  - `deny`: always deny
  - `allowlist`: require tool in merged allowlist (global + node-local)
  - `full`: allow all tools (flagged by security audit)

## Deterministic policy matrix
| `securityMode` | Authorization result | Reason |
| --- | --- | --- |
| `deny` | deny every tool request | `Node policy is deny` |
| `allowlist` + global match | allow | `Tool is allowlisted` |
| `allowlist` + node-local match | allow | `Tool is allowlisted` |
| `allowlist` + no match | deny | `Tool is not allowlisted` |
| `full` | allow every tool request | `Node policy is full` |

## Audit integration
- `zee security audit --deep` and `zee doctor security --deep` now include:
  - config-level node-client exposure checks
  - state-level checks on active/revoked pair counts and policy mismatch
  - state integrity checks for unknown statuses, missing or duplicate token hashes
  - audit trail checks for missing `lastSeenAt`, `revokedAt`, or `revokeReason`
- Both deep-audit commands emit Flux events:
  - `security.audit.checked`
  - `security.audit.finding`
- Node lifecycle routes emit Flux `gateway.node.lifecycle` events for pair, reconnect, rotate, and revoke transitions.
- Node tool authorization emits Flux `gateway.node.authorization` events with the tool name, decision, mode, reason, and allowlist match source (`global`, `node`, `global+node`, `none`, or `policy`).

## Follow-up hooks (iOS/Android)
- Data model keeps `platform` as `macos|ios|android|linux|windows|unknown`.
- Current delivery is macOS-first, with route and registry contracts ready for mobile node clients.
