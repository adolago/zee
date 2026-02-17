import type { BenchCase } from "./types"
import { runLoad, summarizeLatenciesMs } from "./_util"

export const bench: BenchCase = {
  id: "memory_keyword",
  name: "Memory search (keyword)",
  group: "memory",
  async run(ctx, opts) {
    const mem = ctx.memory
    if (!mem) {
      return {
        id: this.id,
        name: this.name,
        group: this.group,
        status: "skipped",
        reason: "Memory context unavailable",
      }
    }

    const queries = mem.queries.keyword
    if (queries.length === 0) {
      return {
        id: this.id,
        name: this.name,
        group: this.group,
        status: "skipped",
        reason: "No keyword queries generated",
      }
    }

    // Warmup
    for (let i = 0; i < Math.min(10, queries.length); i++) {
      await mem.memory.search({
        query: queries[i] as string,
        mode: "keyword",
        limit: 10,
        includeSnippets: false,
        includeVectors: false,
      })
    }

    let empty = 0
    const load = await runLoad({
      durationMs: opts.durationSeconds * 1000,
      concurrency: opts.concurrency,
      fn: async (n) => {
        const q = queries[n % queries.length] as string
        const res = await mem.memory.search({
          query: q,
          mode: "keyword",
          limit: 10,
          includeSnippets: false,
          includeVectors: false,
        })
        if (res.length === 0) empty++
      },
    })

    const latency = summarizeLatenciesMs(load.latenciesMs)
    return {
      id: this.id,
      name: this.name,
      group: this.group,
      status: "ok",
      metrics: {
        durationMs: load.durationMs,
        ops: load.ops,
        opsPerSec: load.durationMs > 0 ? load.ops / (load.durationMs / 1000) : 0,
        errors: load.errors,
        emptyResults: empty,
        latencyMs: latency,
      },
    }
  },
}
