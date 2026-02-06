/**
 * Memory Layer Types
 *
 * Unified memory system with Qdrant vector storage,
 * supporting semantic search, pattern storage, and cross-session context
 */

// =============================================================================
// Memory Entry Types
// =============================================================================

/** Categories for organizing memories */
export type MemoryCategory =
  | "conversation"
  | "fact"
  | "preference"
  | "task"
  | "decision"
  | "relationship"
  | "note"
  | "pattern"
  | "custom";

/** Metadata attached to memory entries */
export interface MemoryMetadata {
  /** Source surface (cli, web, whatsapp, etc.) */
  surface?: string;
  /** Session ID where memory was created */
  sessionId?: string;
  /** Agent that created the memory */
  agent?: string;
  /** Importance score (0-1) */
  importance?: number;
  /** Related entity IDs */
  entities?: string[];
  /** Custom tags */
  tags?: string[];
  /** Additional structured data */
  extra?: Record<string, unknown>;
}

// =============================================================================
// Enhanced Memory Types (Context Tree, Versioning, Composer, Dual Memory)
// =============================================================================

/** Context tree location for hierarchical organization */
export interface ContextTreeLocation {
  domain: string;
  topic?: string;
  subtopic?: string;
}

/** Version metadata for a memory entry */
export interface MemoryVersionInfo {
  memoryId: string;
  version: number;
  parentVersion?: number;
  superseded: boolean;
}

/** How a memory was created/curated */
export type MemoryKind = "curated" | "auto" | "agent";

/** Retrieval priority for context composer */
export type MemoryPriority = "high" | "normal" | "low";

/** Dual memory: factual vs reasoning */
export type MemoryMemoryType = "fact" | "reasoning";

/** Parameters for agentic (filter-first) memory search */
export interface AgenticSearchParams {
  domain: string;
  topic?: string;
  subtopic?: string;
  /** Optional semantic query within the filtered set */
  query?: string;
  /** Only return current (non-superseded) versions. Default true. */
  currentOnly?: boolean;
  kind?: MemoryKind | MemoryKind[];
  priority?: MemoryPriority | MemoryPriority[];
  bookmarked?: boolean;
  memoryType?: MemoryMemoryType;
  limit?: number;
  threshold?: number;
}

/** A single memory entry */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;
  /** Memory category */
  category: MemoryCategory;
  /** Raw text content */
  content: string;
  /** Summary for quick retrieval */
  summary?: string;
  /** Embedding vector (generated) */
  embedding?: number[];
  /** Associated metadata */
  metadata: MemoryMetadata;
  /** Media metadata for multimodal entries */
  media?: MediaMetadata;
  /** Creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  accessedAt: number;
  /** Update timestamp */
  updatedAt?: number;
  /** Time-to-live in milliseconds (0 = permanent) */
  ttl?: number;
  /** Namespace for isolation */
  namespace?: string;

  // Context Tree
  /** Top-level domain for context tree organization */
  domain?: string;
  /** Topic within domain */
  topic?: string;
  /** Subtopic within topic */
  subtopic?: string;

  // Version Control
  /** Stable memory ID across versions */
  memoryId?: string;
  /** Version number (1-based) */
  version?: number;
  /** Parent version number */
  parentVersion?: number;
  /** Whether this version has been superseded */
  superseded?: boolean;

  // Context Composer
  /** How this memory was created */
  kind?: MemoryKind;
  /** Retrieval priority */
  priority?: MemoryPriority;
  /** Whether this memory is bookmarked for quick access */
  bookmarked?: boolean;

  // Dual Memory
  /** Whether this is a fact or reasoning trace */
  memoryType?: MemoryMemoryType;

  // Opinion Confidence
  /** Confidence score (0-1) for belief/opinion entries */
  confidence?: number;
  /** Evidence supporting this belief */
  evidenceFor?: string[];
  /** Evidence contradicting this belief */
  evidenceAgainst?: string[];
  /** Timestamp when this belief was last challenged or reinforced */
  lastChallenged?: number;
}

