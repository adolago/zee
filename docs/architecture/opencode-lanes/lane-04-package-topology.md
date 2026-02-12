# OpenCode Lane 04: Web/Desktop/Package Topology Parity

Tracking issue: `adolago/zee#289`

## Scope

- Track package-level topology deltas between Zee and OpenCode.
- Define explicit `port` / `adapt` / `defer` / `non-goal` decisions.
- Provide an implementation sequence for any adopted surfaces.

## Package Delta Matrix

| OpenCode surface/package | Current Zee equivalent | Decision | Rationale | Notes |
| --- | --- | --- | --- | --- |
| `packages/console` (hosted web control surface) | Zee has web-facing components but different product surface | adapt | Similar user need exists, but Zee should keep assistant-first product boundaries. | Candidate as a thin control dashboard, not a full OpenCode clone. |
| `packages/identity` | Zee auth/profile flows in core CLI + Swabble auth hooks | adapt | Identity concepts overlap, but implementation should stay Zee-native. | Prefer extending `zee auth` flows over importing package topology. |
| `packages/script` | Zee automation through skills/tools/cron and CLI commands | adapt | Scripting behavior is valuable; packaging can differ. | Expose migration examples instead of package-level parity first. |
| `packages/function` | Zee tools/extensions cover similar execution surfaces | defer | Value exists, but not parity-critical for current assistant roadmap. | Re-evaluate after lanes 03 and 05 complete. |
| `packages/containers` | No direct first-class Zee package | defer | Useful for infra-heavy workflows but outside immediate migration pain. | Consider only after clear demand in issue backlog. |
| `packages/slack` (OpenCode-specific app/package) | Zee currently does not ship this OpenCode package layout | non-goal | Zee channel strategy should be plugin-based and product-led, not package-name parity. | Slack support, if added, belongs in Zee channel/plugin lanes. |
| `packages/enterprise` | No direct Zee equivalent | non-goal | OpenCode enterprise packaging is intentionally out of Zee's current scope. | Revisit only if product direction changes. |
| `packages/docs` topology parity | Zee already has docs structure tuned to Zee architecture | non-goal | Documentation should reference OpenCode deltas, not mirror package topology. | Keep cross-links, avoid structural mirroring. |

## Explicit Non-Goal List

- Mirror OpenCode package names 1:1 inside Zee.
- Import OpenCode enterprise packaging model into Zee.
- Treat package topology parity as a requirement independent of user-facing migration impact.

## Adaptation Candidates

1. `console`-adjacent control surface alignment:
   - document which OpenCode console workflows map to Zee control/UI flows.
2. `identity`-adjacent auth flow alignment:
   - tighten `zee auth` onboarding and profile rotation guidance for OpenCode migrants.
3. `script` parity guides:
   - publish side-by-side command/task examples for common migration workflows.

## Sequenced Backlog Proposal

1. Phase 1 (now): documentation parity and migration mapping
   - owner: `@adolago`
   - outputs: lane docs + OpenCode migration mapping pages
2. Phase 2 (after lane 05): implement highest-impact adaptation slice
   - likely target: control surface + auth flow clarity
   - gate: parity-critical workflow validation from lane 05
3. Phase 3 (optional): re-evaluate deferred items
   - `function` and `containers` only if migration demand is demonstrated

## Acceptance Checklist

- [x] Package delta matrix with decisions and rationale
- [x] Explicit non-goal list and adaptation candidates
- [x] Sequenced backlog proposal for adopted surfaces
