/**
 * Infrastructure Constants
 *
 * Centralized constants for infrastructure configuration defaults.
 *
 * @module config/constants
 */

// =============================================================================
// Qdrant Vector Database
// =============================================================================

/** Default Qdrant server URL */
export const QDRANT_URL = "http://localhost:6333";

/** Default collection for agent memory */
export const QDRANT_COLLECTION_MEMORY = "agent_memory";

/** Default collection for personas state */
export const QDRANT_COLLECTION_PERSONAS_STATE = "personas_state";

/** Default collection for personas memory */
export const QDRANT_COLLECTION_PERSONAS_MEMORY = "personas_memory";

// =============================================================================
// Embedding Configuration
// =============================================================================

/** Default embedding model */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Default embedding dimensions for OpenAI text-embedding-3-small */
export const EMBEDDING_DIMENSIONS = 1536;

/** Mock embedding dimensions (for testing) */
export const MOCK_EMBEDDING_DIMENSIONS = 384;

// =============================================================================
// Timeouts
// =============================================================================

/** Default drone/task timeout in ms (5 minutes) */
export const TIMEOUT_DRONE_MS = 300_000;

/** Default fact extraction timeout in ms (30 seconds) */
export const TIMEOUT_FACT_EXTRACTION_MS = 30_000;

/** Default provider timeout in ms (5 minutes) */
export const TIMEOUT_PROVIDER_MS = 300_000;

/** Default web fetch timeout in ms (30 seconds) */
export const TIMEOUT_WEBFETCH_MS = 30_000;

/** Maximum web fetch timeout in ms (5 minutes) */
export const TIMEOUT_WEBFETCH_MAX_MS = 300_000;

// =============================================================================
// Server Configuration
// =============================================================================

/** Default API server port */
export const DEFAULT_API_PORT = 3456;

// =============================================================================
// Memory Limits
// =============================================================================

/** Default max memories to retrieve */
export const MEMORY_MAX_RETRIEVED = 10;

/** Default similarity threshold for memory search */
export const MEMORY_SIMILARITY_THRESHOLD = 0.7;

/** Max key facts to retain in conversation continuity */
export const CONTINUITY_MAX_KEY_FACTS = 50;

/** Token threshold to trigger conversation summary */
export const CONTINUITY_SUMMARY_THRESHOLD = 60_000;

// =============================================================================
// Message Chunking
// =============================================================================

/** Maximum message chunk size for Matrix */
export const MESSAGE_CHUNK_SIZE_MATRIX = 4000;

/** Maximum message chunk size for WhatsApp */
export const MESSAGE_CHUNK_SIZE_WHATSAPP = 4000;