/** Input for creating a memory */
export interface MemoryInput {
  category: MemoryCategory;
  content: string;
  summary?: string;
  metadata?: Partial<MemoryMetadata>;
  /** Media metadata for multimodal entries */
  media?: MediaMetadata;
  /** Multimodal content for embedding (optional) */
  multimodal?: MultimodalContent;
  ttl?: number;
  namespace?: string;

  // Context Tree
  domain?: string;
  topic?: string;
  subtopic?: string;

  // Version Control (provide memoryId to update an existing memory)
  memoryId?: string;

  // Context Composer
  kind?: MemoryKind;
  priority?: MemoryPriority;
  bookmarked?: boolean;

  // Dual Memory
  memoryType?: MemoryMemoryType;

  // Opinion Confidence
  /** Initial confidence score (0-1). Default: 0.5 */
  confidence?: number;
  /** Evidence supporting this belief */
  evidenceFor?: string[];
  /** Evidence contradicting this belief */
  evidenceAgainst?: string[];
}

// =============================================================================
// Search Types
// =============================================================================

/** Search parameters for memory retrieval */
export interface MemorySearchParams {
  /** Search query text */
  query: string;
  /** Maximum results to return */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  threshold?: number;
  /** Filter by category */
  category?: MemoryCategory | MemoryCategory[];
  /** Filter by namespace (null = search all namespaces) */
  namespace?: string | null;
  /** Filter by tags */
  tags?: string[];
  /** Filter by time range */
  timeRange?: {
    start?: number;
    end?: number;
  };
  /** Include metadata in results */
  includeMetadata?: boolean;
  /** Include embedding vectors in results */
  includeVectors?: boolean;

  // Context Tree filters
  domain?: string;
  topic?: string;
  subtopic?: string;

  // Version Control filters
  memoryId?: string;
  /** Filter by superseded status (defaults to false for current-only) */
  superseded?: boolean;

  // Context Composer filters
  kind?: MemoryKind | MemoryKind[];
  priority?: MemoryPriority | MemoryPriority[];
  bookmarked?: boolean;

  // Dual Memory filter
  memoryType?: MemoryMemoryType;

  // Opinion Confidence filters
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Maximum confidence threshold */
  maxConfidence?: number;
}

/** A search result with similarity score */
export interface MemorySearchResult {
  /** The memory entry */
  entry: MemoryEntry;
  /** Similarity score (0-1) */
  score: number;
  /** Highlighted matches */
  highlights?: string[];
}

// =============================================================================
// Pattern Types
// =============================================================================

/** Pattern for learning user preferences and behaviors */
export interface MemoryPattern {
  /** Unique pattern ID */
  id: string;
  /** Pattern type */
  type: PatternType;
  /** Pattern description */
  description: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Number of observations supporting this pattern */
  observations: number;
  /** Evidence entries */
  evidence: string[];
  /** Last observed timestamp */
  lastObserved: number;
  /** First observed timestamp */
  firstObserved: number;
  /** Pattern-specific data */
  data: Record<string, unknown>;
}

export type PatternType =
  | "preference"
  | "behavior"
  | "communication_style"
  | "schedule"
  | "topic_interest"
  | "relationship"
  | "workflow"
  | "custom";

// =============================================================================
// Relationship Types
// =============================================================================

/** Entity relationship in the knowledge graph */
export interface MemoryRelationship {
  /** Unique relationship ID */
  id: string;
  /** Source entity ID */
  sourceId: string;
  /** Target entity ID */
  targetId: string;
  /** Relationship type */
  type: RelationshipType;
  /** Relationship strength (0-1) */
  strength: number;
  /** Direction: unidirectional or bidirectional */
  direction: "uni" | "bi";
  /** Additional properties */
  properties: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: number;
}

export type RelationshipType =
  | "mentions"
  | "related_to"
  | "part_of"
  | "causes"
  | "follows"
  | "similar_to"
  | "contradicts"
  | "custom";

// =============================================================================
// Service Interfaces
// =============================================================================

/** Memory service interface */
export interface MemoryService {
  /** Store a new memory */
  store(input: MemoryInput): Promise<MemoryEntry>;

