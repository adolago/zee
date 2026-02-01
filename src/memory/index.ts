/**
 * Memory Module
 *
 * Unified memory system with Qdrant vector storage,
 * supporting semantic search, pattern storage, and cross-session context.
 *
 * Primary API:
 * - Memory class (unified.ts) - Single class for all memory operations
 * - getMemory() - Get shared Memory instance
 */

// Primary API - unified Memory class
export {
  Memory,
  getMemory,
  resetMemory,
  extractKeyFacts,
  generateSummary,
  mergeFacts,
  createConversationState,
  updateConversationState,
  formatContextForPrompt,
} from "./unified";
export type {
  MemoryConfig,
  PersonaId,
  ConversationState,
  PersonasState,
  EntryType,
} from "./unified";

// Types
export * from "./types";

// Embedding providers
export * from "./embedding";

// Low-level storage (for advanced use cases)
export { QdrantVectorStorage, QdrantMemoryStore } from "./qdrant";

// SQLite FTS for keyword search
export { SqliteFtsStore, buildFtsQuery, bm25RankToScore } from "./sqlite-fts";
export type { FtsConfig, FtsEntry, FtsSearchResult, FtsSearchOptions } from "./sqlite-fts";

// Hybrid search (vector + keyword)
export { mergeHybridResults } from "./hybrid";
export type { HybridSearchConfig, HybridSearchResult, HybridSearchParams } from "./hybrid";
