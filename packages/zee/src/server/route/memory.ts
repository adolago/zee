/**
 * Memory API Routes
 *
 * HTTP API for centralized local memory operations.
 * Provides semantic search, storage, and namespace-based isolation.
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { errors } from "../error"
import { Log } from "../../util/log"
import { getAgentDbMemory } from "@/memory/agentdb-service"

const log = Log.create({ service: "server:memory" })

// =============================================================================
// Schemas
// =============================================================================

const MemoryCategorySchema = z.enum([
  "conversation",
  "fact",
  "preference",
  "task",
  "decision",
  "relationship",
  "note",
  "pattern",
  "custom",
])

const MemoryMetadataSchema = z.object({
  surface: z.string().optional(),
  sessionId: z.string().optional(),
  agent: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
  entities: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
})

const MemoryEntrySchema = z.object({
  id: z.string(),
  category: MemoryCategorySchema,
  content: z.string(),
  summary: z.string().optional(),
  metadata: MemoryMetadataSchema,
  createdAt: z.number(),
  accessedAt: z.number(),
  updatedAt: z.number().optional(),
  ttl: z.number().optional(),
  namespace: z.string().optional(),
  // Enhanced fields
  domain: z.string().optional(),
  topic: z.string().optional(),
  subtopic: z.string().optional(),
  memoryId: z.string().optional(),
  version: z.number().optional(),
  parentVersion: z.number().optional(),
  superseded: z.boolean().optional(),
  kind: z.enum(["curated", "auto", "agent"]).optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  bookmarked: z.boolean().optional(),
  memoryType: z.enum(["fact", "reasoning"]).optional(),
})

const MemoryKindSchema = z.enum(["curated", "auto", "agent"])
const MemoryPrioritySchema = z.enum(["high", "normal", "low"])
const MemoryMemoryTypeSchema = z.enum(["fact", "reasoning"])

const MemoryInputSchema = z.object({
  category: MemoryCategorySchema,
  content: z.string().min(1),
  summary: z.string().optional(),
  metadata: MemoryMetadataSchema.optional(),
  ttl: z.number().optional(),
  namespace: z.string().optional(),
  // Context Tree
  domain: z.string().optional(),
  topic: z.string().optional(),
  subtopic: z.string().optional(),
  // Version Control
  memoryId: z.string().optional(),
  // Context Composer
  kind: MemoryKindSchema.optional(),
  priority: MemoryPrioritySchema.optional(),
  bookmarked: z.boolean().optional(),
  // Dual Memory
  memoryType: MemoryMemoryTypeSchema.optional(),
})

const MemorySearchParamsSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["auto", "semantic", "keyword", "hybrid"]).optional(),
  limit: z.number().min(1).max(100).optional().default(10),
  threshold: z.number().min(0).max(1).optional(),
  includeVectors: z.boolean().optional().default(false),
  includeSnippets: z.boolean().optional().default(false),
  category: z.union([MemoryCategorySchema, z.array(MemoryCategorySchema)]).optional(),
  namespace: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  timeRange: z
    .object({
      start: z.number().optional(),
      end: z.number().optional(),
    })
    .optional(),
})

const MemorySearchResultSchema = z.object({
  entry: MemoryEntrySchema,
  score: z.number(),
  highlights: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  source: z.enum(["local-vector", "local-index"]).optional(),
  degraded: z.boolean().optional(),
})

const MemoryStatsSchema = z.object({
  total: z.number(),
  byType: z.record(z.string(), z.number()),
  byCategory: z.record(z.string(), z.number()),
  fts: z
    .object({
      totalEntries: z.number(),
      dbSizeBytes: z.number(),
    })
    .optional(),
  localIndex: z.object({
    enabled: z.boolean(),
    backend: z.enum(["sqlite-fts"]),
    available: z.boolean(),
    degradedRead: z.enum(["off", "keyword_only"]),
    initFailed: z.boolean(),
    totalEntries: z.number().optional(),
    dbSizeBytes: z.number().optional(),
  }),
})

// =============================================================================
// Memory Service (lazy import to avoid circular deps)
// =============================================================================

async function getMemoryService() {
  return getAgentDbMemory()
}

// =============================================================================
// Routes
// =============================================================================

export const MemoryRoute = new Hono()
  // Store a new memory
  .post(
    "/memory/store",
    describeRoute({
      summary: "Store memory",
      description: "Store a new memory entry with semantic embedding.",
      operationId: "memory.store",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Memory stored successfully",
          content: {
            "application/json": {
              schema: resolver(MemoryEntrySchema),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator("json", MemoryInputSchema),
    async (c) => {
      try {
        const input = c.req.valid("json")
        const memory = await getMemoryService()
        const entry = await memory.save(input)
        log.info("Memory stored", { id: entry.id, category: input.category, namespace: input.namespace })
        return c.json(entry)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack : undefined
        log.error("Memory store failed", { error: errMsg, stack: errStack })
        return c.json({ error: "Failed to store memory", details: errMsg }, 500)
      }
    },
  )

  // Batch store memories
  .post(
    "/memory/batch",
    describeRoute({
      summary: "Batch store memories",
      description: "Store multiple memory entries at once.",
      operationId: "memory.batch",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Memories stored successfully",
          content: {
            "application/json": {
              schema: resolver(z.array(MemoryEntrySchema)),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator("json", z.object({ entries: z.array(MemoryInputSchema).min(1).max(100) })),
    async (c) => {
      try {
        const { entries } = c.req.valid("json")
        const memory = await getMemoryService()

        const results = []
        for (const input of entries) {
          const entry = await memory.save(input)
          results.push(entry)
        }

        log.info("Batch memory store", { count: results.length })
        return c.json(results)
      } catch (err) {
        log.error("Batch memory store failed", { error: err })
        return c.json({ error: "Failed to batch store memories" }, 500)
      }
    },
  )

  // Semantic search
  .post(
    "/memory/search",
    describeRoute({
      summary: "Search memories",
      description: "Semantic search across memory entries.",
      operationId: "memory.search",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Search results",
          content: {
            "application/json": {
              schema: resolver(z.array(MemorySearchResultSchema)),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator("json", MemorySearchParamsSchema),
    async (c) => {
      try {
        const params = c.req.valid("json")
        const memory = await getMemoryService()
        const results = await memory.search(params)
        log.debug("Memory search", { query: params.query.slice(0, 50), results: results.length })
        return c.json(results)
      } catch (err) {
        log.error("Memory search failed", { error: err })
        return c.json({ error: "Failed to search memories" }, 500)
      }
    },
  )

  // Get memory statistics (must come before /:id to avoid matching "stats" as an ID)
  .get(
    "/memory/stats",
    describeRoute({
      summary: "Get memory statistics",
      description: "Get statistics about stored memories.",
      operationId: "memory.stats",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Memory statistics",
          content: {
            "application/json": {
              schema: resolver(MemoryStatsSchema),
            },
          },
        },
        ...errors(500),
      },
    }),
    async (c) => {
      try {
        const memory = await getMemoryService()
        const stats = await memory.stats()
        return c.json(stats)
      } catch (err) {
        log.error("Memory stats failed", { error: err })
        return c.json({ error: "Failed to get memory statistics" }, 500)
      }
    },
  )

  // Health check for memory service (must come before /:id)
  .get(
    "/memory/health",
    describeRoute({
      summary: "Memory health check",
      description: "Check if the memory service is available and connected.",
      operationId: "memory.health",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Health status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  available: z.boolean(),
                  vectorAvailable: z.boolean().optional(),
                  degraded: z.boolean().optional(),
                  initialized: z.boolean(),
                  localIndex: z.object({
                    enabled: z.boolean(),
                    backend: z.string().optional(),
                    available: z.boolean(),
                    degradedRead: z.enum(["off", "keyword_only"]),
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      try {
        const memory = await getMemoryService()
        const localIndex: {
          enabled: boolean
          backend?: string
          available: boolean
          degradedRead: "off" | "keyword_only"
        } = typeof memory.getLocalIndexStatus === "function"
          ? {
              enabled: Boolean(memory.getLocalIndexStatus().enabled),
              backend:
                typeof memory.getLocalIndexStatus().backend === "string"
                  ? memory.getLocalIndexStatus().backend
                  : undefined,
              available: Boolean(memory.getLocalIndexStatus().available),
              degradedRead: memory.getLocalIndexStatus().degradedRead === "keyword_only" ? "keyword_only" : "off",
            }
          : {
              enabled: false,
              available: false,
              degradedRead: "off",
            }
        return c.json({
          available:
            typeof memory.isOperational === "function"
              ? memory.isOperational()
              : typeof memory.isAvailable === "function"
                ? memory.isAvailable()
                : false,
          vectorAvailable: memory.isAvailable(),
          degraded: !memory.isAvailable() && localIndex.available && localIndex.degradedRead === "keyword_only",
          initialized: true,
          localIndex: {
            enabled: Boolean(localIndex.enabled),
            backend: typeof localIndex.backend === "string" ? localIndex.backend : undefined,
            available: Boolean(localIndex.available),
            degradedRead: localIndex.degradedRead === "keyword_only" ? "keyword_only" : "off",
          },
        })
      } catch (err) {
        return c.json({
          available: false,
          initialized: false,
          localIndex: {
            enabled: false,
            available: false,
            degradedRead: "off",
          },
        })
      }
    },
  )

  // Get memory by ID
  .get(
    "/memory/:id",
    describeRoute({
      summary: "Get memory",
      description: "Get a specific memory entry by ID.",
      operationId: "memory.get",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Memory entry",
          content: {
            "application/json": {
              schema: resolver(MemoryEntrySchema),
            },
          },
        },
        ...errors(404, 500),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      try {
        const { id } = c.req.valid("param")
        const memory = await getMemoryService()
        const entry = await memory.get(id)

        if (!entry) {
          return c.json({ error: "Memory not found" }, 404)
        }

        return c.json(entry)
      } catch (err) {
        log.error("Memory get failed", { error: err })
        return c.json({ error: "Failed to get memory" }, 500)
      }
    },
  )

  // List memories by namespace
  .get(
    "/memory/namespace/:namespace",
    describeRoute({
      summary: "List memories by namespace",
      description: "Get all memories in a specific namespace.",
      operationId: "memory.byNamespace",
      tags: ["Memory"],
      responses: {
        200: {
          description: "List of memories",
          content: {
            "application/json": {
              schema: resolver(z.array(MemoryEntrySchema)),
            },
          },
        },
        ...errors(500),
      },
    }),
    validator("param", z.object({ namespace: z.string() })),
    validator(
      "query",
      z.object({
        category: MemoryCategorySchema.optional(),
        limit: z.coerce.number().min(1).max(500).optional().default(100),
      }),
    ),
    async (c) => {
      try {
        const { namespace } = c.req.valid("param")
        const { category, limit } = c.req.valid("query")
        const memory = await getMemoryService()
        const entries = await memory.list({ namespace, category, limit })
        return c.json(entries)
      } catch (err) {
        log.error("Memory list failed", { error: err })
        return c.json({ error: "Failed to list memories" }, 500)
      }
    },
  )

  // Delete memory by ID
  .delete(
    "/memory/:id",
    describeRoute({
      summary: "Delete memory",
      description: "Delete a specific memory entry.",
      operationId: "memory.delete",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Memory deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(500),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      try {
        const { id } = c.req.valid("param")
        const memory = await getMemoryService()
        await memory.delete(id)
        log.info("Memory deleted", { id })
        return c.json({ success: true })
      } catch (err) {
        log.error("Memory delete failed", { error: err })
        return c.json({ error: "Failed to delete memory" }, 500)
      }
    },
  )

  // Delete memories by filter
  .post(
    "/memory/delete-where",
    describeRoute({
      summary: "Delete memories by filter",
      description: "Delete memories matching the specified criteria.",
      operationId: "memory.deleteWhere",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Deletion result",
          content: {
            "application/json": {
              schema: resolver(z.object({ deleted: z.number() })),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator(
      "json",
      z.object({
        category: MemoryCategorySchema.optional(),
        namespace: z.string().optional(),
        olderThan: z.number().optional(),
      }),
    ),
    async (c) => {
      try {
        const filter = c.req.valid("json")
        const memory = await getMemoryService()
        const deleted = await memory.deleteWhere(filter)
        log.info("Memories deleted by filter", { filter, deleted })
        return c.json({ deleted })
      } catch (err) {
        log.error("Memory deleteWhere failed", { error: err })
        return c.json({ error: "Failed to delete memories" }, 500)
      }
    },
  )

  // Cleanup expired memories
  .post(
    "/memory/cleanup",
    describeRoute({
      summary: "Cleanup expired memories",
      description: "Delete all expired memory entries based on TTL.",
      operationId: "memory.cleanup",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Cleanup result",
          content: {
            "application/json": {
              schema: resolver(z.object({ deleted: z.number() })),
            },
          },
        },
        ...errors(500),
      },
    }),
    async (c) => {
      try {
        const memory = await getMemoryService()
        const deleted = await memory.cleanup()
        log.info("Memory cleanup completed", { deleted })
        return c.json({ deleted })
      } catch (err) {
        log.error("Memory cleanup failed", { error: err })
        return c.json({ error: "Failed to cleanup memories" }, 500)
      }
    },
  )

  // Reset and reinitialize memory service
  .post(
    "/memory/reset",
    describeRoute({
      summary: "Reset memory service",
      description: "Reset the memory service state and retry initialization. Use this if memory init failed.",
      operationId: "memory.reset",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Reset result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.boolean(),
                  available: z.boolean(),
                  error: z.string().optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      try {
        const memory = await getMemoryService()
        memory.resetInit()
        await memory.init()
        return c.json({
          success: true,
          available: memory.isAvailable(),
        })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        log.error("Memory reset failed", { error })
        return c.json({
          success: false,
          available: false,
          error,
        })
      }
    },
  )

  // Agentic search (filter-first retrieval)
  .post(
    "/memory/agentic-search",
    describeRoute({
      summary: "Agentic memory search",
      description: "Filter-first memory search with optional semantic refinement.",
      operationId: "memory.agenticSearch",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Search results",
          content: {
            "application/json": {
              schema: resolver(z.array(MemorySearchResultSchema)),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator(
      "json",
      z.object({
        domain: z.string(),
        topic: z.string().optional(),
        subtopic: z.string().optional(),
        query: z.string().optional(),
        currentOnly: z.boolean().optional(),
        kind: z.union([MemoryKindSchema, z.array(MemoryKindSchema)]).optional(),
        priority: z.union([MemoryPrioritySchema, z.array(MemoryPrioritySchema)]).optional(),
        bookmarked: z.boolean().optional(),
        memoryType: MemoryMemoryTypeSchema.optional(),
        limit: z.number().min(1).max(200).optional(),
        threshold: z.number().min(0).max(1).optional(),
      }),
    ),
    async (c) => {
      try {
        const params = c.req.valid("json")
        const memory = await getMemoryService()
        const results = await memory.agenticSearch(params)
        return c.json(results)
      } catch (err) {
        log.error("Agentic search failed", { error: err })
        return c.json({ error: "Agentic search failed" }, 500)
      }
    },
  )

  // Context tree: list domains
  .get(
    "/memory/tree/domains",
    describeRoute({
      summary: "List memory domains",
      description: "List all top-level domains in the context tree.",
      operationId: "memory.tree.domains",
      tags: ["Memory"],
      responses: {
        200: {
          description: "List of domains",
          content: {
            "application/json": {
              schema: resolver(z.array(z.object({ domain: z.string(), updatedAt: z.number() }))),
            },
          },
        },
        ...errors(500),
      },
    }),
    async (c) => {
      try {
        const memory = await getMemoryService()
        const domains = await memory.listDomains()
        return c.json(domains)
      } catch (err) {
        log.error("List domains failed", { error: err })
        return c.json({ error: "Failed to list domains" }, 500)
      }
    },
  )

  // Context tree: list topics
  .get(
    "/memory/tree/topics/:domain",
    describeRoute({
      summary: "List memory topics",
      description: "List topics within a domain.",
      operationId: "memory.tree.topics",
      tags: ["Memory"],
      responses: {
        200: {
          description: "List of topics",
          content: {
            "application/json": {
              schema: resolver(z.array(z.object({ topic: z.string(), updatedAt: z.number() }))),
            },
          },
        },
        ...errors(500),
      },
    }),
    validator("param", z.object({ domain: z.string() })),
    async (c) => {
      try {
        const { domain } = c.req.valid("param")
        const memory = await getMemoryService()
        const topics = await memory.listTopics(domain)
        return c.json(topics)
      } catch (err) {
        log.error("List topics failed", { error: err })
        return c.json({ error: "Failed to list topics" }, 500)
      }
    },
  )

  // Context tree: list subtopics
  .get(
    "/memory/tree/subtopics/:domain/:topic",
    describeRoute({
      summary: "List memory subtopics",
      description: "List subtopics within a domain/topic.",
      operationId: "memory.tree.subtopics",
      tags: ["Memory"],
      responses: {
        200: {
          description: "List of subtopics",
          content: {
            "application/json": {
              schema: resolver(z.array(z.object({ subtopic: z.string(), updatedAt: z.number() }))),
            },
          },
        },
        ...errors(500),
      },
    }),
    validator("param", z.object({ domain: z.string(), topic: z.string() })),
    async (c) => {
      try {
        const { domain, topic } = c.req.valid("param")
        const memory = await getMemoryService()
        const subtopics = await memory.listSubtopics(domain, topic)
        return c.json(subtopics)
      } catch (err) {
        log.error("List subtopics failed", { error: err })
        return c.json({ error: "Failed to list subtopics" }, 500)
      }
    },
  )

  // Version history
  .get(
    "/memory/version/:memoryId",
    describeRoute({
      summary: "Get memory version history",
      description: "Get all versions of a memory by its stable memoryId.",
      operationId: "memory.version.history",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Version history",
          content: {
            "application/json": {
              schema: resolver(z.array(MemoryEntrySchema)),
            },
          },
        },
        ...errors(500),
      },
    }),
    validator("param", z.object({ memoryId: z.string() })),
    async (c) => {
      try {
        const { memoryId } = c.req.valid("param")
        const memory = await getMemoryService()
        const history = await memory.getMemoryHistory(memoryId)
        return c.json(history)
      } catch (err) {
        log.error("Version history failed", { error: err })
        return c.json({ error: "Failed to get version history" }, 500)
      }
    },
  )

  // Version rollback
  .post(
    "/memory/version/:memoryId/rollback",
    describeRoute({
      summary: "Rollback memory version",
      description: "Rollback a memory to a specific version.",
      operationId: "memory.version.rollback",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Rollback result",
          content: {
            "application/json": {
              schema: resolver(MemoryEntrySchema.nullable()),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator("param", z.object({ memoryId: z.string() })),
    validator("json", z.object({ targetVersion: z.number().min(1) })),
    async (c) => {
      try {
        const { memoryId } = c.req.valid("param")
        const { targetVersion } = c.req.valid("json")
        const memory = await getMemoryService()
        const result = await memory.rollbackMemory(memoryId, targetVersion)
        if (!result) {
          return c.json({ error: "Memory or version not found" }, 404)
        }
        return c.json(result)
      } catch (err) {
        log.error("Version rollback failed", { error: err })
        return c.json({ error: "Failed to rollback version" }, 500)
      }
    },
  )

  // Curated context
  .get(
    "/memory/curated",
    describeRoute({
      summary: "Get curated context",
      description: "Get bookmarked and high-priority memories for context injection.",
      operationId: "memory.curated",
      tags: ["Memory"],
      responses: {
        200: {
          description: "Curated memories",
          content: {
            "application/json": {
              schema: resolver(z.array(MemoryEntrySchema)),
            },
          },
        },
        ...errors(500),
      },
    }),
    async (c) => {
      try {
        const memory = await getMemoryService()
        const limit = parseInt(c.req.query("limit") ?? "50", 10)
        const namespace = c.req.query("namespace") || undefined
        const results = await memory.getCuratedContext({ limit, namespace })
        return c.json(results)
      } catch (err) {
        log.error("Curated context failed", { error: err })
        return c.json({ error: "Failed to get curated context" }, 500)
      }
    },
  )