  /** Store multiple memories in batch */
  storeBatch(inputs: MemoryInput[]): Promise<MemoryEntry[]>;

  /** Search memories by semantic similarity */
  search(params: MemorySearchParams): Promise<MemorySearchResult[]>;

  /** Get a specific memory by ID */
  get(id: string): Promise<MemoryEntry | null>;

  /** Update an existing memory */
  update(id: string, updates: Partial<MemoryInput>): Promise<MemoryEntry>;

  /** Delete a memory */
  delete(id: string): Promise<void>;

  /** Delete memories matching criteria */
  deleteWhere(params: Omit<MemorySearchParams, "query" | "limit">): Promise<number>;

  /** Get recent memories */
  recent(options?: {
    limit?: number;
    namespace?: string;
    category?: MemoryCategory;
  }): Promise<MemoryEntry[]>;

  /** Get related memories */
  related(id: string, limit?: number): Promise<MemorySearchResult[]>;

  /** Clear all memories (optionally by namespace) */
  clear(namespace?: string): Promise<void>;

  /** Get memory statistics */
  stats(): Promise<MemoryStats>;
}

/** Pattern service interface */
export interface PatternService {
  /** Extract and learn patterns from recent memories */
  learn(options?: { namespace?: string; minObservations?: number }): Promise<MemoryPattern[]>;

  /** Get all learned patterns */
  list(options?: { type?: PatternType; minConfidence?: number }): Promise<MemoryPattern[]>;

  /** Get a specific pattern */
  get(id: string): Promise<MemoryPattern | null>;

  /** Update pattern confidence based on new evidence */
  reinforce(id: string, evidence: string): Promise<MemoryPattern>;

  /** Weaken pattern confidence */
  weaken(id: string, reason?: string): Promise<MemoryPattern>;

  /** Delete a pattern */
  delete(id: string): Promise<void>;
}

/** Relationship service interface */
export interface RelationshipService {
  /** Create a relationship between entities */
  create(input: Omit<MemoryRelationship, "id" | "createdAt">): Promise<MemoryRelationship>;

  /** Get relationships for an entity */
  forEntity(entityId: string, options?: {
    type?: RelationshipType;
    direction?: "incoming" | "outgoing" | "both";
  }): Promise<MemoryRelationship[]>;

  /** Find path between two entities */
  path(sourceId: string, targetId: string, maxDepth?: number): Promise<MemoryRelationship[][]>;

  /** Delete a relationship */
  delete(id: string): Promise<void>;

  /** Get relationship graph for visualization */
  graph(options?: { entityIds?: string[]; depth?: number }): Promise<{
    nodes: Array<{ id: string; label: string; type: string }>;
    edges: MemoryRelationship[];
  }>;
}

// =============================================================================
// Multimodal Types
// =============================================================================

/** Media types for multimodal embeddings */
export type MediaType = "text" | "image" | "video";

/** Image input for multimodal embeddings */
export interface ImageInput {
  type: "image";
  /** URL of the image (http/https or data:) */
  url?: string;
  /** Base64-encoded image data */
  base64?: string;
  /** MIME type of the image */
  mimeType?: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/bmp";
}

/** Video input for multimodal embeddings */
export interface VideoInput {
  type: "video";
  /** URL of the video */
  url: string;
  /** Start time in seconds for frame extraction */
  startTime?: number;
  /** End time in seconds for frame extraction */
  endTime?: number;
}

/** Text input for multimodal embeddings */
export interface TextInput {
  type: "text";
  /** Text content */
  content: string;
}

/** Union of all multimodal input types */
export type MultimodalInput = TextInput | ImageInput | VideoInput;

/** Container for multimodal content */
export interface MultimodalContent {
  /** Array of content items (text, images, videos) */
  contents: MultimodalInput[];
}

/** Media metadata stored with memory entries */
export interface MediaMetadata {
  /** Type of media */
  mediaType: MediaType;
  /** Source URL of the media */
  sourceUrl?: string;
  /** Width in pixels (for images/video) */
  width?: number;
  /** Height in pixels (for images/video) */
  height?: number;
  /** Duration in seconds (for video/audio) */
  duration?: number;
  /** File size in bytes */
  sizeBytes?: number;
  /** Content hash for deduplication */
  contentHash?: string;
}

