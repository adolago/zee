# ADR-009: Hybrid Memory Backend

## Status

Accepted (Implemented)

## Context

Vector search alone is not always sufficient:

- Some lookups are best served by structured filters or text indexes.
- Developers need a local/offline-friendly path for development and testing.

## Decision

Provide a hybrid memory backend that can combine:

1. **Vector similarity** (Qdrant)
2. **Lexical search** (SQLite FTS where configured)
3. **Optional reranking** (when a reranker provider is configured)

The unified memory API chooses the best available strategy based on configuration and request type, without exposing storage-specific details to callers.

## Consequences

### Positive

- Better recall for mixed “semantic + keyword” queries.
- Allows incremental adoption (Qdrant-only, local-only, or both).

### Negative

- More knobs: consistency and ranking behavior must be documented and tested.

## Implemented By (Evidence)

- Hybrid search orchestration: `src/memory/hybrid.ts`
- Lexical backend: `src/memory/sqlite-fts.ts`
- Reranking: `src/memory/reranker.ts`

