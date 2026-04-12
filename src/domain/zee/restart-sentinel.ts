/**
 * Stay-Up Restart Sentinel
 *
 * Persists session context to Zee's local memory store on daemon shutdown and
 * restores it on startup, keeping conversation continuity across restarts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../../tool";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../config/constants";
import { getMemoryEmbeddingConfig } from "../../config/runtime";
import { createEmbeddingProvider, type EmbeddingConfig } from "../../memory/embedding";
import { prepareLocalMemory } from "../../memory/local-runtime";
import { SqliteVectorStorage } from "../../memory/sqlite-vector";
import type { EmbeddingProvider } from "../../memory/types";
import { resolveStateDir } from "../../../packages/zee/src/global/dirs";

// =============================================================================
// Types
// =============================================================================

export interface SentinelDeliveryContext {
  /** Messaging channel (whatsapp, cli) */
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
  /** Agent that was active (zee) */
  agent?: string;
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
  /** Unique ID in Zee local memory */
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

type SentinelStoragePayload = {
  type: "restart_sentinel";
  namespace: typeof SENTINEL_NAMESPACE;
  consumed: boolean;
  consumedAt?: number;
  createdAt: number;
  shutdownAt: number;
  reason: SentinelPayload["reason"];
  sessionCount: number;
  contextSummary?: string;
  payload: SentinelPayload;
};

// =============================================================================
// Constants
// =============================================================================

const SENTINEL_NAMESPACE = "zee:restart-sentinel";
const SENTINEL_COLLECTION = "zee_sentinel";
const SENTINEL_FILE_PATH = path.join(resolveStateDir(), "restart-sentinel.json");

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "local",
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
};

// =============================================================================
// Singleton Instances
// =============================================================================

let localStorage: SqliteVectorStorage | null = null;
let embeddingProvider: EmbeddingProvider | null = null;

function getEmbeddingProvider(): EmbeddingProvider {
  if (embeddingProvider) return embeddingProvider;

  const userConfig = getMemoryEmbeddingConfig();
  const config: EmbeddingConfig = {
    ...DEFAULT_EMBEDDING_CONFIG,
    model: userConfig.provider === "local" ? userConfig.model : DEFAULT_EMBEDDING_CONFIG.model,
    dimensions:
      userConfig.provider === "local"
        ? userConfig.dimensions
        : DEFAULT_EMBEDDING_CONFIG.dimensions,
    modelPath: userConfig.provider === "local" ? userConfig.modelPath : undefined,
  };

  embeddingProvider = createEmbeddingProvider(config);
  return embeddingProvider;
}

async function getLocalSentinelStorage(): Promise<SqliteVectorStorage> {
  if (!localStorage) {
    await prepareLocalMemory();
    localStorage = new SqliteVectorStorage({ collection: SENTINEL_COLLECTION });
  }

  const provider = getEmbeddingProvider();
  await localStorage.createCollection(SENTINEL_COLLECTION, provider.dimension);
  return localStorage;
}

function pointToRecord(point: {
  id: string;
  payload: Record<string, unknown>;
}): SentinelRecord | null {
  const payload = point.payload as Partial<SentinelStoragePayload>;
  if (payload.type !== "restart_sentinel" || !payload.payload) return null;

  return {
    id: point.id,
    payload: payload.payload,
    createdAt: typeof payload.createdAt === "number" ? payload.createdAt : payload.payload.shutdownAt,
    consumed: payload.consumed === true,
    consumedAt: typeof payload.consumedAt === "number" ? payload.consumedAt : undefined,
  };
}

function buildContextSummary(payload: Omit<SentinelPayload, "version" | "contextVector">): string {
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
  return contextParts.join("\n");
}

async function embedSentinelContext(contextSummary: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  return provider.embed(contextSummary.trim() || SENTINEL_NAMESPACE);
}

// =============================================================================
// File Backup
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

  record.consumed = true;
  record.consumedAt = Date.now();
  await fs.writeFile(SENTINEL_FILE_PATH, JSON.stringify(record, null, 2));

  return record;
}

async function deleteSentinelFile(): Promise<void> {
  try {
    await fs.unlink(SENTINEL_FILE_PATH);
  } catch {
    // Ignore if file doesn't exist.
  }
}

// =============================================================================
// Core Sentinel Functions
// =============================================================================

/**
 * Save sentinel state before shutdown.
 * Stores in local semantic memory and in a JSON backup file for reliability.
 */
