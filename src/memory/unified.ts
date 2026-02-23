/**
 * Unified Memory System
 *
 * Single class that handles all memory operations:
 * - Semantic memory storage and search
 * - Persona state persistence
 * - Conversation continuity (fact extraction, session chaining)
 * - Cross-session context injection
 *
 * Uses a single Qdrant collection with `type` field for discrimination.
 */

import { randomUUID } from "node:crypto";
import { QdrantVectorStorage } from "./qdrant";
import { createEmbeddingProvider, createEmbeddingProviderAsync, type EmbeddingConfig } from "./embedding";
import type {
  MemoryEntry,
  MemoryInput,
  MemorySearchMode,
  MemorySearchParams,
  MemorySearchResult,
  MemoryCategory,
  EmbeddingProvider,
  MultimodalContent,
  MediaMetadata,
  AgenticSearchParams,
  MemoryKind,
  MemoryPriority,
  MemoryMemoryType,
  LocalIndexBackend,
  LocalIndexDegradedReadMode,
} from "./types";
import type { Reranker, RerankerConfig, RerankResult } from "./reranker";
import {
  QDRANT_URL,
  QDRANT_COLLECTION_MEMORY,
  CONTINUITY_MAX_KEY_FACTS,
} from "../config/constants";
import { getAuthApiKeySync } from "../config/providers";
import {
  getMemoryEmbeddingConfig,
  getMemoryLocalIndexConfig,
  getMemoryQdrantConfig,
  getMemoryRerankerConfig,
  type MemoryLocalIndexConfig,
} from "../config/runtime";
import { Log } from "../../packages/zee/src/util/log";
import { SqliteFtsStore, type FtsConfig, type FtsSearchResult } from "./sqlite-fts";
import { mergeHybridResults, type HybridSearchConfig, type HybridSearchResult } from "./hybrid";
import { getMarkdownSync, type MarkdownSyncConfig } from "./markdown-sync";

const log = Log.create({ service: "memory" });

// =============================================================================
// Types
// =============================================================================

/** Entry types stored in unified collection */
export type EntryType =
  | "memory"           // Regular memories (facts, preferences, etc.)
  | "state"            // Personas orchestration state
  | "conversation"     // Conversation continuity state
  | "session_chain";   // Session chain index

/** Persona identifiers */
export type PersonaId = "zee" | "stanley" | "johny";

/** Conversation state for continuity */
export interface ConversationState {
  sessionId: string;
  leadPersona: PersonaId;
  summary: string;
  plan: string;
  objectives: string[];
  keyFacts: string[];
  sessionChain: string[];
  updatedAt: number;
}

/** Personas orchestration state */
export interface PersonasState {
  version: string;
  workers: Array<{
    id: string;
    persona: PersonaId;
    role: "queen" | "drone";
    status: string;
    paneId?: string;
    pid?: number;
    currentTask?: string;
    createdAt: number;
    lastActivityAt: number;
  }>;
  tasks: Array<{
    id: string;
    persona: PersonaId;
    description: string;
    prompt: string;
    status: "pending" | "assigned" | "running" | "completed" | "failed";
    priority?: "low" | "normal" | "high" | "critical";
    workerId?: string;
    createdAt: number;
    completedAt?: number;
    result?: string;
    error?: string;
  }>;
  conversation?: ConversationState;
  lastSyncAt: number;
  stats: {
    totalTasksCompleted: number;
    totalDronesSpawned: number;
    totalTokensUsed: number;
  };
}

/** Memory configuration (Qdrant is local-only, no remote/cloud support) */
export interface MemoryConfig {
  qdrant: {
    url?: string;
    collection?: string;
  };
  embedding: EmbeddingConfig;
  /** Reranker configuration for two-stage retrieval */
  reranker?: RerankerConfig;
  namespace?: string;
  maxKeyFacts?: number;
  /** SQLite FTS configuration for hybrid search */
  fts?: FtsConfig;
  /** Secondary local index (Qdrant remains source-of-truth). */
  localIndex?: {
    enabled?: boolean;
    backend?: LocalIndexBackend;
    dbDir?: string;
    dbName?: string;
    degradedRead?: LocalIndexDegradedReadMode;
  };
  /** Markdown sync configuration */
  markdown?: MarkdownSyncConfig;
}

// =============================================================================
// Mock Embedding Provider
// =============================================================================

