/**
 * Stay-Up Restart Sentinel
 *
 * Persists session context to Qdrant on daemon shutdown and restores
 * it on startup, ensuring conversation continuity across restarts.
 *
 * Uses Google Gemini embeddings (3072 dimensions) for semantic context.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Tool } from "../../tool";
import { getMemoryQdrantConfig, getMemoryEmbeddingConfig } from "../../config/runtime";
import { createEmbeddingProvider, type EmbeddingConfig } from "../../memory/embedding";
import type { EmbeddingProvider } from "../../memory/types";

// =============================================================================
// Types
// =============================================================================

export interface SentinelDeliveryContext {
  /** Messaging channel (whatsapp, matrix, cli) */
  channel?: string;
  /** Recipient identifier */
  to?: string;
  /** Account ID for multi-account setups */
  accountId?: string;
  /** Thread ID for reply threading */
  threadId?: string;
}

export interface SentinelSessionState {
  /** Session key/ID */
  sessionKey: string;
  /** Session title/summary */
  title?: string;
  /** Last message content (truncated) */
  lastMessage?: string;
  /** Key facts extracted from conversation */
  keyFacts: string[];
  /** Current objectives/goals */
  objectives: string[];
  /** Pending tasks */
  pendingTasks: string[];
  /** Delivery context for message routing */
  deliveryContext?: SentinelDeliveryContext;
  /** Persona that was active (zee, stanley, johny) */
  persona?: string;
  /** Working directory */
  workingDir?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface SentinelPayload {
  /** Sentinel version */
  version: 2;
  /** Shutdown reason */
  reason: "signal" | "error" | "manual" | "update" | "restart";
  /** Shutdown signal (if applicable) */
  signal?: string;
  /** Error message (if applicable) */
  error?: string;
  /** Timestamp of shutdown */
  shutdownAt: number;
  /** Daemon PID */
  pid: number;
  /** Active sessions at shutdown */
  sessions: SentinelSessionState[];
  /** Embedding vector of combined context (for semantic search) */
  contextVector?: number[];
  /** Summary of what was happening */
  contextSummary?: string;
}

export interface SentinelRecord {
  /** Unique ID in Qdrant */
  id: string;
  /** Payload data */
  payload: SentinelPayload;
  /** When this record was created */
  createdAt: number;
  /** Whether this has been consumed */
  consumed: boolean;
  /** When it was consumed */
  consumedAt?: number;
}

// =============================================================================
// Constants
// =============================================================================

const SENTINEL_NAMESPACE = "zee:restart-sentinel";
const SENTINEL_COLLECTION = "agent_core_sentinel";
const SENTINEL_FILE_PATH = path.join(
  process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
  "agent-core",
  "restart-sentinel.json"
);

// Default embedding config (Google Gemini)
const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "google",
  model: "gemini-embedding-001",
  dimensions: 3072,
};

// =============================================================================
// Qdrant Client (minimal implementation for sentinel)
// =============================================================================

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

interface QdrantSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

class SentinelQdrantClient {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly collection: string;
  private readonly dimension: number;

