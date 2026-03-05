# OpenClaw Lane 09: Memory + indexing (plugin memory vs semantic memory)

Tracking issue: `adolago/zee#232`

## Decision Summary

- Semantic memory correctness and safety checks: `port`
- Plugin-memory topology parity: `adapt`
- Index backend details and storage internals: `adapt`

## Rationale

Zee already centers semantic memory as a first-class capability with its own backend abstractions. Parity focuses on behavior guarantees (correctness, bounded retrieval, safety), not upstream storage topology mirroring.

## Non-goals

- Replacing Zee memory architecture solely for package-shape parity.

## Test Gates

1. Memory store/search/delete behavior regression coverage.
2. Index degradation handling when primary backend is unavailable.
3. Security checks for sensitive-memory handling and redaction.

## Next Actions Completion

- [x] Capture lane-09 port/adapt decisions against Zee memory architecture.
- [x] Mark plugin-topology mirroring as non-goal.
- [x] Define behavior and safety regression gates for memory/indexing.