/**
 * Mock embedding provider for testing when no API key is available.
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly model = "mock-embedding";
  readonly dimension = 384;

  async embed(text: string): Promise<number[]> {
    const vector: number[] = new Array(this.dimension).fill(0);
    for (let i = 0; i < text.length && i < this.dimension; i++) {
      vector[i] = (text.charCodeAt(i) % 100) / 100;
    }
    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return vector.map((v) => v / (mag || 1));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// =============================================================================
// Utilities
// =============================================================================

/** Generate deterministic UUID from string */
function stringToUUID(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(0, 3)}-${hex.padEnd(12, "0").slice(0, 12)}`;
}

/** Generate stable instance ID */
function generateInstanceId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const hostname = os.hostname() || "unknown";
  const username = os.userInfo().username || "user";
  return stringToUUID(`memory-${hostname}-${username}`);
}

/** Extract key facts from text (simple heuristics, use LLM in production) */
export function extractKeyFacts(message: string): string[] {
  const facts: string[] = [];
  const sentences = message.split(/[.!?]+/).filter((s) => s.trim().length > 20);

  for (const sentence of sentences) {
    const s = sentence.trim().toLowerCase();

    // Fact-like patterns
    if (
      s.includes("is ") || s.includes("are ") || s.includes("was ") ||
      s.includes("were ") || s.includes("has ") || s.includes("have ") ||
      s.includes("prefers ") || s.includes("wants ") || s.includes("needs ") ||
      s.includes("decided ") || s.includes("agreed ")
    ) {
      facts.push(sentence.trim());
    }

    // Preferences
    if (
      s.includes("i like ") || s.includes("i prefer ") ||
      s.includes("i want ") || s.includes("i need ")
    ) {
      facts.push(sentence.trim());
    }

    // Decisions
    if (
      s.includes("we should ") || s.includes("we will ") ||
      s.includes("let's ") || s.includes("the plan is ")
    ) {
      facts.push(sentence.trim());
    }
  }

  return Array.from(new Set(facts)).slice(0, 20);
}

/** Generate summary from messages */
export function generateSummary(messages: string[]): string {
  if (messages.length === 0) return "";

  const recentMessages = messages.slice(-10);
  const parts = [
    "## Conversation Summary",
    "",
    `**Messages:** ${messages.length} total`,
    "",
    "### Recent Exchange:",
    "",
  ];

  for (const msg of recentMessages) {
    const truncated = msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
    parts.push(`- ${truncated}`);
  }

  return parts.join("\n");
}

/** Merge facts with deduplication */
export function mergeFacts(existing: string[], newFacts: string[], max: number): string[] {
  const allFacts = [...existing, ...newFacts];
  const seen: Record<string, boolean> = {};
  const unique: string[] = [];

  for (const fact of allFacts) {
    const normalized = fact.toLowerCase().trim();
    if (!seen[normalized]) {
      seen[normalized] = true;
      unique.push(fact);
    }
  }

  return unique.slice(-max);
}

/** Create a new conversation state */
export function createConversationState(
  sessionId: string,
  leadPersona: PersonaId,
  previousSessionId?: string
): ConversationState {
  return {
    sessionId,
    leadPersona,
    summary: "",
    plan: "",
    objectives: [],
    keyFacts: [],
    sessionChain: previousSessionId ? [previousSessionId] : [],
    updatedAt: Date.now(),
  };
}

/** Update conversation state with new information */
export function updateConversationState(
  state: ConversationState,
  updates: {
    messages?: string[];
    newFacts?: string[];
    plan?: string;
    objectives?: string[];
  },
  config: { maxKeyFacts: number }
): ConversationState {
  const newState = { ...state };

  if (updates.messages) {
    newState.summary = generateSummary(updates.messages);
  }

  if (updates.newFacts) {
    newState.keyFacts = mergeFacts(state.keyFacts, updates.newFacts, config.maxKeyFacts);
  }

  if (updates.plan !== undefined) {
    newState.plan = updates.plan;
  }

  if (updates.objectives !== undefined) {
    newState.objectives = updates.objectives;
  }

  newState.updatedAt = Date.now();
  return newState;
}

/** Format conversation state for prompt injection */
export function formatContextForPrompt(state: ConversationState): string {
  const parts: string[] = ["# Conversation Context (Restored)", ""];

  if (state.summary) {
    parts.push("## Previous Conversation Summary");
    parts.push(state.summary);
    parts.push("");
  }

  if (state.plan) {
    parts.push("## Current Plan");
    parts.push(state.plan);
    parts.push("");
  }

  if (state.objectives.length > 0) {
    parts.push("## Active Objectives");
    state.objectives.forEach((obj, i) => parts.push(`${i + 1}. ${obj}`));
    parts.push("");
  }

  if (state.keyFacts.length > 0) {
    parts.push("## Key Facts");
    state.keyFacts.forEach((fact) => parts.push(`- ${fact}`));
    parts.push("");
  }

  if (state.sessionChain.length > 0) {
    parts.push(`_This is session ${state.sessionChain.length + 1} in a continuing conversation._`);
  }

  return parts.join("\n");
}

// =============================================================================
// Unified Memory Class
// =============================================================================

/**
 * Unified Memory - single class for all memory operations.
 *
 * Replaces:
 * - MemoryStore (store.ts)
 * - QdrantMemoryStore (qdrant.ts)
 * - QdrantMemoryBridge (memory-bridge.ts)
 * - ContinuityManager (continuity.ts)
 */
export class Memory {
  private readonly storage: QdrantVectorStorage;
  private readonly embedding: EmbeddingProvider;
  private readonly namespace: string;
  private readonly collection: string;
  private readonly instanceId: string;
  private readonly maxKeyFacts: number;
  private readonly configuredEmbeddingDimensions?: number;
  private readonly rerankerConfig?: RerankerConfig;
  private embeddingDimension?: number;
  private initialized = false;
  private reranker?: Reranker;

  // SQLite FTS for hybrid keyword search
  private ftsStore?: SqliteFtsStore;
  private readonly ftsConfig?: FtsConfig;
  private readonly localIndex: MemoryLocalIndexConfig;
  private ftsInitFailed = false;

  // Markdown source-of-truth sync
  private readonly markdownConfig?: MarkdownSyncConfig;

  // Current conversation state (for continuity)
  private currentConversation?: ConversationState;

  constructor(config: Partial<MemoryConfig> = {}) {
    const fileQdrant = getMemoryQdrantConfig();
    const fileEmbedding = getMemoryEmbeddingConfig();
    const fileLocalIndex = getMemoryLocalIndexConfig();
    const qdrantConfig = {
      url: config.qdrant?.url ?? fileQdrant.url ?? QDRANT_URL,
      collection:
        config.qdrant?.collection ??
        fileQdrant.collection ??
        QDRANT_COLLECTION_MEMORY,
    };

    this.collection = qdrantConfig.collection;
    this.storage = new QdrantVectorStorage(qdrantConfig);
    this.namespace = config.namespace ?? "default";
    this.instanceId = generateInstanceId();
    this.maxKeyFacts = config.maxKeyFacts ?? CONTINUITY_MAX_KEY_FACTS;
    this.rerankerConfig = config.reranker ?? getMemoryRerankerConfig();

    const configuredDimensions = config.embedding?.dimensions ?? fileEmbedding.dimensions;
    const provider = (config.embedding?.provider ?? fileEmbedding.provider ?? "google") as EmbeddingConfig["provider"];
    const apiKey = getAuthApiKeySync("google");
    const embeddingConfig: EmbeddingConfig = {
      provider,
      model: config.embedding?.model ?? fileEmbedding.model,
      dimensions: configuredDimensions,
      baseUrl: config.embedding?.baseUrl ?? fileEmbedding.baseUrl,
    };
    this.configuredEmbeddingDimensions = configuredDimensions;

    // Use mock embeddings if no API key available
    const usesMock = !apiKey;
    if (usesMock) {
      this.embedding = new MockEmbeddingProvider();
      log.debug("Using mock embeddings (no API key)");
    } else {
      this.embedding = createEmbeddingProvider(embeddingConfig);
    }

    const explicitLocalIndex = config.localIndex ?? {};
    const legacyFts = config.fts ?? {};
    const localIndexEnabled =
      explicitLocalIndex.enabled ??
      (config.fts ? true : undefined) ??
      fileLocalIndex.enabled;
    const localIndexBackend = (explicitLocalIndex.backend ?? fileLocalIndex.backend) as LocalIndexBackend;
    const localIndexDbDir = explicitLocalIndex.dbDir ?? legacyFts.dbDir ?? fileLocalIndex.dbDir;
    const localIndexDbName = explicitLocalIndex.dbName ?? legacyFts.dbName ?? fileLocalIndex.dbName;
    const localIndexDegradedRead =
      (explicitLocalIndex.degradedRead ?? fileLocalIndex.degradedRead) as LocalIndexDegradedReadMode;

    this.localIndex = {
      enabled: localIndexEnabled,
      backend: localIndexBackend,
      dbDir: localIndexDbDir,
      dbName: localIndexDbName,
      degradedRead: localIndexDegradedRead,
    };

    // FTS config (SQLite hybrid search / local keyword index)
    this.ftsConfig =
      this.localIndex.enabled && this.localIndex.backend === "sqlite-fts"
        ? { dbDir: this.localIndex.dbDir, dbName: this.localIndex.dbName }
        : undefined;

    // Markdown sync config
    this.markdownConfig = config.markdown;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  private initFailed = false;
  private initError?: Error;

  private async resolveEmbeddingDimension(): Promise<number> {
    if (this.embeddingDimension && this.embeddingDimension > 0) {
      return this.embeddingDimension;
    }

    const existingDimension = await this.storage.getCollectionDimension(this.collection);
    if (this.configuredEmbeddingDimensions && this.configuredEmbeddingDimensions > 0) {
      if (existingDimension && existingDimension !== this.configuredEmbeddingDimensions) {
        throw new Error(
          `Qdrant collection "${this.collection}" uses dimension ${existingDimension}, but embedding dimensions are configured as ${this.configuredEmbeddingDimensions}. Update memory.qdrant.collection or memory.embedding.dimensions.`,
        );
      }
      this.embeddingDimension = this.configuredEmbeddingDimensions;
      this.embedding.dimension = this.embeddingDimension;
      return this.embeddingDimension;
    }

    if (existingDimension && existingDimension > 0) {
      const probe = await this.embedding.embed("dimension-probe");
      const probeLength = probe.length;
      if (probeLength && probeLength !== existingDimension) {
        throw new Error(
          `Embedding dimension ${probeLength} does not match Qdrant collection ${existingDimension} for "${this.collection}". Create a new collection or set memory.embedding.dimensions to match.`,
        );
      }
      this.embeddingDimension = probeLength || existingDimension;
      this.embedding.dimension = this.embeddingDimension;
      return this.embeddingDimension;
    }

    const probe = await this.embedding.embed("dimension-probe");
    const probeLength = probe.length;
    if (!probeLength) {
      throw new Error("Embedding provider returned empty vector for dimension probe");
    }

    this.embeddingDimension = probeLength;
    this.embedding.dimension = probeLength;
    return probeLength;
  }

  private async initLocalIndex(): Promise<void> {
    if (!this.localIndex.enabled) return;
    if (this.localIndex.backend !== "sqlite-fts") {
      log.warn("Unsupported local index backend, disabling local index", {
        backend: this.localIndex.backend,
      });
      return;
    }
    if (this.ftsStore || this.ftsInitFailed) return;

    try {
      this.ftsStore = new SqliteFtsStore(this.ftsConfig);
      await this.ftsStore.init();
      log.info("Local index initialized", {
        backend: this.localIndex.backend,
        degradedRead: this.localIndex.degradedRead,
      });
    } catch (ftsErr) {
      this.ftsInitFailed = true;
      this.ftsStore = undefined;
      log.warn("Local index initialization failed", {
        backend: this.localIndex.backend,
        error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
      });
    }
  }

  /** Initialize the memory store with retry logic */
  async init(): Promise<void> {
    if (this.initialized) return;

    // If we already failed, don't retry unless explicitly reset
    if (this.initFailed) {
      log.warn("Memory init previously failed, skipping", { error: this.initError?.message });
      return;
    }

    // Initialize local keyword index first so degraded reads can work if Qdrant is down.
    await this.initLocalIndex();

    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const dimension = await this.resolveEmbeddingDimension();
        await this.storage.createCollection(this.collection, dimension);
        this.storage.setCollection(this.collection);
        this.initialized = true;

        log.info("Memory initialized", {
          collection: this.collection,
          namespace: this.namespace,
          dimension: this.embedding.dimension,
          attempt,
          ftsAvailable: !!this.ftsStore,
          localIndexEnabled: this.localIndex.enabled,
          degradedRead: this.localIndex.degradedRead,
        });
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const isLastAttempt = attempt === maxRetries;

        if (isLastAttempt) {
          this.initFailed = true;
          this.initError = error;
          log.error("Memory initialization failed after all retries", {
            collection: this.collection,
            error: error.message,
            attempts: maxRetries,
            localIndexAvailable: !!this.ftsStore,
          });
          // Don't throw - allow daemon to continue without memory
          // Operations will be no-ops until memory is available
          return;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        log.warn("Memory init failed, retrying", {
          attempt,
          maxRetries,
          delay,
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Check if memory is available */
  isAvailable(): boolean {
    return this.initialized && !this.initFailed;
  }

  /** Reset init state to allow retry */
  resetInit(): void {
    this.initialized = false;
    this.initFailed = false;
    this.initError = undefined;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /** Convert a Qdrant point payload to a MemoryEntry */
  private pointToEntry(point: {
    id: string;
    payload: Record<string, unknown>;
    vector?: number[];
  }): MemoryEntry {
    const p = point.payload;
    return {
      id: point.id,
      category: p.category as MemoryCategory,
      content: p.content as string,
      summary: p.summary as string | undefined,
      embedding: point.vector,
      metadata: (p.metadata as MemoryEntry["metadata"]) ?? {},
      media: p.media as MediaMetadata | undefined,
      createdAt: p.createdAt as number,
      accessedAt: p.accessedAt as number,
      ttl: p.ttl as number | undefined,
      namespace: p.namespace as string | undefined,
      // Enhanced fields
      domain: p.domain as string | undefined,
      topic: p.topic as string | undefined,
      subtopic: p.subtopic as string | undefined,
      memoryId: p.memoryId as string | undefined,
      version: p.version as number | undefined,
      parentVersion: p.parentVersion as number | undefined,
      superseded: p.superseded as boolean | undefined,
      kind: p.kind as MemoryKind | undefined,
      priority: p.priority as MemoryPriority | undefined,
      bookmarked: p.bookmarked as boolean | undefined,
      memoryType: p.memoryType as MemoryMemoryType | undefined,
      // Opinion Confidence
      confidence: p.confidence as number | undefined,
      evidenceFor: p.evidenceFor as string[] | undefined,
      evidenceAgainst: p.evidenceAgainst as string[] | undefined,
      lastChallenged: p.lastChallenged as number | undefined,
    };
  }

  /** Generate a deterministic point ID for a tree index node */
  private treePointId(path: string): string {
    return stringToUUID(`tree:${path}`);
  }

  // ===========================================================================
  // Memory Operations (facts, preferences, etc.)
  // ===========================================================================

  /** Save a memory entry */
  async save(input: MemoryInput): Promise<MemoryEntry> {
    await this.init();

    // Graceful degradation if memory unavailable
    if (!this.isAvailable()) {
      log.warn("Memory save skipped - storage unavailable", { category: input.category });
      const id = randomUUID();
      const now = Date.now();
      return {
        id,
        category: input.category,
        content: input.content,
        summary: input.summary,
        embedding: [],
        metadata: input.metadata ?? {},
        createdAt: now,
        accessedAt: now,
        ttl: input.ttl,
        namespace: input.namespace ?? this.namespace,
      };
    }

    const id = randomUUID();
    const now = Date.now();
    const vector = await this.embedding.embed(input.content);

    // Version control: if memoryId provided, look for existing current version
    let memoryId = input.memoryId ?? randomUUID();
    let version = 1;
    let parentVersion: number | undefined;

    if (input.memoryId) {
      try {
        const existing = await this.storage.scroll({
          filter: { memoryId: input.memoryId, superseded: false, type: "memory" },
          limit: 1,
        });
        if (existing.points.length > 0) {
          const prev = existing.points[0];
          const prevVersion = (prev.payload.version as number) ?? 1;
          version = prevVersion + 1;
          parentVersion = prevVersion;
          // Mark old version as superseded
          await this.storage.update(prev.id, { superseded: true });
          // Keep FTS "current-only": remove superseded entry from keyword index.
          if (this.ftsStore) {
            try {
              this.ftsStore.delete(prev.id);
            } catch (ftsErr) {
              log.debug("FTS delete failed for superseded version (non-fatal)", {
                id: prev.id,
                error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
              });
            }
          }
          // Decrement tree index counts for the old point (it's now superseded)
          // Not needed: tree counts track total non-superseded entries, and we're
          // adding a new one to replace the old, so net change is zero.
        }
      } catch (err) {
        log.debug("Version lookup failed, treating as new memory", {
          memoryId: input.memoryId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const entry: MemoryEntry = {
      id,
      category: input.category,
      content: input.content,
      summary: input.summary,
      embedding: vector,
      metadata: input.metadata ?? {},
      createdAt: now,
      accessedAt: now,
      ttl: input.ttl,
      namespace: input.namespace ?? this.namespace,
      // Enhanced fields
      domain: input.domain,
      topic: input.topic,
      subtopic: input.subtopic,
      memoryId,
      version,
      parentVersion,
      superseded: false,
      kind: input.kind ?? "auto",
      priority: input.priority ?? "normal",
      bookmarked: input.bookmarked ?? false,
      memoryType: input.memoryType ?? "fact",
      // Opinion Confidence
      confidence: input.confidence,
      evidenceFor: input.evidenceFor,
      evidenceAgainst: input.evidenceAgainst,
      lastChallenged: input.confidence !== undefined ? now : undefined,
    };

    await this.storage.insert([{
      id,
      vector,
      payload: {
        type: "memory" as EntryType,
        category: entry.category,
        content: entry.content,
        summary: entry.summary,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        accessedAt: entry.accessedAt,
        ttl: entry.ttl,
        expiresAt: entry.ttl ? entry.createdAt + entry.ttl : 0,
        namespace: entry.namespace,
        // Enhanced payload fields
        domain: entry.domain,
        topic: entry.topic,
        subtopic: entry.subtopic,
        memoryId: entry.memoryId,
        version: entry.version,
        parentVersion: entry.parentVersion,
        superseded: false,
        kind: entry.kind,
        priority: entry.priority,
        bookmarked: entry.bookmarked,
        memoryType: entry.memoryType,
        // Opinion Confidence
        confidence: entry.confidence,
        evidenceFor: entry.evidenceFor,
        evidenceAgainst: entry.evidenceAgainst,
        lastChallenged: entry.lastChallenged,
      },
    }]);

    // Index in SQLite FTS for hybrid search
    if (this.ftsStore) {
      try {
        this.ftsStore.index({
          id: entry.id,
          content: entry.content,
          summary: entry.summary,
          category: entry.category,
          namespace: entry.namespace,
          domain: entry.domain,
          topic: entry.topic,
          subtopic: entry.subtopic,
          createdAt: entry.createdAt,
        });
      } catch (ftsErr) {
        log.debug("FTS indexing failed (non-fatal)", {
          id: entry.id,
          error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
        });
      }
    }

    // Maintain context tree directory indexes
    if (input.domain) {
      await this.upsertTreeIndexes(input.domain, input.topic, input.subtopic);
    }

    // Sync to markdown daily log
    try {
      const mdSync = getMarkdownSync(this.markdownConfig);
      mdSync.appendToDailyLog(entry);
    } catch (mdErr) {
      log.debug("Markdown sync failed (non-fatal)", {
        id: entry.id,
        error: mdErr instanceof Error ? mdErr.message : String(mdErr),
      });
    }

    return entry;
  }

  /** Search memories using semantic, keyword, or hybrid retrieval. */
  async search(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    await this.init();
    const mode = this.resolveSearchMode(params);

    // Graceful degradation if memory unavailable
    if (!this.isAvailable()) {
      if (this.shouldUseDegradedLocalRead(mode)) {
        log.warn("Memory search served from local index in degraded mode", {
          query: params.query.slice(0, 50),
          requestedMode: params.mode ?? "auto",
          resolvedMode: mode,
        });
        return this.degradedKeywordSearch(params);
      }
      log.warn("Memory search skipped - storage unavailable", { query: params.query.slice(0, 50) });
      return [];
    }

    if (mode === "keyword") {
      return this.keywordSearch(params);
    }

    if (mode === "hybrid") {
      return this.hybridSearchMode(params);
    }

    // Default: semantic
    return this.semanticSearch(params);
  }

  private resolveSearchMode(params: MemorySearchParams): MemorySearchMode {
    const requested = params.mode ?? "auto";

    if (requested !== "auto") {
      if ((requested === "keyword" || requested === "hybrid") && !this.ftsStore) {
        log.debug("FTS unavailable; falling back to semantic search", { requested });
        return "semantic";
      }
      return requested;
    }

    // Auto mode: use keyword fast-path for identifier-like queries, otherwise hybrid if FTS is available.
    if (this.ftsStore && this.isLikelyKeywordQuery(params.query)) {
      return "keyword";
    }

    if (this.ftsStore) return "hybrid";
    return "semantic";
  }

  private isLikelyKeywordQuery(query: string): boolean {
    const q = query.trim();
    if (!q) return false;

    // Explicit keyword operators / quoting.
    if (q.includes("*") || q.includes(":") || q.includes("\"")) return true;

    const tokens = q.split(/\s+/g).filter(Boolean);
    if (tokens.length > 2) return false;

    const isShort = q.length <= 32;
    if (!isShort) return false;

    // Single token or identifier-like patterns.
    if (tokens.length === 1) return true;
    return /[_\d]/.test(q);
  }

  private shouldUseDegradedLocalRead(mode: MemorySearchMode): boolean {
    if (mode === "semantic") return false;
    if (!this.localIndex.enabled) return false;
    if (this.localIndex.degradedRead !== "keyword_only") return false;
    return !!this.ftsStore;
  }

  private runFtsSearch(
    params: MemorySearchParams,
    options: {
      limitMultiplier: number;
      applyThreshold: boolean;
    },
  ): FtsSearchResult[] {
    if (!this.ftsStore) return [];

    const limit = params.limit ?? 10;
    const threshold = params.threshold ?? 0.0;
    const includeSnippets = params.includeSnippets ?? false;
    const effectiveNamespace = params.namespace === null ? undefined : (params.namespace ?? this.namespace);

    const results = this.ftsStore.search(params.query, {
      limit: Math.min(limit * options.limitMultiplier, 200),
      namespace: effectiveNamespace,
      category: typeof params.category === "string" ? params.category : undefined,
      domain: params.domain,
      topic: params.topic,
      subtopic: params.subtopic,
      timeRange: params.timeRange,
      includeSnippets,
    });

    if (!options.applyThreshold) return results;
    return results.filter((r) => r.score >= threshold);
  }

  private normalizeMemoryCategory(category?: string): MemoryCategory {
    switch (category) {
      case "conversation":
      case "fact":
      case "preference":
      case "task":
      case "decision":
      case "relationship":
      case "note":
      case "pattern":
      case "custom":
        return category;
      default:
        return "note";
    }
  }

  private localIndexResultToEntry(result: FtsSearchResult): MemoryEntry {
    const createdAt = typeof result.createdAt === "number" ? result.createdAt : Date.now();
    return {
      id: result.id,
      category: this.normalizeMemoryCategory(result.category),
      content: result.content,
      summary: result.summary,
      metadata: {},
      createdAt,
      accessedAt: createdAt,
      namespace: result.namespace ?? this.namespace,
      domain: result.domain,
      topic: result.topic,
      subtopic: result.subtopic,
    };
  }

  private async degradedKeywordSearch(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    const includeSnippets = params.includeSnippets ?? false;
    const limit = params.limit ?? 10;
    const keywordResults = this.runFtsSearch(params, {
      limitMultiplier: 5,
      applyThreshold: true,
    });

    const out: MemorySearchResult[] = [];
    for (const row of keywordResults) {
      const entry = this.localIndexResultToEntry(row);
      if (!this.matchesSearchParams(entry, params)) continue;
      out.push({
        entry,
        score: row.score,
        snippet: includeSnippets ? row.snippet : undefined,
        source: "local-index",
        degraded: true,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  private buildSemanticFilter(params: MemorySearchParams): Record<string, unknown> {
    const filter: Record<string, unknown> = { type: "memory" };

    // Namespace filtering: pass namespace: null to search all namespaces
    if (params.namespace === null) {
      // Explicitly null = search all namespaces (no filter)
    } else {
      filter.namespace = params.namespace ?? this.namespace;
    }

    if (params.category) {
      if (Array.isArray(params.category)) {
        filter.category = { $in: params.category };
      } else {
        filter.category = params.category;
      }
    }

    if (params.tags?.length) {
      filter["metadata.tags"] = { $in: params.tags };
    }

    if (params.timeRange?.start !== undefined || params.timeRange?.end !== undefined) {
      const createdAtRange: Record<string, number> = {};
      if (params.timeRange?.start !== undefined) createdAtRange.$gte = params.timeRange.start;
      if (params.timeRange?.end !== undefined) createdAtRange.$lte = params.timeRange.end;
      filter.createdAt = createdAtRange;
    }

    // Context Tree filters
    if (params.domain) filter.domain = params.domain;
    if (params.topic) filter.topic = params.topic;
    if (params.subtopic) filter.subtopic = params.subtopic;

    // Version Control filters
    if (params.memoryId) filter.memoryId = params.memoryId;
    // Default to non-superseded unless explicitly set
    if (params.superseded !== undefined) {
      filter.superseded = params.superseded;
    } else {
      // Backward compatible: include old points that lack the superseded field
      filter.superseded = {
        $should: [
          { key: "superseded", match: { value: false } },
          { is_null: { key: "superseded" } },
        ],
      };
    }

    // Context Composer filters
    if (params.kind) {
      if (Array.isArray(params.kind)) {
        filter.kind = { $in: params.kind };
      } else {
        filter.kind = params.kind;
      }
    }
    if (params.priority) {
      if (Array.isArray(params.priority)) {
        filter.priority = { $in: params.priority };
      } else {
        filter.priority = params.priority;
      }
    }
    if (params.bookmarked !== undefined) filter.bookmarked = params.bookmarked;

    // Dual Memory filter
    if (params.memoryType) filter.memoryType = params.memoryType;

    // Opinion Confidence range filters
    if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
      const confidenceFilter: Record<string, number> = {};
      if (params.minConfidence !== undefined) confidenceFilter.$gte = params.minConfidence;
      if (params.maxConfidence !== undefined) confidenceFilter.$lte = params.maxConfidence;
      filter.confidence = confidenceFilter;
    }

    return filter;
  }

  private matchesSearchParams(entry: MemoryEntry, params: MemorySearchParams): boolean {
    if (params.namespace !== null) {
      const ns = params.namespace ?? this.namespace;
      if (entry.namespace !== ns) return false;
    }

    if (params.category) {
      if (Array.isArray(params.category)) {
        if (!params.category.includes(entry.category)) return false;
      } else if (entry.category !== params.category) {
        return false;
      }
    }

    if (params.tags?.length) {
      const tags = entry.metadata?.tags;
      if (!Array.isArray(tags)) return false;
      const hasAny = params.tags.some((t) => tags.includes(t));
      if (!hasAny) return false;
    }

    if (params.timeRange?.start !== undefined && entry.createdAt < params.timeRange.start) return false;
    if (params.timeRange?.end !== undefined && entry.createdAt > params.timeRange.end) return false;

    if (params.domain && entry.domain !== params.domain) return false;
    if (params.topic && entry.topic !== params.topic) return false;
    if (params.subtopic && entry.subtopic !== params.subtopic) return false;

    if (params.memoryId && entry.memoryId !== params.memoryId) return false;

    // Default: current-only. Treat missing superseded as current for back-compat.
    if (params.superseded !== undefined) {
      if (entry.superseded !== params.superseded) return false;
    } else {
      if (entry.superseded === true) return false;
    }

    if (params.kind) {
      const kind = entry.kind;
      if (Array.isArray(params.kind)) {
        if (!kind || !params.kind.includes(kind)) return false;
      } else if (kind !== params.kind) {
        return false;
      }
    }

    if (params.priority) {
      const priority = entry.priority;
      if (Array.isArray(params.priority)) {
        if (!priority || !params.priority.includes(priority)) return false;
      } else if (priority !== params.priority) {
        return false;
      }
    }

    if (params.bookmarked !== undefined && entry.bookmarked !== params.bookmarked) return false;
    if (params.memoryType && entry.memoryType !== params.memoryType) return false;

    if (params.minConfidence !== undefined) {
      if (typeof entry.confidence !== "number") return false;
      if (entry.confidence < params.minConfidence) return false;
    }

    if (params.maxConfidence !== undefined) {
      if (typeof entry.confidence !== "number") return false;
      if (entry.confidence > params.maxConfidence) return false;
    }

    return true;
  }

  private async semanticSearch(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    const queryVector = await this.embedding.embed(params.query);
    const filter = this.buildSemanticFilter(params);

    const limit = params.limit ?? 10;
    const threshold = params.threshold ?? 0.5;

    const results = await this.storage.search(queryVector, {
      limit,
      threshold,
      filter,
    });

    if (!params.includeVectors) {
      return results.map((r) => ({
        entry: this.pointToEntry({ id: r.id, payload: r.payload }),
        score: r.score,
        source: "qdrant",
      }));
    }

    const ids = results.map((r) => r.id);
    const fetched = await this.storage.get(ids, { withVector: true });
    const fetchedMap = new Map(
      fetched.filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id, p]),
    );

    return results.map((r) => {
      const point = fetchedMap.get(r.id);
      return {
        entry: point ? this.pointToEntry(point) : this.pointToEntry({ id: r.id, payload: r.payload }),
        score: r.score,
        source: "qdrant",
      };
    });
  }

  private async keywordSearch(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    if (!this.ftsStore) {
      return this.semanticSearch(params);
    }

    const limit = params.limit ?? 10;
    const includeSnippets = params.includeSnippets ?? false;
    const keywordResults = this.runFtsSearch(params, {
      limitMultiplier: 5,
      applyThreshold: true,
    });

    if (keywordResults.length === 0) return [];

    const idMeta = new Map<string, { score: number; snippet?: string }>();
    for (const r of keywordResults) {
      idMeta.set(r.id, { score: r.score, snippet: r.snippet });
    }

    const orderedIds = keywordResults.map((r) => r.id);
    const withVector = params.includeVectors ?? false;

    const out: MemorySearchResult[] = [];
    const maxPerCall = 50;
    const maxTotal = 200;
    let cursor = 0;
    let hydrated = 0;

    while (out.length < limit && cursor < orderedIds.length && hydrated < maxTotal) {
      const batch = orderedIds.slice(cursor, cursor + maxPerCall);
      cursor += maxPerCall;
      hydrated += batch.length;

      const points = await this.storage.get(batch, { withVector });
      for (const point of points) {
        if (!point || point.payload.type !== "memory") continue;
        const entry = this.pointToEntry(point);
        if (!this.matchesSearchParams(entry, params)) continue;

        const meta = idMeta.get(entry.id);
        if (!meta) continue;

        out.push({
          entry,
          score: meta.score,
          snippet: includeSnippets ? meta.snippet : undefined,
          source: "qdrant",
        });
        if (out.length >= limit) break;
      }
    }

    return out;
  }

  private async hybridSearchMode(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    if (!this.ftsStore) {
      return this.semanticSearch(params);
    }

    const limit = params.limit ?? 10;
    const includeSnippets = params.includeSnippets ?? false;
    // Vector search (recall) + keyword search (BM25) merged via weights.
    const [vectorResults, keywordResults] = await Promise.all([
      this.semanticSearch({
        ...params,
        limit: limit * 2,
        threshold: params.threshold ?? 0.5,
      }),
      Promise.resolve(this.runFtsSearch(params, { limitMultiplier: 4, applyThreshold: false })),
    ]);

    const merged = mergeHybridResults(
      vectorResults,
      keywordResults.map((kr) => ({ id: kr.id, score: kr.score, snippet: kr.snippet })),
      {
        limit,
        threshold: params.threshold ?? 0.3,
      },
    );

    const missingIds = merged.filter((m) => !m.entry).map((m) => m.id);
    const withVector = params.includeVectors ?? false;
    const hydrated = missingIds.length
      ? await this.storage.get(missingIds.slice(0, 200), { withVector })
      : [];
    const hydratedMap = new Map(
      hydrated.filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id, p]),
    );

    const out: MemorySearchResult[] = [];
    for (const item of merged) {
      let entry = item.entry ?? null;

      if (!entry) {
        const point = hydratedMap.get(item.id);
        if (!point || point.payload.type !== "memory") continue;
        entry = this.pointToEntry(point);
      }

      if (!this.matchesSearchParams(entry, params)) continue;

      out.push({
        entry,
        score: item.score,
        snippet: includeSnippets ? item.snippet : undefined,
        source: "qdrant",
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  /** Get a memory by ID */
  async get(id: string): Promise<MemoryEntry | null> {
    await this.init();

    const results = await this.storage.get([id]);
    const point = results[0];
    if (!point || point.payload.type !== "memory") return null;

    return this.pointToEntry(point);
  }

  /** List memories with optional filters */
  async list(options: {
    category?: MemoryCategory;
    namespace?: string;
    limit?: number;
  } = {}): Promise<MemoryEntry[]> {
    await this.init();

    const filter: Record<string, unknown> = {
      type: "memory",
      namespace: options.namespace ?? this.namespace,
    };
    if (options.category) {
      filter.category = options.category;
    }

    const count = await this.storage.count(filter);
    if (count === 0) return [];

    // Use dummy vector to list all matching entries
    const dummyVector = new Array(this.embedding.dimension).fill(0);
    const results = await this.storage.search(dummyVector, {
      limit: options.limit ?? 100,
      filter,
    });

    return results.map((r) => this.pointToEntry({ id: r.id, payload: r.payload }));
  }

  /** Delete a memory by ID */
  async delete(id: string): Promise<void> {
    await this.init();
    await this.storage.delete([id]);
    if (this.ftsStore) {
      try {
        this.ftsStore.delete(id);
      } catch (ftsErr) {
        log.debug("FTS delete failed (non-fatal)", {
          id,
          error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
        });
      }
    }
  }

  /** Delete memories matching filter */
  async deleteWhere(filter: {
    category?: MemoryCategory;
    namespace?: string;
    olderThan?: number;
  }): Promise<number> {
    await this.init();

    const qdrantFilter: Record<string, unknown> = { type: "memory" };
    if (filter.category) qdrantFilter.category = filter.category;
    if (filter.namespace) qdrantFilter.namespace = filter.namespace;
    if (filter.olderThan) qdrantFilter.createdAt = { $lt: filter.olderThan };

    return this.storage.deleteWhere(qdrantFilter);
  }

  /** Delete expired memories */
  async deleteExpired(): Promise<number> {
    await this.init();
    const now = Date.now();
    return this.storage.deleteWhere({
      type: "memory",
      expiresAt: { $lt: now, $gt: 0 },
    });
  }

  // ===========================================================================
  // Context Tree Navigation
  // ===========================================================================

  /** Upsert directory index points for context tree navigation */
  private async upsertTreeIndexes(
    domain: string,
    topic?: string,
    subtopic?: string,
  ): Promise<void> {
    const now = Date.now();
    const dummyVector = new Array(this.embedding.dimension).fill(0);

    // Domain-level index
    const domainId = this.treePointId(domain);
    await this.upsertTreeNode(domainId, dummyVector, {
      type: "tree_index",
      level: "domain",
      domain,
      createdAt: now,
      updatedAt: now,
    });

    // Topic-level index
    if (topic) {
      const topicId = this.treePointId(`${domain}/${topic}`);
      await this.upsertTreeNode(topicId, dummyVector, {
        type: "tree_index",
        level: "topic",
        domain,
        topic,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Subtopic-level index
    if (topic && subtopic) {
      const subtopicId = this.treePointId(`${domain}/${topic}/${subtopic}`);
      await this.upsertTreeNode(subtopicId, dummyVector, {
        type: "tree_index",
        level: "subtopic",
        domain,
        topic,
        subtopic,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /** Upsert a single tree index node (create or update timestamp) */
  private async upsertTreeNode(
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const existing = await this.storage.get([id]);
      if (existing[0]) {
        // Already exists, just update timestamp
        await this.storage.update(id, { updatedAt: Date.now() });
      } else {
        await this.storage.insert([{ id, vector, payload }]);
      }
    } catch (err) {
      log.debug("Tree index upsert failed", {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** List all domains in the context tree */
  async listDomains(): Promise<Array<{ domain: string; updatedAt: number }>> {
    await this.init();
    if (!this.isAvailable()) return [];

    const result = await this.storage.scroll({
      filter: { type: "tree_index", level: "domain" },
      limit: 1000,
    });

    return result.points.map((p) => ({
      domain: p.payload.domain as string,
      updatedAt: p.payload.updatedAt as number,
    }));
  }

  /** List topics within a domain */
  async listTopics(domain: string): Promise<Array<{ topic: string; updatedAt: number }>> {
    await this.init();
    if (!this.isAvailable()) return [];

    const result = await this.storage.scroll({
      filter: { type: "tree_index", level: "topic", domain },
      limit: 1000,
    });

    return result.points.map((p) => ({
      topic: p.payload.topic as string,
      updatedAt: p.payload.updatedAt as number,
    }));
  }

  /** List subtopics within a domain/topic */
  async listSubtopics(
    domain: string,
    topic: string,
  ): Promise<Array<{ subtopic: string; updatedAt: number }>> {
    await this.init();
    if (!this.isAvailable()) return [];

    const result = await this.storage.scroll({
      filter: { type: "tree_index", level: "subtopic", domain, topic },
      limit: 1000,
    });

    return result.points.map((p) => ({
      subtopic: p.payload.subtopic as string,
      updatedAt: p.payload.updatedAt as number,
    }));
  }

  // ===========================================================================
  // Agentic Search (filter-first retrieval)
  // ===========================================================================
  // Hybrid Search (Vector + Keyword)
  // ===========================================================================

  /**
   * Hybrid search combining Qdrant vector similarity with SQLite BM25 keyword search.
   * Falls back to pure vector search if FTS is not available.
   *
   * @param params - Standard memory search parameters
   * @param hybridConfig - Optional weight and threshold overrides
   */
  async hybridSearch(
    params: MemorySearchParams,
    hybridConfig?: HybridSearchConfig,
  ): Promise<HybridSearchResult[]> {
    await this.init();

    if (!this.isAvailable()) {
      log.warn("Hybrid search skipped - storage unavailable");
      return [];
    }

    // Run vector search (always)
    const vectorResults = await this.semanticSearch(params);

    // If FTS is not available, return vector results in hybrid format
    if (!this.ftsStore) {
      return vectorResults.map((vr) => ({
        entry: vr.entry,
        score: vr.score,
        components: { vector: vr.score, keyword: 0 },
        id: vr.entry.id,
      }));
    }

    // Run keyword search in parallel
    const keywordResults = this.ftsStore.search(params.query, {
      limit: (params.limit ?? 10) * 2, // fetch more for better merge
      namespace: params.namespace === null ? undefined : (params.namespace ?? this.namespace),
      category: typeof params.category === "string" ? params.category : undefined,
      domain: params.domain,
      topic: params.topic,
      subtopic: params.subtopic,
      timeRange: params.timeRange,
      includeSnippets: params.includeSnippets ?? false,
    });

    // Merge using configurable weights
    return mergeHybridResults(
      vectorResults,
      keywordResults.map((kr) => ({
        id: kr.id,
        score: kr.score,
        snippet: kr.snippet,
      })),
      {
        limit: params.limit ?? 10,
        threshold: params.threshold ?? 0.3,
        ...hybridConfig,
      },
    );
  }

  /** Whether hybrid (FTS) search is available */
  get hybridAvailable(): boolean {
    return this.localIndex.enabled && !!this.ftsStore;
  }

  getLocalIndexStatus(): {
    enabled: boolean;
    backend: LocalIndexBackend;
    available: boolean;
    degradedRead: LocalIndexDegradedReadMode;
    initFailed: boolean;
    totalEntries?: number;
    dbSizeBytes?: number;
  } {
    const status: {
      enabled: boolean;
      backend: LocalIndexBackend;
      available: boolean;
      degradedRead: LocalIndexDegradedReadMode;
      initFailed: boolean;
      totalEntries?: number;
      dbSizeBytes?: number;
    } = {
      enabled: this.localIndex.enabled,
      backend: this.localIndex.backend,
      available: this.hybridAvailable,
      degradedRead: this.localIndex.degradedRead,
      initFailed: this.ftsInitFailed,
    };

    if (this.ftsStore) {
      try {
        const ftsStats = this.ftsStore.stats();
        status.totalEntries = ftsStats.totalEntries;
        status.dbSizeBytes = ftsStats.dbSizeBytes;
      } catch (ftsErr) {
        log.debug("FTS stats failed (non-fatal)", {
          error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
        });
      }
    }

    return status;
  }

  // ===========================================================================

  /** Filter-first memory retrieval with optional semantic refinement */
  async agenticSearch(params: AgenticSearchParams & { namespace?: string | null }): Promise<MemorySearchResult[]> {
    await this.init();
    if (!this.isAvailable()) return [];

    // Build filter from structured params
    const filter: Record<string, unknown> = {
      type: "memory",
      domain: params.domain,
    };

    // Namespace filtering: null = all namespaces, undefined = use instance default
    if (params.namespace === null) {
      // Explicitly null = search all namespaces (no filter)
    } else if (params.namespace !== undefined) {
      filter.namespace = params.namespace;
    } else {
      filter.namespace = this.namespace;
    }

    if (params.topic) filter.topic = params.topic;
    if (params.subtopic) filter.subtopic = params.subtopic;

    // Default: only current (non-superseded) versions
    if (params.currentOnly !== false) {
      filter.superseded = {
        $should: [
          { key: "superseded", match: { value: false } },
          { is_null: { key: "superseded" } },
        ],
      };
    }

    if (params.kind) {
      filter.kind = Array.isArray(params.kind) ? { $in: params.kind } : params.kind;
    }
    if (params.priority) {
      filter.priority = Array.isArray(params.priority) ? { $in: params.priority } : params.priority;
    }
    if (params.bookmarked !== undefined) filter.bookmarked = params.bookmarked;
    if (params.memoryType) filter.memoryType = params.memoryType;

    const limit = params.limit ?? 20;

    if (params.query) {
      // Semantic search within filtered set
      const queryVector = await this.embedding.embed(params.query);
      const results = await this.storage.search(queryVector, {
        limit,
        threshold: params.threshold ?? 0.3,
        filter,
      });

      return results.map((r) => ({
        entry: this.pointToEntry({ id: r.id, payload: r.payload }),
        score: r.score,
      }));
    }

    // No query: deterministic scroll
    const scrollResult = await this.storage.scroll({
      filter,
      limit,
      orderBy: { key: "createdAt", direction: "desc" },
    });

    return scrollResult.points.map((p) => ({
      entry: this.pointToEntry(p),
      score: 1.0, // No similarity score for non-vector retrieval
    }));
  }

  // ===========================================================================
  // Version Control
  // ===========================================================================

  /** Get version history for a memory (all versions, sorted by version number) */
  async getMemoryHistory(memoryId: string): Promise<MemoryEntry[]> {
    await this.init();
    if (!this.isAvailable()) return [];

    const result = await this.storage.scroll({
      filter: { type: "memory", memoryId },
      limit: 100,
    });

    const entries = result.points.map((p) => this.pointToEntry(p));
    entries.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    return entries;
  }

  /** Rollback a memory to a target version */
  async rollbackMemory(memoryId: string, targetVersion: number): Promise<MemoryEntry | null> {
    await this.init();
    if (!this.isAvailable()) return null;

    const history = await this.getMemoryHistory(memoryId);
    if (history.length === 0) return null;

    const target = history.find((e) => e.version === targetVersion);
    if (!target) return null;

    // Mark all versions > target as superseded, and target as current
    for (const entry of history) {
      const shouldBeSuperseded = (entry.version ?? 1) > targetVersion;
      const isCurrent = entry.version === targetVersion;

      if (isCurrent) {
        await this.storage.update(entry.id, { superseded: false });
        if (this.ftsStore) {
          try {
            this.ftsStore.index({
              id: entry.id,
              content: entry.content,
              summary: entry.summary,
              category: entry.category,
              namespace: entry.namespace,
              domain: entry.domain,
              topic: entry.topic,
              subtopic: entry.subtopic,
              createdAt: entry.createdAt,
            });
          } catch (ftsErr) {
            log.debug("FTS re-index failed for rolled-back current version (non-fatal)", {
              id: entry.id,
              error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
            });
          }
        }
      } else if (shouldBeSuperseded) {
        await this.storage.update(entry.id, { superseded: true });
        if (this.ftsStore) {
          try {
            this.ftsStore.delete(entry.id);
          } catch (ftsErr) {
            log.debug("FTS delete failed for rolled-back superseded version (non-fatal)", {
              id: entry.id,
              error: ftsErr instanceof Error ? ftsErr.message : String(ftsErr),
            });
          }
        }
      }
    }

    target.superseded = false;
    return target;
  }

  // ===========================================================================
  // Opinion Confidence
  // ===========================================================================

  /**
   * Reinforce a belief with supporting evidence.
   * Increases confidence (capped at 1.0) and appends to evidenceFor.
   */
  async reinforceBelief(
    id: string,
    evidence: string,
    boost: number = 0.1,
  ): Promise<MemoryEntry | null> {
    await this.init();
    if (!this.isAvailable()) return null;

    const entry = await this.get(id);
    if (!entry) return null;

    const currentConfidence = entry.confidence ?? 0.5;
    const newConfidence = Math.min(1.0, currentConfidence + boost);
    const evidenceFor = [...(entry.evidenceFor ?? []), evidence];
    const now = Date.now();

    await this.storage.update(id, {
      confidence: newConfidence,
      evidenceFor,
      lastChallenged: now,
    });

    entry.confidence = newConfidence;
    entry.evidenceFor = evidenceFor;
    entry.lastChallenged = now;
    return entry;
  }

  /**
   * Challenge a belief with contradicting evidence.
   * Decreases confidence (floored at 0.0) and appends to evidenceAgainst.
   */
  async challengeBelief(
    id: string,
    evidence: string,
    penalty: number = 0.15,
  ): Promise<MemoryEntry | null> {
    await this.init();
    if (!this.isAvailable()) return null;

    const entry = await this.get(id);
    if (!entry) return null;

    const currentConfidence = entry.confidence ?? 0.5;
    const newConfidence = Math.max(0.0, currentConfidence - penalty);
    const evidenceAgainst = [...(entry.evidenceAgainst ?? []), evidence];
    const now = Date.now();

    await this.storage.update(id, {
      confidence: newConfidence,
      evidenceAgainst,
      lastChallenged: now,
    });

    entry.confidence = newConfidence;
    entry.evidenceAgainst = evidenceAgainst;
    entry.lastChallenged = now;
    return entry;
  }

  // ===========================================================================
  // Context Composer (Curated Context)
  // ===========================================================================

  /** Get curated context: bookmarked + high-priority memories */
  async getCuratedContext(options?: {
    limit?: number;
    /** Namespace filter. Null = all namespaces, undefined = instance default. */
    namespace?: string | null;
  }): Promise<MemoryEntry[]> {
    await this.init();
    if (!this.isAvailable()) return [];

    const limit = options?.limit ?? 50;
    const seen = new Set<string>();
    const results: MemoryEntry[] = [];

    // Resolve namespace: null = all, undefined = instance default
    const nsFilter: Record<string, unknown> =
      options?.namespace === null ? {} :
      { namespace: options?.namespace ?? this.namespace };

    // Pass 1: curated + bookmarked
    const bookmarked = await this.storage.scroll({
      filter: {
        type: "memory",
        kind: "curated",
        bookmarked: true,
        superseded: {
          $should: [
            { key: "superseded", match: { value: false } },
            { is_null: { key: "superseded" } },
          ],
        },
        ...nsFilter,
      },
      limit,
    });

    for (const p of bookmarked.points) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        results.push(this.pointToEntry(p));
      }
    }

    // Pass 2: high-priority (fill remaining slots)
    if (results.length < limit) {
      const highPri = await this.storage.scroll({
        filter: {
          type: "memory",
          priority: "high",
          superseded: {
            $should: [
              { key: "superseded", match: { value: false } },
              { is_null: { key: "superseded" } },
            ],
          },
          ...nsFilter,
        },
        limit: limit - results.length,
      });

      for (const p of highPri.points) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(this.pointToEntry(p));
        }
      }
    }

    return results;
  }

  // ===========================================================================
  // Multimodal Operations
  // ===========================================================================

  /**
   * Save a memory entry with multimodal content.
   * Uses multimodal embedding if provider supports it, falls back to text embedding.
   */
  async saveMultimodal(input: MemoryInput): Promise<MemoryEntry> {
    await this.init();

    if (!this.isAvailable()) {
      log.warn("Memory saveMultimodal skipped - storage unavailable", { category: input.category });
      return this.save(input); // Fallback to regular save
    }

    const id = randomUUID();
    const now = Date.now();

    // Generate embedding
    let vector: number[];
    if (input.multimodal && this.embedding.supportsMultimodal && this.embedding.embedMultimodal) {
      // Use multimodal embedding
      vector = await this.embedding.embedMultimodal(input.multimodal);
    } else {
      // Fallback to text embedding
      vector = await this.embedding.embed(input.content);
      if (input.multimodal) {
        log.debug("Multimodal content provided but provider does not support it, using text embedding");
      }
    }

    const entry: MemoryEntry = {
      id,
      category: input.category,
      content: input.content,
      summary: input.summary,
      embedding: vector,
      metadata: input.metadata ?? {},
      media: input.media,
      createdAt: now,
      accessedAt: now,
      ttl: input.ttl,
      namespace: input.namespace ?? this.namespace,
    };

    await this.storage.insert([{
      id,
      vector,
      payload: {
        type: "memory" as EntryType,
        category: entry.category,
        content: entry.content,
        summary: entry.summary,
        metadata: entry.metadata,
        media: entry.media,
        createdAt: entry.createdAt,
        accessedAt: entry.accessedAt,
        ttl: entry.ttl,
        expiresAt: entry.ttl ? entry.createdAt + entry.ttl : 0,
        namespace: entry.namespace,
      },
    }]);

    return entry;
  }

  /**
   * Search memories using multimodal query.
   * Uses multimodal embedding if provider supports it, falls back to text search.
   */
  async searchMultimodal(
    query: string | MultimodalContent,
    params?: Omit<MemorySearchParams, "query"> & {
      /** Filter by media type */
      mediaType?: "text" | "image" | "video";
    }
  ): Promise<MemorySearchResult[]> {
    await this.init();

    if (!this.isAvailable()) {
      const queryText = typeof query === "string" ? query : "[multimodal]";
      log.warn("Memory searchMultimodal skipped - storage unavailable", { query: queryText.slice(0, 50) });
      return [];
    }

    // Generate query vector
    let queryVector: number[];
    if (typeof query === "string") {
      queryVector = await this.embedding.embed(query);
    } else if (this.embedding.supportsMultimodal && this.embedding.embedMultimodal) {
      queryVector = await this.embedding.embedMultimodal(query);
    } else {
      // Fallback: extract text from multimodal content
      const textContent = query.contents
        .filter((c): c is { type: "text"; content: string } => c.type === "text")
        .map((c) => c.content)
        .join(" ");
      queryVector = await this.embedding.embed(textContent || "search");
      log.debug("Multimodal query provided but provider does not support it, using text embedding");
    }

    // Build filter
    const filter: Record<string, unknown> = { type: "memory" };

    if (params?.namespace === null) {
      // Search all namespaces
    } else {
      filter.namespace = params?.namespace ?? this.namespace;
    }

    if (params?.category) {
      if (Array.isArray(params.category)) {
        filter.category = { $in: params.category };
      } else {
        filter.category = params.category;
      }
    }

    if (params?.tags?.length) {
      filter["metadata.tags"] = { $in: params.tags };
    }

    if (params?.mediaType) {
      filter["media.mediaType"] = params.mediaType;
    }

    const results = await this.storage.search(queryVector, {
      limit: params?.limit ?? 10,
      threshold: params?.threshold ?? 0.5,
      filter,
    });

    return results.map((r) => ({
      entry: {
        id: r.id,
        category: r.payload.category as MemoryCategory,
        content: r.payload.content as string,
        summary: r.payload.summary as string | undefined,
        metadata: r.payload.metadata as MemoryEntry["metadata"],
        media: r.payload.media as MediaMetadata | undefined,
        createdAt: r.payload.createdAt as number,
        accessedAt: r.payload.accessedAt as number,
        ttl: r.payload.ttl as number | undefined,
        namespace: r.payload.namespace as string | undefined,
      },
      score: r.score,
    }));
  }

  /**
   * Two-stage retrieval: embedding search (recall) + reranking (precision).
   * Fetches more candidates than needed, then reranks for better precision.
   */
  async searchWithRerank(
    query: string | MultimodalContent,
    params?: Omit<MemorySearchParams, "query"> & {
      /** Enable reranking (requires configured reranker) */
      rerank?: boolean;
      /** Recall multiplier: how many extra candidates to fetch for reranking */
      recallMultiplier?: number;
      /** Filter by media type */
      mediaType?: "text" | "image" | "video";
    }
  ): Promise<MemorySearchResult[]> {
    const limit = params?.limit ?? 10;
    const recallMultiplier = params?.recallMultiplier ?? 3;

    // Stage 1: Embedding-based recall (fetch more candidates)
    const candidates = await this.searchMultimodal(query, {
      ...params,
      limit: params?.rerank ? limit * recallMultiplier : limit,
    });

    if (!params?.rerank || candidates.length === 0) {
      return candidates.slice(0, limit);
    }

    // Initialize reranker if needed
    if (!this.reranker && this.rerankerConfig?.enabled) {
      const { createReranker } = await import("./reranker");
      this.reranker = createReranker(this.rerankerConfig) ?? undefined;
    }

    if (!this.reranker) {
      log.debug("Rerank requested but no reranker configured");
      return candidates.slice(0, limit);
    }

    // Stage 2: Rerank candidates
    try {
      const documents = candidates.map((c) => c.entry.content);
      const queryText = typeof query === "string" ? query : this.extractTextFromMultimodal(query);

      const reranked = await this.reranker.rerank(queryText, documents, { topK: limit });

      return reranked.map((r) => ({
        ...candidates[r.index],
        score: r.score, // Replace embedding score with rerank score
      }));
    } catch (error) {
      log.warn("Reranking failed, returning original results", {
        error: error instanceof Error ? error.message : String(error),
      });
      return candidates.slice(0, limit);
    }
  }

  /** Extract text content from multimodal content */
  private extractTextFromMultimodal(content: MultimodalContent): string {
    return content.contents
      .filter((c): c is { type: "text"; content: string } => c.type === "text")
      .map((c) => c.content)
      .join(" ");
  }

  /** Check if the embedding provider supports multimodal */
  supportsMultimodal(): boolean {
    return this.embedding.supportsMultimodal ?? false;
  }

  // ===========================================================================
  // State Persistence (Personas orchestration state)
  // ===========================================================================

  private getStateId(): string {
    return stringToUUID(`state-${this.instanceId}`);
  }

  /** Save personas state */
  async saveState(state: PersonasState): Promise<void> {
    await this.init();

    const stateJson = JSON.stringify(state);
    const stateId = this.getStateId();

    // Generate summary for embedding
    const summary = this.generateStateSummary(state);
    const embedding = await this.embedding.embed(summary);

    await this.storage.insert([{
      id: stateId,
      vector: embedding,
      payload: {
        type: "state" as EntryType,
        state: stateJson,
        summary,
        version: state.version,
        updatedAt: Date.now(),
      },
    }]);

    // Also save conversation state if present
    if (state.conversation) {
      await this.saveConversation(state.conversation);
    }
  }

  /** Load personas state */
  async loadState(): Promise<PersonasState | null> {
    await this.init();

    const stateId = this.getStateId();
    const results = await this.storage.get([stateId]);
    const result = results[0];

    if (!result?.payload?.state) return null;

    try {
      return JSON.parse(result.payload.state as string) as PersonasState;
    } catch {
      return null;
    }
  }

  private generateStateSummary(state: PersonasState): string {
    const parts: string[] = [`Personas state v${state.version}`];

    if (state.workers.length > 0) {
      const workersByPersona = state.workers.reduce(
        (acc, w) => {
          acc[w.persona] = (acc[w.persona] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      parts.push(`Workers: ${JSON.stringify(workersByPersona)}`);
    }

    if (state.tasks.length > 0) {
      const pending = state.tasks.filter((t) => t.status === "pending").length;
      const running = state.tasks.filter((t) => t.status === "running").length;
      parts.push(`Tasks: ${pending} pending, ${running} running`);
    }

    if (state.conversation) {
      parts.push(`Lead: ${state.conversation.leadPersona}`);
      parts.push(`Summary: ${state.conversation.summary.slice(0, 200)}`);
    }

    parts.push(`Stats: ${state.stats.totalTasksCompleted} tasks completed`);

    return parts.join("\n");
  }

  // ===========================================================================
  // Conversation Continuity
  // ===========================================================================

  /** Save conversation state */
  async saveConversation(state: ConversationState): Promise<void> {
    await this.init();

    const conversationId = stringToUUID(`conversation-${state.sessionId}`);

    // Create rich summary for embedding
    const summaryParts = [
      state.summary,
      `Plan: ${state.plan}`,
      `Objectives: ${state.objectives.join(", ")}`,
      `Key facts: ${state.keyFacts.join("; ")}`,
    ];
    const fullSummary = summaryParts.filter(Boolean).join("\n");
    const embedding = await this.embedding.embed(fullSummary);

    await this.storage.insert([{
      id: conversationId,
      vector: embedding,
      payload: {
        type: "conversation" as EntryType,
        sessionId: state.sessionId,
        leadPersona: state.leadPersona,
        summary: state.summary,
        plan: state.plan,
        objectives: state.objectives,
        keyFacts: state.keyFacts,
        sessionChain: state.sessionChain,
        updatedAt: state.updatedAt,
      },
    }]);

    // Also store session chain index
    const chainId = stringToUUID(`session-chain-${state.sessionId}`);
    await this.storage.insert([{
      id: chainId,
      vector: embedding,
      payload: {
        type: "session_chain" as EntryType,
        sessionId: state.sessionId,
        previousSessions: state.sessionChain,
        updatedAt: state.updatedAt,
      },
    }]);
  }

  /** Load conversation state by session ID */
  async loadConversation(sessionId: string): Promise<ConversationState | null> {
    await this.init();

    const conversationId = stringToUUID(`conversation-${sessionId}`);
    const results = await this.storage.get([conversationId]);
    const result = results[0];

    if (!result?.payload || result.payload.type !== "conversation") return null;

    const p = result.payload as Record<string, unknown>;
    return {
      sessionId: p.sessionId as string,
      leadPersona: p.leadPersona as PersonaId,
      summary: p.summary as string,
      plan: (p.plan as string) ?? "",
      objectives: (p.objectives as string[]) ?? [],
      keyFacts: (p.keyFacts as string[]) ?? [],
      sessionChain: (p.sessionChain as string[]) ?? [],
      updatedAt: p.updatedAt as number,
    };
  }

  /** Find most recent conversation (optionally for specific persona) */
  async findRecentConversation(persona?: PersonaId): Promise<ConversationState | null> {
    await this.init();

    const query = persona
      ? `Recent conversation with ${persona}`
      : "Recent conversation state";

    const embedding = await this.embedding.embed(query);
    const filter: Record<string, unknown> = { type: "conversation" };
    if (persona) filter.leadPersona = persona;

    const results = await this.storage.search(embedding, {
      limit: 1,
      filter,
    });

    if (results.length === 0) return null;

    const p = results[0].payload as Record<string, unknown>;
    return {
      sessionId: p.sessionId as string,
      leadPersona: p.leadPersona as PersonaId,
      summary: p.summary as string,
      plan: (p.plan as string) ?? "",
      objectives: (p.objectives as string[]) ?? [],
      keyFacts: (p.keyFacts as string[]) ?? [],
      sessionChain: (p.sessionChain as string[]) ?? [],
      updatedAt: p.updatedAt as number,
    };
  }

  /** Start a new conversation session (with continuity from previous) */
  async startSession(
    sessionId: string,
    leadPersona: PersonaId,
    previousSessionId?: string
  ): Promise<ConversationState> {
    // Try to load previous session
    let previousState: ConversationState | null = null;
    if (previousSessionId) {
      previousState = await this.loadConversation(previousSessionId);
    } else {
      previousState = await this.findRecentConversation(leadPersona);
    }

    // Create new state
    this.currentConversation = {
      sessionId,
      leadPersona,
      summary: "",
      plan: previousState?.plan ?? "",
      objectives: previousState?.objectives ?? [],
      keyFacts: previousState?.keyFacts.slice(-this.maxKeyFacts) ?? [],
      sessionChain: previousState
        ? [...previousState.sessionChain, previousState.sessionId]
        : [],
      updatedAt: Date.now(),
    };

    await this.saveConversation(this.currentConversation);
    return this.currentConversation;
  }

  /** Get current conversation state */
  getCurrentConversation(): ConversationState | undefined {
    return this.currentConversation;
  }

  /** Process messages and extract facts */
  async processMessages(messages: string[]): Promise<ConversationState> {
    if (!this.currentConversation) {
      throw new Error("No active session. Call startSession first.");
    }

    // Extract facts from new messages
    const newFacts: string[] = [];
    for (const msg of messages) {
      newFacts.push(...extractKeyFacts(msg));
    }

    // Update state
    this.currentConversation = {
      ...this.currentConversation,
      summary: generateSummary(messages),
      keyFacts: mergeFacts(
        this.currentConversation.keyFacts,
        newFacts,
        this.maxKeyFacts
      ),
      updatedAt: Date.now(),
    };

    // Save to Qdrant
    await this.saveConversation(this.currentConversation);

    // Store individual facts as memories (persona-isolated)
    if (newFacts.length > 0) {
      await this.storeKeyFacts(
        newFacts,
        this.currentConversation.sessionId,
        this.currentConversation.leadPersona
      );
    }

    return this.currentConversation;
  }

  /** Store key facts as searchable memories */
  async storeKeyFacts(facts: string[], sessionId: string, persona: PersonaId): Promise<void> {
    await this.init();

    for (const fact of facts) {
      await this.save({
        category: "fact",
        content: fact,
        metadata: {
          sessionId,
          agent: persona,
          extra: { extractedAt: Date.now() },
        },
        namespace: `personas:${persona}`,
      });
    }
  }

  /** Update plan */
  async updatePlan(plan: string): Promise<void> {
    if (!this.currentConversation) {
      throw new Error("No active session");
    }

    this.currentConversation.plan = plan;
    this.currentConversation.updatedAt = Date.now();
    await this.saveConversation(this.currentConversation);
  }

  /** Add objective */
  async addObjective(objective: string): Promise<void> {
    if (!this.currentConversation) {
      throw new Error("No active session");
    }

    this.currentConversation.objectives.push(objective);
    this.currentConversation.updatedAt = Date.now();
    await this.saveConversation(this.currentConversation);
  }

  /** Remove objective by index */
  async removeObjective(index: number): Promise<void> {
    if (!this.currentConversation) {
      throw new Error("No active session");
    }

    if (index >= 0 && index < this.currentConversation.objectives.length) {
      this.currentConversation.objectives.splice(index, 1);
      this.currentConversation.updatedAt = Date.now();
      await this.saveConversation(this.currentConversation);
    }
  }

  /** End session */
  async endSession(): Promise<void> {
    if (!this.currentConversation) return;

    await this.saveConversation(this.currentConversation);
    this.currentConversation = undefined;
  }

  /** Format conversation state for prompt injection */
  formatContextForPrompt(): string {
    if (!this.currentConversation) return "";

    const state = this.currentConversation;
    const parts: string[] = ["# Conversation Context (Restored)", ""];

    if (state.summary) {
      parts.push("## Previous Conversation Summary");
      parts.push(state.summary);
      parts.push("");
    }

    if (state.plan) {
      parts.push("## Current Plan");
      parts.push(state.plan);
      parts.push("");
    }

    if (state.objectives.length > 0) {
      parts.push("## Active Objectives");
      state.objectives.forEach((obj, i) => {
        parts.push(`${i + 1}. ${obj}`);
      });
      parts.push("");
    }

    if (state.keyFacts.length > 0) {
      parts.push("## Key Facts");
      state.keyFacts.forEach((fact) => {
        parts.push(`- ${fact}`);
      });
      parts.push("");
    }

    if (state.sessionChain.length > 0) {
      parts.push(`_This is session ${state.sessionChain.length + 1} in a continuing conversation._`);
    }

    return parts.join("\n");
  }

  // ===========================================================================
  // Cross-Session Memory Injection (for bootstrap/personas.ts)
  // ===========================================================================

  /** Search memories for a specific persona */
  async searchPersonaMemories(
    query: string,
    persona: PersonaId,
    options?: { limit?: number; categories?: MemoryCategory[] }
  ): Promise<MemorySearchResult[]> {
    return this.search({
      query,
      namespace: `personas:${persona}`,
      category: options?.categories,
      limit: options?.limit ?? 5,
      threshold: 0.6,
    });
  }

  /** Search memories across all personas */
  async searchAllPersonaMemories(
    query: string,
    limit = 10
  ): Promise<Array<{ id: string; content: string; score: number; persona?: string }>> {
    await this.init();

    // Search without namespace filter to get all memories
    const queryVector = await this.embedding.embed(query);
    const results = await this.storage.search(queryVector, {
      limit,
      filter: { type: "memory" },
    });

    return results.map((r) => ({
      id: r.id,
      content: r.payload.content as string,
      score: r.score,
      persona: r.payload.namespace?.toString().replace("personas:", ""),
    }));
  }

  /** Get memories by IDs */
  async getMemories(ids: string[]): Promise<Array<{ id: string; content: string }>> {
    await this.init();

    const memories: Array<{ id: string; content: string }> = [];
    for (const id of ids) {
      const memory = await this.get(id);
      if (memory) {
        memories.push({ id: memory.id, content: memory.content });
      }
    }
    return memories;
  }

  /** Get relevant context for a task */
  async getTaskContext(
    taskDescription: string,
    options?: {
      limit?: number;
      sessionId?: string;
      persona?: PersonaId;
    }
  ): Promise<{
    relevantMemories: Array<{ content: string; score: number }>;
    conversationState?: ConversationState;
  }> {
    await this.init();

    const limit = options?.limit ?? 5;

    // Search for relevant memories
    const results = await this.searchPersonaMemories(
      taskDescription,
      options?.persona ?? "zee",
      { limit }
    );

    // Load conversation state
    let conversationState: ConversationState | undefined;
    if (options?.sessionId) {
      const state = await this.loadConversation(options.sessionId);
      if (state) conversationState = state;
    } else {
      const recent = await this.findRecentConversation(options?.persona);
      if (recent) conversationState = recent;
    }

    return {
      relevantMemories: results.map((r) => ({
        content: r.entry.content,
        score: r.score,
      })),
      conversationState,
    };
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /** Get memory statistics */
  async stats(): Promise<{
    total: number;
    byType: Record<EntryType, number>;
    byCategory: Record<string, number>;
    fts?: { totalEntries: number; dbSizeBytes: number };
    localIndex: {
      enabled: boolean;
      backend: LocalIndexBackend;
      available: boolean;
      degradedRead: LocalIndexDegradedReadMode;
      initFailed: boolean;
      totalEntries?: number;
      dbSizeBytes?: number;
    };
  }> {
    await this.init();

    const types: EntryType[] = ["memory", "state", "conversation", "session_chain"];
    const categories: MemoryCategory[] = [
      "conversation", "fact", "preference", "task",
      "decision", "relationship", "note", "pattern",
    ];
    const localIndex = this.getLocalIndexStatus();
    const fts =
      localIndex.available &&
      typeof localIndex.totalEntries === "number" &&
      typeof localIndex.dbSizeBytes === "number"
        ? { totalEntries: localIndex.totalEntries, dbSizeBytes: localIndex.dbSizeBytes }
        : undefined;

    if (!this.isAvailable()) {
      const byType = types.reduce(
        (acc, type) => ({ ...acc, [type]: 0 }),
        {} as Record<EntryType, number>,
      );
      const byCategory = categories.reduce(
        (acc, category) => ({ ...acc, [category]: 0 }),
        {} as Record<string, number>,
      );

      return {
        total: 0,
        byType,
        byCategory,
        ...(fts ? { fts } : {}),
        localIndex,
      };
    }

    const total = await this.storage.count();
    const byType: Record<string, number> = {};
    for (const type of types) {
      byType[type] = await this.storage.count({ type });
    }

    const byCategory: Record<string, number> = {};
    for (const cat of categories) {
      byCategory[cat] = await this.storage.count({ type: "memory", category: cat });
    }

    return {
      total,
      byType: byType as Record<EntryType, number>,
      byCategory,
      ...(fts ? { fts } : {}),
      localIndex,
    };
  }

  /** Cleanup old entries */
  async cleanup(): Promise<number> {
    return this.deleteExpired();
  }

  // ===========================================================================
  // Session Restoration (from ContinuityManager)
  // ===========================================================================

  /** Restore a previous session by ID */
  async restoreSession(sessionId: string): Promise<ConversationState | null> {
    await this.init();

    const state = await this.loadConversation(sessionId);
    if (state) {
      this.currentConversation = state;
    }
    return state;
  }

  /** Search for related context and return content strings */
  async searchRelatedContext(query: string, limit = 5): Promise<string[]> {
    await this.init();

    const results = await this.search({
      query,
      limit,
      threshold: 0.5,
    });

    return results.map((r) => r.entry.content);
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _instance: Memory | null = null;
let _initPromise: Promise<Memory> | null = null;

/** Get the shared Memory instance (thread-safe singleton) */
export function getMemory(config?: Partial<MemoryConfig>): Memory {
  // Double-check locking pattern for thread safety
  if (_instance) {
    return _instance;
  }

  // Synchronous fallback if called during initialization
  // This prevents race conditions where multiple calls create multiple instances
  if (!_initPromise) {
    _instance = new Memory(config);
  }
  return _instance!;
}

/** Get the shared Memory instance asynchronously (preferred for initialization) */
export async function getMemoryAsync(config?: Partial<MemoryConfig>): Promise<Memory> {
  if (_instance) {
    return _instance;
  }

  if (!_initPromise) {
    _initPromise = (async () => {
      const instance = new Memory(config);
      _instance = instance;
      return instance;
    })();
  }

  return _initPromise;
}

/** Reset the shared instance (for testing) */
export function resetMemory(): void {
  _instance = null;
  _initPromise = null;
}

/**
 * Subscribe to session compaction summaries and persist them as memories.
 * Uses LLM-generated compaction summary instead of heuristic extraction.
 *
 * @param subscribeFn - A function that registers a callback for bus events.
 *   Accepts the event definition and a callback receiving { type, properties }.
 *   Typically pass `Bus.subscribe` from `packages/zee/src/bus`.
 */
export function subscribeToCompaction(subscribeFn: (
  def: any,
  callback: (event: { type: string; properties: { sessionID: string; summary: string } }) => void,
) => void, eventDef: any): void {
  subscribeFn(eventDef, async (event) => {
    const { sessionID, summary } = event.properties;
    try {
      const memory = await getMemory();
      await memory.save({
        content: summary,
        category: "conversation",
        metadata: {
          sessionId: sessionID,
          tags: ["compaction_summary"],
          extra: { timestamp: Date.now() },
        },
      });
      log.info("Saved compaction summary to memory", { sessionID });
    } catch (e) {
      log.warn("Failed to save compaction summary to memory", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
