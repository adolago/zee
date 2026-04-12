/**
 * Memory Module
 *
 * Unified memory system with local SQLite vector storage,
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
  AgentId,
  ConversationState,
  AgentsState,
  EntryType,
} from "./unified";

// Types
export * from "./types";

// Embedding providers
export * from "./embedding";

// Low-level local storage (for advanced use cases)
export { SqliteVectorStorage, resolveSqliteVectorDbPath } from "./sqlite-vector";
export { prepareLocalMemory, getLocalMemoryStatus, resolveLocalMemoryPaths } from "./local-runtime";

// SQLite FTS for keyword search
export { SqliteFtsStore, buildFtsQuery, bm25RankToScore } from "./sqlite-fts";
export type { FtsConfig, FtsEntry, FtsSearchResult, FtsSearchOptions } from "./sqlite-fts";

// Hybrid search (vector + keyword)
export { mergeHybridResults } from "./hybrid";
export type { HybridSearchConfig, HybridSearchResult, HybridSearchParams } from "./hybrid";

// Markdown source-of-truth layer
export { MarkdownSync, getMarkdownSync, resetMarkdownSync } from "./markdown-sync";
export type { MarkdownSyncConfig } from "./markdown-sync";

// Entity page auto-generation
export { generateEntityPages, discoverEntities, getEntityMemories } from "./entity-pages";
export type { EntityPageResult, GenerateEntityPagesOptions } from "./entity-pages";

// Reflect job (scheduled curation)
export { runReflect, getReflectJobDefinition } from "./reflect";
export type { ReflectResult, ReflectOptions } from "./reflect";