  constructor(config: {
    url: string;
    apiKey?: string;
    collection?: string;
    dimension?: number;
  }) {
    this.url = config.url.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.collection = config.collection ?? SENTINEL_COLLECTION;
    this.dimension = config.dimension ?? 4096;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "api-key": this.apiKey } : {}),
    };

    const response = await fetch(`${this.url}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Qdrant request failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async ensureCollection(): Promise<void> {
    try {
      await this.request(`/collections/${this.collection}`);
    } catch {
      // Collection doesn't exist, create it
      await this.request(`/collections/${this.collection}`, {
        method: "PUT",
        body: JSON.stringify({
          vectors: {
            size: this.dimension,
            distance: "Cosine",
          },
        }),
      });
    }
  }

  async upsert(points: QdrantPoint[]): Promise<void> {
    await this.ensureCollection();
    await this.request(`/collections/${this.collection}/points`, {
      method: "PUT",
      body: JSON.stringify({
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      }),
    });
  }

  async search(
    vector: number[],
    options: { limit?: number; filter?: Record<string, unknown> } = {}
  ): Promise<QdrantSearchResult[]> {
    const response = await this.request<{
      result: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
    }>(`/collections/${this.collection}/points/search`, {
      method: "POST",
      body: JSON.stringify({
        vector,
        limit: options.limit ?? 5,
        with_payload: true,
        filter: options.filter,
      }),
    });

    return response.result;
  }

  async getByFilter(
    filter: Record<string, unknown>,
    limit = 10
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    const response = await this.request<{
      result: { points: Array<{ id: string; payload: Record<string, unknown> }> };
    }>(`/collections/${this.collection}/points/scroll`, {
      method: "POST",
      body: JSON.stringify({
        filter,
        limit,
        with_payload: true,
      }),
    });

    return response.result.points;
  }

  async delete(ids: string[]): Promise<void> {
    await this.request(`/collections/${this.collection}/points/delete`, {
      method: "POST",
      body: JSON.stringify({
        points: ids,
      }),
    });
  }

  async updatePayload(
    id: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.request(`/collections/${this.collection}/points/payload`, {
      method: "POST",
      body: JSON.stringify({
        points: [id],
        payload,
      }),
    });
  }
}

// =============================================================================
// Singleton Instances
// =============================================================================

let qdrantClient: SentinelQdrantClient | null = null;
let embeddingProvider: EmbeddingProvider | null = null;

function getQdrantClient(): SentinelQdrantClient {
  if (qdrantClient) return qdrantClient;

  const config = getMemoryQdrantConfig();
  if (!config.url) {
    throw new Error(
      "Qdrant URL not configured. Set memory.qdrant.url in agent-core.jsonc"
    );
  }

  qdrantClient = new SentinelQdrantClient({
    url: config.url,
    apiKey: config.apiKey,
    collection: SENTINEL_COLLECTION,
    dimension: 4096,
  });

  return qdrantClient;
}

function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) return embeddingProvider;

  // Use user config if available, otherwise default to Google Gemini
  const userConfig = getMemoryEmbeddingConfig();
  const config: EmbeddingConfig = userConfig.provider
    ? {
        provider: userConfig.provider,
        model: userConfig.model,
        dimensions: userConfig.dimensions,
        baseUrl: userConfig.baseUrl,
        apiKey: userConfig.apiKey,
      }
    : DEFAULT_EMBEDDING_CONFIG;

  embeddingProvider = createEmbeddingProvider(config);
  return embeddingProvider;
}

// =============================================================================
// File-based Fallback (for when Qdrant is unavailable)
// =============================================================================

async function ensureSentinelDir(): Promise<void> {
  await fs.mkdir(path.dirname(SENTINEL_FILE_PATH), { recursive: true });
}

async function writeSentinelFile(payload: SentinelPayload): Promise<void> {
  await ensureSentinelDir();
  const record: SentinelRecord = {
    id: `sentinel-${Date.now()}`,
    payload,
    createdAt: Date.now(),
    consumed: false,
  };
  await fs.writeFile(SENTINEL_FILE_PATH, JSON.stringify(record, null, 2));
}

async function readSentinelFile(): Promise<SentinelRecord | null> {
  try {
    const content = await fs.readFile(SENTINEL_FILE_PATH, "utf-8");
    return JSON.parse(content) as SentinelRecord;
  } catch {
    return null;
  }
}

async function consumeSentinelFile(): Promise<SentinelRecord | null> {
  const record = await readSentinelFile();
  if (!record || record.consumed) return null;

  // Mark as consumed
  record.consumed = true;
  record.consumedAt = Date.now();
  await fs.writeFile(SENTINEL_FILE_PATH, JSON.stringify(record, null, 2));

  return record;
}

async function deleteSentinelFile(): Promise<void> {
  try {
    await fs.unlink(SENTINEL_FILE_PATH);
  } catch {
    // Ignore if file doesn't exist
  }
}

// =============================================================================
// Core Sentinel Functions
// =============================================================================

/**
 * Save sentinel state before shutdown.
 * Stores in both Qdrant (for semantic search) and file (for reliability).
 */
export async function saveSentinel(
  payload: Omit<SentinelPayload, "version" | "contextVector">
): Promise<{ qdrant: boolean; file: boolean }> {
  const results = { qdrant: false, file: false };

  // Build context summary for embedding
  const contextParts: string[] = [];
  for (const session of payload.sessions) {
    if (session.title) contextParts.push(`Session: ${session.title}`);
    if (session.lastMessage) contextParts.push(`Last: ${session.lastMessage.slice(0, 500)}`);
    if (session.keyFacts.length > 0) {
      contextParts.push(`Facts: ${session.keyFacts.join("; ")}`);
    }
    if (session.objectives.length > 0) {
      contextParts.push(`Objectives: ${session.objectives.join("; ")}`);
    }
    if (session.pendingTasks.length > 0) {
      contextParts.push(`Tasks: ${session.pendingTasks.join("; ")}`);
    }
  }
  const contextSummary = contextParts.join("\n");

  // Generate embedding for context
  let contextVector: number[] | undefined;
  try {
    if (contextSummary.trim()) {
      const provider = getEmbeddingProvider();
      contextVector = await provider.embed(contextSummary);
    }
  } catch (err) {
    console.error(`[restart-sentinel] Failed to generate embedding: ${err}`);
  }

  const fullPayload: SentinelPayload = {
    ...payload,
    version: 2,
    contextVector,
    contextSummary,
  };

  // Save to Qdrant
  try {
    const client = getQdrantClient();
    const id = `sentinel-${payload.pid}-${payload.shutdownAt}`;

    // Use a placeholder vector if embedding failed
    const vector = contextVector ?? new Array(4096).fill(0);

    await client.upsert([
      {
        id,
        vector,
        payload: {
          ...fullPayload,
          namespace: SENTINEL_NAMESPACE,
          consumed: false,
        },
      },
    ]);
    results.qdrant = true;
  } catch (err) {
    console.error(`[restart-sentinel] Failed to save to Qdrant: ${err}`);
  }

  // Save to file as fallback
  try {
    await writeSentinelFile(fullPayload);
    results.file = true;
  } catch (err) {
    console.error(`[restart-sentinel] Failed to save to file: ${err}`);
  }

  return results;
}

/**
 * Restore sentinel state on startup.
 * Checks Qdrant first, falls back to file.
 */
export async function restoreSentinel(): Promise<SentinelRecord | null> {
  // Try Qdrant first
  try {
    const client = getQdrantClient();
    const results = await client.getByFilter(
      {
        must: [
          { key: "namespace", match: { value: SENTINEL_NAMESPACE } },
          { key: "consumed", match: { value: false } },
        ],
      },
      1
    );

    if (results.length > 0) {
      const point = results[0];
      const payload = point.payload as unknown as SentinelPayload;

      // Mark as consumed
      await client.updatePayload(point.id, { consumed: true, consumedAt: Date.now() });

      return {
        id: point.id,
        payload,
        createdAt: payload.shutdownAt,
        consumed: false,
      };
    }
  } catch (err) {
    console.error(`[restart-sentinel] Failed to restore from Qdrant: ${err}`);
  }

  // Fall back to file
  return consumeSentinelFile();
}

/**
 * Search for similar past sessions using semantic search.
 */
export async function searchSimilarSessions(
  query: string,
  limit = 5
): Promise<Array<{ score: number; payload: SentinelPayload }>> {
  const provider = getEmbeddingProvider();
  const vector = await provider.embed(query);

  const client = getQdrantClient();
  const results = await client.search(vector, {
    limit,
    filter: {
      must: [{ key: "namespace", match: { value: SENTINEL_NAMESPACE } }],
    },
  });

  return results.map((r) => ({
    score: r.score,
    payload: r.payload as unknown as SentinelPayload,
  }));
}

/**
 * Get current sentinel status.
 */
export async function getSentinelStatus(): Promise<{
  qdrantAvailable: boolean;
  fileExists: boolean;
  pendingSentinel: SentinelRecord | null;
  embeddingProvider: string;
  embeddingDimension: number;
}> {
  let qdrantAvailable = false;
  let pendingSentinel: SentinelRecord | null = null;

  // Check Qdrant
  try {
    const client = getQdrantClient();
    await client.ensureCollection();
    qdrantAvailable = true;

    const results = await client.getByFilter(
      {
        must: [
          { key: "namespace", match: { value: SENTINEL_NAMESPACE } },
          { key: "consumed", match: { value: false } },
        ],
      },
      1
    );

    if (results.length > 0) {
      const point = results[0];
      pendingSentinel = {
        id: point.id,
        payload: point.payload as unknown as SentinelPayload,
        createdAt: (point.payload as { shutdownAt?: number }).shutdownAt ?? 0,
        consumed: false,
      };
    }
  } catch {
    qdrantAvailable = false;
  }

  // Check file
  let fileExists = false;
  try {
    await fs.access(SENTINEL_FILE_PATH);
    fileExists = true;

    if (!pendingSentinel) {
      const fileRecord = await readSentinelFile();
      if (fileRecord && !fileRecord.consumed) {
        pendingSentinel = fileRecord;
      }
    }
  } catch {
    fileExists = false;
  }

  // Get embedding info
  let embeddingProvider = "google";
  let embeddingDimension = 3072;
  try {
    const provider = getEmbeddingProvider();
    embeddingProvider = provider.id;
    embeddingDimension = provider.dimension;
  } catch {
    // Use defaults
  }

  return {
    qdrantAvailable,
    fileExists,
    pendingSentinel,
    embeddingProvider,
    embeddingDimension,
  };
}

/**
 * Clear all sentinel records (for testing/cleanup).
 */
export async function clearSentinels(): Promise<void> {
  // Clear Qdrant
  try {
    const client = getQdrantClient();
    const results = await client.getByFilter(
      { must: [{ key: "namespace", match: { value: SENTINEL_NAMESPACE } }] },
      100
    );
    if (results.length > 0) {
      await client.delete(results.map((r) => r.id));
    }
  } catch {
    // Ignore Qdrant errors
  }

  // Clear file
  await deleteSentinelFile();
}

// =============================================================================
// Tools
// =============================================================================

export const sentinelStatusTool: Tool = {
  name: "zee:sentinel-status",
  description:
    "Check the status of the restart sentinel system, including Qdrant connectivity, pending sentinels, and embedding configuration",
  parameters: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  },
  userFacing: true,
  async call() {
    try {
      const status = await getSentinelStatus();
      return {
        success: true,
        status: {
          qdrant: status.qdrantAvailable ? "connected" : "unavailable",
          fileBackup: status.fileExists ? "exists" : "none",
          pendingSentinel: status.pendingSentinel
            ? {
                id: status.pendingSentinel.id,
                reason: status.pendingSentinel.payload.reason,
                shutdownAt: new Date(
                  status.pendingSentinel.payload.shutdownAt
                ).toISOString(),
                sessions: status.pendingSentinel.payload.sessions.length,
              }
            : null,
          embedding: {
            provider: status.embeddingProvider,
            dimension: status.embeddingDimension,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const sentinelSaveTool: Tool = {
  name: "zee:sentinel-save",
  description:
    "Manually save current session state as a restart sentinel. Normally called automatically on daemon shutdown.",
  parameters: {
    type: "object" as const,
    properties: {
      sessionKey: {
        type: "string",
        description: "Session key/ID to save",
      },
      title: {
        type: "string",
        description: "Session title/summary",
      },
      keyFacts: {
        type: "array",
        items: { type: "string" },
        description: "Key facts to preserve",
      },
      objectives: {
        type: "array",
        items: { type: "string" },
        description: "Current objectives/goals",
      },
      pendingTasks: {
        type: "array",
        items: { type: "string" },
        description: "Pending tasks",
      },
      persona: {
        type: "string",
        description: "Active persona (zee, stanley, johny)",
      },
      reason: {
        type: "string",
        enum: ["manual", "update", "restart"],
        description: "Reason for saving",
      },
    },
    required: ["sessionKey"] as string[],
  },
  userFacing: true,
  async call(args) {
    try {
      const params = args as {
        sessionKey: string;
        title?: string;
        keyFacts?: string[];
        objectives?: string[];
        pendingTasks?: string[];
        persona?: string;
        reason?: "manual" | "update" | "restart";
      };

      const result = await saveSentinel({
        reason: params.reason ?? "manual",
        shutdownAt: Date.now(),
        pid: process.pid,
        sessions: [
          {
            sessionKey: params.sessionKey,
            title: params.title,
            keyFacts: params.keyFacts ?? [],
            objectives: params.objectives ?? [],
            pendingTasks: params.pendingTasks ?? [],
            persona: params.persona,
            workingDir: process.cwd(),
          },
        ],
      });

      return {
        success: true,
        saved: {
          qdrant: result.qdrant,
          file: result.file,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const sentinelRestoreTool: Tool = {
  name: "zee:sentinel-restore",
  description:
    "Restore session state from the most recent restart sentinel. Returns the saved context for resumption.",
  parameters: {
    type: "object" as const,
    properties: {
      consume: {
        type: "boolean",
        description: "Whether to mark the sentinel as consumed (default: true)",
      },
    },
    required: [] as string[],
  },
  userFacing: true,
  async call(args) {
    try {
      const params = args as { consume?: boolean };
      const consume = params.consume !== false;

      let record: SentinelRecord | null = null;

      if (consume) {
        record = await restoreSentinel();
      } else {
        // Just peek without consuming
        const status = await getSentinelStatus();
        record = status.pendingSentinel;
      }

      if (!record) {
        return {
          success: true,
          found: false,
          message: "No pending restart sentinel found",
        };
      }

      return {
        success: true,
        found: true,
        consumed: consume,
        sentinel: {
          id: record.id,
          reason: record.payload.reason,
          signal: record.payload.signal,
          error: record.payload.error,
          shutdownAt: new Date(record.payload.shutdownAt).toISOString(),
          pid: record.payload.pid,
          contextSummary: record.payload.contextSummary,
          sessions: record.payload.sessions.map((s) => ({
            sessionKey: s.sessionKey,
            title: s.title,
            persona: s.persona,
            workingDir: s.workingDir,
            keyFacts: s.keyFacts,
            objectives: s.objectives,
            pendingTasks: s.pendingTasks,
            deliveryContext: s.deliveryContext,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const sentinelSearchTool: Tool = {
  name: "zee:sentinel-search",
  description:
    "Search for similar past sessions using semantic search on stored sentinel context",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query describing what you're looking for",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 5)",
      },
    },
    required: ["query"] as string[],
  },
  userFacing: true,
  async call(args) {
    try {
      const params = args as { query: string; limit?: number };

      const results = await searchSimilarSessions(params.query, params.limit ?? 5);

      return {
        success: true,
        results: results.map((r) => ({
          score: r.score,
          reason: r.payload.reason,
          shutdownAt: new Date(r.payload.shutdownAt).toISOString(),
          contextSummary: r.payload.contextSummary?.slice(0, 500),
          sessions: r.payload.sessions.map((s) => ({
            sessionKey: s.sessionKey,
            title: s.title,
            persona: s.persona,
          })),
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

// =============================================================================
// Export Tools Array
// =============================================================================

export const RESTART_SENTINEL_TOOLS: Tool[] = [
  sentinelStatusTool,
  sentinelSaveTool,
  sentinelRestoreTool,
  sentinelSearchTool,
];

// =============================================================================
// Lifecycle Integration Helpers
// =============================================================================

/**
 * Called by daemon on shutdown to save current session state.
 */
export async function onDaemonShutdown(params: {
  pid: number;
  reason: "signal" | "error" | "manual";
  signal?: string;
  error?: string;
  sessions?: SentinelSessionState[];
}): Promise<void> {
  try {
    await saveSentinel({
      reason: params.reason,
      signal: params.signal,
      error: params.error,
      shutdownAt: Date.now(),
      pid: params.pid,
      sessions: params.sessions ?? [],
    });
    console.log("[restart-sentinel] Saved session state for restart recovery");
  } catch (err) {
    console.error(`[restart-sentinel] Failed to save on shutdown: ${err}`);
  }
}

/**
 * Called by daemon on startup to check for and restore sentinel.
 */
export async function onDaemonStartup(): Promise<SentinelRecord | null> {
  try {
    const record = await restoreSentinel();
    if (record) {
      console.log(
        `[restart-sentinel] Found pending sentinel from ${new Date(record.payload.shutdownAt).toISOString()}`
      );
      console.log(`[restart-sentinel] Reason: ${record.payload.reason}`);
      console.log(`[restart-sentinel] Sessions: ${record.payload.sessions.length}`);
    }
    return record;
  } catch (err) {
    console.error(`[restart-sentinel] Failed to restore on startup: ${err}`);
    return null;
  }
}
