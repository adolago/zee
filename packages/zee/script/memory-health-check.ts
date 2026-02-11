import { getMemoryEmbeddingConfig } from "../../../src/config/runtime"
import type { MemoryCategory } from "../../../src/memory/types"
import { Memory } from "../../../src/memory"

type ArgMap = Record<string, string | boolean>

function parseArgs(argv: string[]): ArgMap {
  const args: ArgMap = {}
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    if (!raw.startsWith("--")) continue
    const key = raw.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function readNumber(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function printHelp(): void {
  const text = [
    "Memory health check (Qdrant + embeddings).",
    "",
    "Usage:",
    "  bun run script/memory-health-check.ts [options]",
    "",
    "Options:",
    "  --namespace <name>       Namespace to use (default: codex-healthcheck)",
    "  --query <text>           Query text for semantic search",
    "  --content <text>         Content to store",
    "  --category <category>    Memory category (default: note)",
    "  --threshold <float>      Search threshold (default: 0.2)",
    "  --limit <number>         Search result limit (default: 3)",
    "  --expected-dim <number>  Expected embedding dimension",
    "  --help                   Show this help",
  ].join("\n")
  console.log(text)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const namespace = typeof args.namespace === "string" ? args.namespace : "codex-healthcheck"
  const query =
    typeof args.query === "string" ? args.query : "memory embedding health check"
  const content =
    typeof args.content === "string"
      ? args.content
      : `Memory embedding health check ${new Date().toISOString()}`
  const category = (typeof args.category === "string" ? args.category : "note") as MemoryCategory
  const threshold = readNumber(args.threshold, 0.2)
  const limit = Math.max(1, Math.floor(readNumber(args.limit, 3)))
  const expectedDim = readNumber(
    args["expected-dim"],
    getMemoryEmbeddingConfig().dimensions ?? 0,
  )

  const memory = new Memory({ namespace })
  await memory.init()
  if (!memory.isAvailable()) {
    console.error("Memory backend is unavailable; check Qdrant and embedding config.")
    process.exit(1)
  }

  const entry = await memory.save({
    category,
    content,
    metadata: {
      surface: "cli",
      tags: ["healthcheck", "memory", "embedding"],
    },
    namespace,
  })

  const embeddingLen = entry.embedding?.length ?? 0
  const results = await memory.search({
    query,
    limit,
    threshold,
    namespace,
    category,
  })

  const matched = results.find((item) => item.entry.id === entry.id)

  await memory.delete(entry.id)
  const afterDelete = await memory.get(entry.id)

  const okEmbedding = expectedDim > 0 ? embeddingLen === expectedDim : embeddingLen > 0
  const okMatch = Boolean(matched)
  const okDelete = afterDelete === null
  const ok = okEmbedding && okMatch && okDelete

  console.log(
    JSON.stringify(
      {
        ok,
        namespace,
        savedId: entry.id,
        embeddingLen,
        expectedDim: expectedDim || null,
        searchCount: results.length,
        matchedSavedId: okMatch,
        matchedScore: matched?.score ?? null,
        deleted: okDelete,
      },
      null,
      2,
    ),
  )

  if (!ok) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