// =============================================================================
// Embedding Types
// =============================================================================

/** Embedding provider interface */
export interface EmbeddingProvider {
  /** Provider identifier */
  id: string;

  /** Model used for embeddings */
  model: string;

  /** Dimension of output vectors */
  dimension: number;

  /** Whether this provider supports multimodal inputs */
  supportsMultimodal?: boolean;

  /** Supported media types for multimodal embeddings */
  supportedMediaTypes?: MediaType[];

  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for multiple texts */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Generate embedding for multimodal content (optional) */
  embedMultimodal?(content: MultimodalContent): Promise<number[]>;

  /** Generate embeddings for multiple multimodal contents (optional) */
  embedMultimodalBatch?(contents: MultimodalContent[]): Promise<number[][]>;
}

/** Supported embedding providers */
export type EmbeddingProviderType =
  | "openai"
  | "google"
  | "voyage"
  | "vllm";

// =============================================================================
// Storage Types
// =============================================================================

/** Vector storage backend interface */
export interface VectorStorage {
  /** Initialize the storage */
  init(): Promise<void>;

  /** Insert vectors with metadata */
  insert(entries: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }>): Promise<void>;

  /** Search by vector similarity */
  search(vector: number[], options: {
    limit: number;
    threshold?: number;
    filter?: Record<string, unknown>;
  }): Promise<Array<{
    id: string;
    score: number;
    payload: Record<string, unknown>;
  }>>;

  /** Get entries by IDs */
  get(ids: string[]): Promise<Array<{
    id: string;
    vector?: number[];
    payload: Record<string, unknown>;
  } | null>>;

  /** Update entry payload */
  update(id: string, payload: Record<string, unknown>): Promise<void>;

  /** Delete entries */
  delete(ids: string[]): Promise<void>;

  /** Delete by filter */
  deleteWhere(filter: Record<string, unknown>): Promise<number>;

  /** Count entries */
  count(filter?: Record<string, unknown>): Promise<number>;

  /** Create collection/index */
  createCollection(name: string, dimension: number): Promise<void>;

  /** Delete collection */
  deleteCollection(name: string): Promise<void>;

  /** List collections */
  listCollections(): Promise<string[]>;
}

// =============================================================================
// Configuration
// =============================================================================

/** Memory system configuration */
export interface MemoryConfig {
  /** Qdrant connection settings */
  qdrant: {
    url: string;
    apiKey?: string;
    collection: string;
    /** Default request timeout for Qdrant REST calls (ms). */
    timeoutMs?: number;
    /** Max retry count for idempotent requests (network errors/timeouts/5xx/429). */
    maxRetries?: number;
  };

  /** Embedding settings */
  embedding: {
    provider: EmbeddingProviderType;
    model?: string;
    apiKey?: string;
    dimension?: number;
  };

  /** Default namespace for isolation */
  defaultNamespace?: string;

  /** Maximum memories per namespace */
  maxEntriesPerNamespace?: number;

  /** Enable automatic pattern learning */
  autoLearn?: boolean;

  /** Minimum observations before a pattern is considered valid */
  patternMinObservations?: number;

  /** Default TTL for memories in milliseconds (0 = permanent) */
  defaultTTL?: number;

  /** SQLite FTS configuration for hybrid search */
  fts?: {
    /** Directory for the SQLite database file */
    dbDir?: string;
    /** Database file name */
    dbName?: string;
  };
}

// =============================================================================
// Statistics
// =============================================================================

/** Memory statistics */
export interface MemoryStats {
  /** Total memory count */
  totalEntries: number;
  /** Entries by category */
  byCategory: Record<MemoryCategory, number>;
  /** Entries by namespace */
  byNamespace: Record<string, number>;
  /** Total patterns learned */
  totalPatterns: number;
  /** Total relationships */
  totalRelationships: number;
  /** Storage size in bytes */
  storageBytes: number;
  /** Last compaction timestamp */
  lastCompaction?: number;
}
