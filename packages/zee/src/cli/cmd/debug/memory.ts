import { Timestamp } from "../../../util/timestamp"
import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import { getLocalMemoryStatus } from "../../../../../../src/memory/local-runtime"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "show local memory stats",
  builder: (yargs) =>
    yargs
      .command(StatsMemoryCommand)
      .command(SearchMemoryCommand)
      .demandCommand(),
  async handler() {},
})

const StatsMemoryCommand = cmd({
  command: "stats",
  describe: "show memory statistics",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      // Get Node.js memory stats
      const nodeMemory = process.memoryUsage()
      const localMemory = await getLocalMemoryStatus()

      const stats = {
        node: {
          heapUsed: formatBytes(nodeMemory.heapUsed),
          heapTotal: formatBytes(nodeMemory.heapTotal),
          external: formatBytes(nodeMemory.external),
          rss: formatBytes(nodeMemory.rss),
        },
        localMemory,
      }

      if (args.json) {
        console.log(JSON.stringify(stats, null, 2))
        return
      }

      console.log("Node.js Memory:")
      console.log(`  Heap Used:  ${stats.node.heapUsed}`)
      console.log(`  Heap Total: ${stats.node.heapTotal}`)
      console.log(`  External:   ${stats.node.external}`)
      console.log(`  RSS:        ${stats.node.rss}`)
      console.log("")

      console.log("Local Memory:")
      console.log(`  Status: ${localMemory.ok ? "Ready" : "Not prepared"}`)
      console.log(`  Scope: ${localMemory.scope}`)
      console.log(`  Vector DB: ${localMemory.sqlite.vectorDbPath}`)
      console.log(`  FTS DB: ${localMemory.sqlite.ftsDbPath}`)
      console.log(`  Embedding: ${localMemory.embedding.model} (${localMemory.embedding.dimensions} dims)`)
    })
  },
})

const SearchMemoryCommand = cmd({
  command: "search <query>",
  describe: "search vector memory using semantic similarity",
  builder: (yargs) =>
    yargs
      .positional("query", {
        type: "string",
        demandOption: true,
        describe: "search query",
      })
      .option("collection", {
        alias: "c",
        type: "string",
        describe: "collection to search",
      })
      .option("limit", {
        alias: "n",
        type: "number",
        default: 5,
        describe: "number of results",
      })
      .option("category", {
        type: "string",
        describe: "filter by category (fact, preference, decision, note)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      try {
        // Try to get the memory store from src/memory (root of monorepo)
        const { getMemory } = await import("../../../../../../src/memory/unified")
        const store = getMemory()

        // Search using the memory store
        const results = await store.search({
          query: args.query,
          limit: args.limit,
          category: args.category as any,
        })

        if (args.json) {
          console.log(JSON.stringify(results, null, 2))
          return
        }

        if (results.length === 0) {
          console.log("No results found.")
          return
        }

        console.log(`Found ${results.length} results for: "${args.query}"`)
        console.log("")

        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          const entry = result.entry
          console.log(`${i + 1}. [${entry.category || "unknown"}] (score: ${result.score?.toFixed(3) || "N/A"})`)
          console.log(`   ${entry.content}`)
          if (entry.metadata) {
            const meta = entry.metadata as Record<string, unknown>
            if (meta.source) console.log(`   Source: ${meta.source}`)
            if (meta.extractedAt) console.log(`   Extracted: ${Timestamp.pretty(new Date(meta.extractedAt as number))}`)
          }
          console.log("")
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
        console.log("")
        console.log("Run `zee memory prepare` and try again.")
      }
    })
  },
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}
