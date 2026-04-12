# Node Exposure Incident Runbook

Use this runbook when `zee security audit --deep --strict` or `zee doctor security --deep --strict` surfaces node exposure drift alerts.

## Alert classes

- `node_client_exposure_feature_disabled`
  - Active paired nodes still exist while `gateway.nodeClient.enabled=false`.
- `node_client_exposure_limit_drift`
  - Active paired nodes exceed `gateway.nodeClient.maxPairedNodes`.
- `node_client_exposure_full_mode`
  - Active paired nodes are operating while `gateway.nodeClient.securityMode=full`.

## Immediate response

1. Run `zee security audit --deep --strict` and capture the current alert payload.
2. Inspect paired node inventory via `GET /gateway/node?includeRevoked=true` from an authenticated operator session.
3. Compare the active node list with the approved operator/device inventory.

## Containment actions

1. Revoke stale or unapproved nodes with `POST /gateway/node/revoke`.
2. If policy drift is configuration-driven, restore the intended `gateway.nodeClient` policy before reauthorizing any node.
3. After downgrading from `securityMode=full`, rotate every active node credential with `POST /gateway/node/rotate`.

## Recovery

1. Re-run `zee doctor security --deep --strict` until the alert set is empty.
2. Confirm `gateway.node.authorization` diagnostics shows only expected allow/deny decisions after the incident.
3. Record the remediation outcome in the operator incident log with the final audit output.
