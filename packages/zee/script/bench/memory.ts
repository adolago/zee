import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Memory, resetMemory } from "../../../../src/memory/unified"
import { mapWithConcurrency } from "./_util"

export interface MemoryBenchContext {
  memory: Memory
  namespace: string
  collection: string
  storageDir: string
  ftsDir: string
  queries: {
    keyword: string[]
    semantic: string[]
    hybrid: string[]
  }
  cleanup: () => Promise<void>
}

export async function createMemoryBenchContext(options: {
  seedCount: number
  concurrency: number
  namespace?: string
}): Promise<{ ctx: MemoryBenchContext | null; skipReason?: string }> {
  const namespace = options.namespace ?? "bench"
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-bench-memory-"))
  const ftsDir = fs.mkdtempSync(path.join(os.tmpdir(), "zee-bench-fts-"))
  const collection = `bench_mem_${Date.now()}_${Math.random().toString(16).slice(2)}`

  resetMemory()
  const memory = new Memory({
    storage: {
      collection,
      dbPath: path.join(storageDir, "memory.sqlite"),
    },
    embedding: { provider: "local", dimensions: 384 },
    namespace,
    localIndex: {
      enabled: true,
      backend: "sqlite-fts",
      dbDir: ftsDir,
      dbName: "fts.sqlite",
      degradedRead: "off",
    },
    markdown: { enabled: false },
  })

  try {
    await memory.init()
    if (!memory.isAvailable()) {
      return {
        ctx: null,
        skipReason: "Memory unavailable after local SQLite init failed",
      }
    }

    const seedCount = Math.max(0, Math.floor(options.seedCount))
    const ids = Array.from({ length: seedCount }, (_, i) => i)

    await mapWithConcurrency(ids, Math.max(1, options.concurrency), async (i) => {
      const tag = i % 3 === 0 ? "alpha" : i % 3 === 1 ? "beta" : "gamma"
      const topic = `topic_${i % 10}`
      const subtopic = `sub_${i % 4}`
      const bucket = `bucket_${i % 25}`

      await memory.save({
        category: "note",
        content: `zee bench entry_${i} ${topic} ${subtopic} ${bucket} tag ${tag} issue 206 memory search perf`,
        summary: `bench entry_${i}`,
        namespace,
        domain: "bench",
        topic,
        subtopic,
        metadata: { tags: [tag, bucket] },
      })
    })

    const queryCount = Math.min(25, seedCount)
    const queryIds = new Set<number>()
    while (queryIds.size < queryCount && seedCount > 0) {
      queryIds.add(Math.floor(Math.random() * seedCount))
    }

    const keyword = Array.from(queryIds).map((i) => `entry_${i}`)
    const semantic = [
      "zee bench memory search performance",
      "issue 206 perf search",
      "topic_1 sub_1",
      "tag alpha",
      "bucket_7",
    ]
    const hybrid = ["zee issue 206 memory search", "topic_2 sub_2 tag beta", "bucket_3 tag gamma"]

    const cleanup = async () => {
      try {
        fs.rmSync(storageDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
      try {
        fs.rmSync(ftsDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
      resetMemory()
    }

    return {
      ctx: {
        memory,
        namespace,
        collection,
        storageDir,
        ftsDir,
        queries: { keyword, semantic, hybrid },
        cleanup,
      },
    }
  } catch (e) {
    try {
      fs.rmSync(storageDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    try {
      fs.rmSync(ftsDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    return {
      ctx: null,
      skipReason: `Memory bench init failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
