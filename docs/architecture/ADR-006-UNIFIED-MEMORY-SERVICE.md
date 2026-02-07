# ADR-006: Unified Memory Service

## Status

Accepted (Implemented)

## Context

`agent-core` uses memory across personas and surfaces (CLI, daemon, messaging). We need:

- a single “memory service” API used by personas and tools
- a storage backend that can scale (vector search) with sane timeouts/retries
- local fallbacks for development and offline workflows

## Decision

Implement a unified memory service (`Memory`) with:

1. **Single entrypoint API** for store/search/list/stats.
2. **Backend abstraction**:
   - Qdrant vector store for semantic search
   - optional local backends (SQLite FTS, hybrid) for fallback/supplemental indexing
3. **Operational guardrails**:
   - explicit timeouts and bounded retries for remote storage calls
   - bounded result sizes and deterministic truncation behaviors

## Consequences

### Positive

- Personas can rely on one memory API with consistent semantics.
- Makes performance/security hardening focused (one gateway to storage).
- Easier to benchmark and tune.

### Negative

- Requires careful schema/versioning for stored memory payloads.
- Hybrid/local backends add implementation complexity.

## Implemented By (Evidence)

- Unified memory service: `src/memory/unified.ts`
- Qdrant backend: `src/memory/qdrant.ts`
- Hybrid/local backends: `src/memory/hybrid.ts`, `src/memory/sqlite-fts.ts`
- Tests: `src/memory/*.test.ts`, `packages/agent-core/test/memory/`

