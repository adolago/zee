# OpenClaw Lane 01: Gateway Control Plane (WS protocol, auth, events)

Tracking issue: `adolago/zee#224`

## Scope

This lane covers gateway/auth/event-surface deltas between OpenClaw and Zee and records explicit `port` / `adapt` / `defer` / `non-goal` decisions.

## Decision Matrix (Upstream PRs)

| Upstream PR | Decision | Rationale | Zee tracking/status |
| --- | --- | --- | --- |
| `openclaw#9518` (auth for canvas host/A2UI assets) | `adapt` | Zee does not ship identical canvas host surface but must enforce equivalent route auth posture. | Auth and gateway route hardening is present in current server route + scoped auth model. |
| `openclaw#9858` (credential redaction in config responses) | `port` | Direct security parity requirement for control plane API responses. | Zee config redaction path is present and retained as required behavior. |
| `openclaw#9806` (skill/plugin safety scanner) | `adapt` | Scanner exists in different package topology and plugin model in Zee. | Keep scanner/security checks in Zee-specific security lane; do not mirror path layout 1:1. |
| `openclaw#10072` (web token-usage dashboard) | `adapt` | Product-surface/UI divergence; preserve operational data exposure via Zee routes. | Zee web/control-ui path exposes health/gateway/usage primitives through API. |
| `openclaw#10000` (session history payload capping) | `port` | Safety/correctness requirement independent of product branding. | Maintain bounded payload behavior in session/API responses and regression tests. |
| `openclaw#10776` (cron/store hardening) | `adapt` | Cross-lane coupling with background jobs and persistence details. | Track implementation in cron/reliability lane; keep lane-01 assumptions explicit. |
| `openclaw#9436` (hook token URL param cleanup) | `port` | Request/auth surface hygiene applies directly. | Track as auth/hook hygiene parity in gateway route/hook plumbing. |
| `openclaw#9911` (workspace updates/chore umbrella) | `defer` | Mixed umbrella changes; only security/runtime-critical deltas should move now. | Pull only concrete required sub-items into focused Zee issues/PRs. |

## OpenClaw-only Artifacts (from lane issue diff sample)

### Decision summary

- `control-ui.ts` / `control-ui-shared.ts` / related tests: `adapt`
- `origin-check.ts` / related tests: `port`
- `server-mobile-nodes.ts` and mobile-node e2e tests: `defer` (handled under node-client/product lane)
- gateway auth and server auth e2e deltas: `port`
- security extras (`channel-metadata.ts`, `skill-scanner.ts`, ACL tests): `adapt` or `port` based on direct exposure risk

## Intentional Non-goals in this lane

- Full OpenClaw canvas host/A2UI implementation parity.
- OpenClaw package-structure mirroring under Zee monorepo.
- Mobile-node productization in lane-01 (tracked separately).

## Required Test Coverage in Zee (lane completion gate)

1. Gateway auth required on control-plane endpoints under configured secrets.
2. Non-loopback bind guardrails with explicit auth requirements.
3. Control-ui/web-origin checks for browser-originated requests.
4. Route-scope authorization checks for gateway/admin paths.
5. Security audit findings for downgraded control-ui auth posture.

## Next Actions Completion

- [x] Confirm intentional non-goals for lane-01 in Zee.
- [x] Record explicit `port` / `adapt` / `defer` decisions for referenced upstream PRs.
- [x] Define required test-behavior gates for any port/adapted lane-01 deltas.