export async function saveSentinel(
  payload: Omit<SentinelPayload, "version" | "contextVector">
): Promise<{ memory: boolean; file: boolean }> {
  const results = { memory: false, file: false };
  const contextSummary = buildContextSummary(payload);

  let contextVector: number[] | undefined;
  try {
    contextVector = await embedSentinelContext(contextSummary);
  } catch (err) {
    console.error(`[restart-sentinel] Failed to generate local embedding: ${err}`);
  }

  const fullPayload: SentinelPayload = {
    ...payload,
    version: 2,
    contextVector,
    contextSummary,
  };

  try {
    const storage = await getLocalSentinelStorage();
    const id = `sentinel-${payload.pid}-${payload.shutdownAt}`;
    const vector = contextVector ?? new Array(getEmbeddingProvider().dimension).fill(0);
    const createdAt = Date.now();

    await storage.insert([
      {
        id,
        vector,
        payload: {
          type: "restart_sentinel",
          namespace: SENTINEL_NAMESPACE,
          consumed: false,
          createdAt,
          shutdownAt: fullPayload.shutdownAt,
          reason: fullPayload.reason,
          sessionCount: fullPayload.sessions.length,
          contextSummary,
          payload: fullPayload,
        } satisfies SentinelStoragePayload,
      },
    ]);
    results.memory = true;
  } catch (err) {
    console.error(`[restart-sentinel] Failed to save to local memory: ${err}`);
  }

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
 * Checks local memory first, then falls back to the JSON backup file.
 */
export async function restoreSentinel(): Promise<SentinelRecord | null> {
  try {
    const storage = await getLocalSentinelStorage();
    const results = await storage.scroll({
      filter: {
        type: "restart_sentinel",
        namespace: SENTINEL_NAMESPACE,
        consumed: false,
      },
      limit: 1,
      orderBy: { key: "shutdownAt", direction: "desc" },
    });

    const record = results.points.map(pointToRecord).find((item): item is SentinelRecord => Boolean(item));
    if (record) {
      await storage.update(record.id, { consumed: true, consumedAt: Date.now() });
      return record;
    }
  } catch (err) {
    console.error(`[restart-sentinel] Failed to restore from local memory: ${err}`);
  }

  return consumeSentinelFile();
}

/**
 * Search for similar past sessions using local semantic search.
 */
export async function searchSimilarSessions(
  query: string,
  limit = 5
): Promise<Array<{ score: number; payload: SentinelPayload }>> {
  const provider = getEmbeddingProvider();
  const vector = await provider.embed(query);
  const storage = await getLocalSentinelStorage();

  const results = await storage.search(vector, {
    limit,
    threshold: 0,
    filter: {
      type: "restart_sentinel",
      namespace: SENTINEL_NAMESPACE,
    },
  });

  return results
    .map((result) => {
      const record = pointToRecord(result);
      return record ? { score: result.score, payload: record.payload } : null;
    })
    .filter((item): item is { score: number; payload: SentinelPayload } => Boolean(item));
}

/**
 * Get current sentinel status.
 */
export async function getSentinelStatus(): Promise<{
  localMemoryAvailable: boolean;
  fileExists: boolean;
  pendingSentinel: SentinelRecord | null;
  embeddingProvider: string;
  embeddingDimension: number;
}> {
  let localMemoryAvailable = false;
  let pendingSentinel: SentinelRecord | null = null;

  try {
    const storage = await getLocalSentinelStorage();
    localMemoryAvailable = true;

    const results = await storage.scroll({
      filter: {
        type: "restart_sentinel",
        namespace: SENTINEL_NAMESPACE,
        consumed: false,
      },
      limit: 1,
      orderBy: { key: "shutdownAt", direction: "desc" },
    });

    pendingSentinel = results.points.map(pointToRecord).find((item): item is SentinelRecord => Boolean(item)) ?? null;
  } catch {
    localMemoryAvailable = false;
  }

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

  let embeddingProviderId = "local";
  let embeddingDimension = EMBEDDING_DIMENSIONS;
  try {
    const provider = getEmbeddingProvider();
    embeddingProviderId = provider.id;
    embeddingDimension = provider.dimension;
  } catch {
    // Use defaults.
  }

  return {
    localMemoryAvailable,
    fileExists,
    pendingSentinel,
    embeddingProvider: embeddingProviderId,
    embeddingDimension,
  };
}

/**
 * Clear all sentinel records (for testing/cleanup).
 */
export async function clearSentinels(): Promise<void> {
  try {
    const storage = await getLocalSentinelStorage();
    await storage.deleteWhere({
      type: "restart_sentinel",
      namespace: SENTINEL_NAMESPACE,
    });
  } catch {
    // Ignore local memory errors.
  }

  await deleteSentinelFile();
}

// =============================================================================
// Tools
// =============================================================================

export const sentinelStatusTool: Tool = {
  name: "zee:sentinel-status",
  description:
    "Check the restart sentinel system, including local memory status, pending sentinels, and embedding configuration",
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
          localMemory: status.localMemoryAvailable ? "available" : "unavailable",
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
      agent: {
        type: "string",
        description: "Active agent (zee)",
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
        agent?: string;
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
            agent: params.agent,
            workingDir: process.cwd(),
          },
        ],
      });

      return {
        success: true,
        saved: {
          memory: result.memory,
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
            agent: s.agent,
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
    "Search for similar past sessions using Zee local semantic memory",
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
            agent: s.agent,
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
