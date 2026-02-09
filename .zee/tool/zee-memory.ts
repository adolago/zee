/**
 * Zee Memory Tools - Plugin wrapper for domain tools
 *
 * Wraps the Zee memory-store and memory-search tools in the plugin format
 * so they can be loaded by the tool registry.
 */

import { tool } from "@zee/plugin"

const AGENT_CORE_ROOT = process.env.AGENT_CORE_ROOT || "/home/artur/.local/src/agent-core"

async function loadMemoryModule() {
  try {
    return await import(`${AGENT_CORE_ROOT}/src/memory/unified.js`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.includes("Cannot find module") && !errorMsg.includes("ERR_MODULE_NOT_FOUND")) {
      throw error
    }
    return await import(`${AGENT_CORE_ROOT}/src/memory/unified.ts`)
  }
}

// Memory store tool
export const memoryStore = tool({
  description: `Store information in long-term memory for future reference.
Use this to remember:
- Important facts about the user
- Preferences and settings
- Tasks and decisions
- Notes from conversations

Examples:
- Remember preference: { content: "User prefers morning meetings", category: "preference" }
- Store fact: { content: "User's birthday is March 15", category: "fact", importance: 0.8 }`,
  args: {
    content: tool.schema.string().describe("Content to remember"),
    category: tool.schema
      .enum(["conversation", "fact", "preference", "task", "decision", "note"])
      .default("note")
      .describe("Memory category"),
    importance: tool.schema
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Importance score (0-1)"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for categorization"),
  },
  async execute(args) {
    // Dynamic import to avoid build-time dependency issues
    const { getMemory } = await loadMemoryModule()

    try {
      const store = getMemory()
      const entry = await store.save({
        category: args.category,
        content: args.content,
        namespace: "zee",
        metadata: {
          importance: args.importance,
          tags: args.tags,
          agent: "zee",
        },
      })

      return `Remembered: "${args.content.substring(0, 100)}${args.content.length > 100 ? "..." : ""}"

Memory saved with ID: ${entry.id}
- Category: ${args.category}
- Importance: ${((args.importance ?? 0.5) * 100).toFixed(0)}%
${args.tags?.length ? `- Tags: ${args.tags.join(", ")}` : ""}

This memory can be recalled later using zee:memory-search.`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
        return `Could not connect to memory storage (Qdrant).

The memory was NOT saved. To enable memory:
1. Start Qdrant: docker run -p 6333:6333 qdrant/qdrant
2. Or configure a different backend in agent-core config

Error: ${errorMsg}`
      }

      return `Failed to store memory: ${errorMsg}`
    }
  },
})

// Memory search tool
export const memorySearch = tool({
  description: `Search through stored memories using semantic similarity.
The search understands meaning, not just keywords.

Examples:
- Find preferences: { query: "meeting preferences", category: "preference" }
- Search all: { query: "birthday", limit: 3 }
- Recent memories: { query: "what we discussed", timeRange: { start: "2024-01-01" } }`,
  args: {
    query: tool.schema.string().describe("Search query"),
    category: tool.schema
      .enum(["conversation", "fact", "preference", "task", "decision", "note", "all"])
      .optional()
      .describe("Filter by category"),
    limit: tool.schema.number().default(5).describe("Maximum results"),
    threshold: tool.schema
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Minimum similarity threshold"),
  },
  async execute(args) {
    const { getMemory } = await loadMemoryModule()

    try {
      const store = getMemory()
      const results = await store.search({
        query: args.query,
        namespace: "zee",
        limit: args.limit ?? 5,
        threshold: args.threshold ?? 0.5,
        category: args.category && args.category !== "all" ? (args.category as any) : undefined,
      })

      if (results.length === 0) {
        // Fallback: list recent memories when semantic search misses
        const fallbackCategory = args.category && args.category !== "all" ? args.category as any : undefined
        const fallback = await store.list({ limit: args.limit ?? 5, category: fallbackCategory, namespace: "zee" })
        if (fallback.length > 0) {
          const formattedFallback = fallback
            .map((entry: any, i: number) => {
              const preview = entry.content.substring(0, 150)
              const ellipsis = entry.content.length > 150 ? "..." : ""
              const date = new Date(entry.createdAt).toLocaleDateString()
              return `${i + 1}. [${entry.category}] (${date})
   "${preview}${ellipsis}"
   ID: ${entry.id}`
            })
            .join("\n\n")

          return `No semantic matches for "${args.query}", showing ${fallback.length} recent memories instead:

${formattedFallback}

(These are recent memories, not similarity-ranked. Try zee:memory-agentic-search with a domain filter for structured lookups.)`
        }

        return `No memories found matching: "${args.query}"

Try:
- Using different keywords
- Removing category filters
- Using zee:memory-agentic-search with domain/topic filters for structured data`
      }

      const formattedResults = results
        .map((r, i) => {
          const preview = r.entry.content.substring(0, 150)
          const ellipsis = r.entry.content.length > 150 ? "..." : ""
          const date = new Date(r.entry.createdAt).toLocaleDateString()
          const score = (r.score * 100).toFixed(0)
          return `${i + 1}. [${r.entry.category}] (${score}% match, ${date})
   "${preview}${ellipsis}"
   ID: ${r.entry.id}`
        })
        .join("\n\n")

      return `Found ${results.length} memories matching: "${args.query}"

${formattedResults}`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
        return `Could not connect to memory storage (Qdrant).

To enable memory search:
1. Start Qdrant: docker run -p 6333:6333 qdrant/qdrant
2. Or configure a different backend in agent-core config

Error: ${errorMsg}`
      }

      return `Failed to search memories: ${errorMsg}`
    }
  },
})
