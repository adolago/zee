# Problem statement
Move the memory subsystem boundary into Rust to prioritize safety and reliability while keeping existing TypeScript APIs and behavior stable for current call sites and integrations.
## Current state summary (key references)
Unified memory logic (Qdrant storage, embeddings, conversation/state continuity) lives in `src/memory/unified.ts (1-200, 200-1600)` and the Qdrant REST client and payload/index logic in `src/memory/qdrant.ts (1-200, 200-520)`.
Embedding and reranking are TypeScript implementations in `src/memory/embedding.ts (1-200)` and `src/memory/reranker.ts (1-200)`, with core types and provider definitions in `src/memory/types.ts (1-520)`.
Memory is consumed by server routes `packages/zee-core/src/server/route/memory.ts (1-200)`, MCP server `src/mcp/servers/memory.ts (1-200)`, Zee tools `src/domain/zee/tools.ts (1-240)`, persona bootstrap hooks `packages/zee-core/src/bootstrap/personas.ts (1-200)`, and required-memory checks in `packages/zee-core/src/session/prompt.ts (91-290)`.
Runtime configuration is loaded from `src/config/runtime.ts (1-200)` with defaults in `src/config/constants.ts (1-120)`; the broader config schema and defaults are in `src/config/schema.ts (271-470)` and `src/config/defaults.ts (96-295)`.
There was a legacy memory persistence plugin prototype for key/value caching; the active runtime plugin loader is `packages/zee-core/src/plugin/index.ts`.
Rust workspace currently includes only `packages/stanley-core` as per `Cargo.toml (1-34)`.
## Proposed changes
### 1) Define the Rust boundary and contract
Keep the public TypeScript API (`Memory`, `getMemory`, and related exports) stable, and formalize a contract based on `MemoryInput`, `MemoryEntry`, `MemorySearchParams`, and conversation/state payloads from `src/memory/unified.ts` and `src/memory/types.ts`.
Introduce a strict error taxonomy (validation, backend unavailable, dimension mismatch, timeout) so callers can safely degrade like today’s `Memory.init` behavior.
### 2) Add Rust crates and service
Add a new Rust crate for memory domain + Qdrant integration (e.g., `packages/memory-core`) and a service binary (e.g., `packages/memoryd`), updating the workspace in `Cargo.toml`.
Implement Qdrant collection creation, index setup, and payload schema parity with `QdrantVectorStorage` (type discriminator, namespace, TTL/`expiresAt`, metadata fields, and filter semantics).
Mirror deterministic ID generation for state/session records and instance ID stability to avoid breaking existing persisted data.
### 3) Node client and swap-in
Create a TypeScript client (e.g., `src/memory/rust-client.ts`) that implements the same `Memory` interface but forwards calls to the Rust service.
Update `getMemory` to select between the TS implementation and Rust-backed client via configuration, preserving existing call sites in server, MCP, tools, and persona hooks.
If embeddings remain in Node for Phase 1, add a Rust endpoint that accepts embeddings and metadata (“save with vector”), so only storage/search is moved.
### 4) Configuration and lifecycle
Extend runtime config to support the Rust memory endpoint, timeouts, and process mode (external vs spawned). Wire these into config schema/defaults to keep `memory.vectorDb` and `memory.embedding` behavior intact.
Align `SessionPrompt.ensureRequiredMemory` with a Rust health/readiness check to preserve current “memory required” semantics.
### 5) Migration strategy (safety-first)
Phase 1: Rust handles Qdrant storage/search; embeddings and reranking stay in Node to minimize risk and keep existing provider auth flows and stats.
Phase 2: Move embeddings and reranking into Rust, mirroring cache behavior and surfacing stats back to Node.
Phase 3: Optionally migrate the memory-persistence plugin’s Qdrant path to use the Rust client for consistent safety semantics.
### 6) Observability and reliability
Implement strict validation, bounded timeouts, retries, and circuit breaking inside the Rust service.
Add structured logs and a stats/health endpoint for visibility and to replace `memory.stats()` semantics used by session checks.
Maintain current graceful-degradation behavior when memory is unavailable so the agent loop remains resilient.
## Verification plan
Rust unit tests for payload/schema parity, filter translation, deterministic IDs, and dimension checks.
Integration tests that dual-run TS and Rust implementations for identical inputs and compare results.
End-to-end checks through existing HTTP routes and MCP tools to ensure compatibility with current clients.
## Open decisions
Transport: HTTP/JSON vs gRPC vs Unix socket for local IPC.
Embedding placement in Phase 1 (Node vs Rust), given safety and auth handling.
Process supervision model (spawned by agent-core vs externally managed service).
