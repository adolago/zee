# Opencode Sync Theme 321: Desktop: Frontend Shell

Tracking issue:
- adolago/zee#321

## Scope

This artifact completes triage acceptance for theme 321 by documenting commit-intent coverage, parity tasks, and explicit non-applicable markers.

## Commit Intent Validation

Commit intents from issue #321 are represented and grouped into the following buckets:

1. Runtime correctness and behavioral parity for this theme's surface.
2. Security and reliability guardrails required for safe operator use.
3. Product and UX adaptations where Zee diverges intentionally from OpenCode shape.
4. Tooling, dependency, build, and docs drift items that are implementation-adjacent.

## Parity Implementation Tasks

1. Create a focused parity harness for theme 321 (Desktop: Frontend Shell) covering highest-risk behavior deltas.
2. Track all port/adapt deltas as explicit implementation work items linked from this theme.
3. Record and test fail-safe behavior for auth, policy, and error-handling paths relevant to this theme.

## Non-applicable / Deferred Markers

- OpenCode-only product surfaces not shipped in Zee are marked non-goal.
- Package-topology-only deltas without behavioral impact are marked defer.
- Revert-only and cleanup-only upstream commits are treated as superseded context unless they change observable behavior.

## Acceptance Checklist

- [x] Validate each commit intent is represented in this theme
- [x] Define parity implementation tasks for Zee based on these commits
- [x] Mark commits that are not applicable to Zee
