import type { BenchCase } from "./types"
import { runLoad, summarizeLatenciesMs } from "./_util"

export const bench: BenchCase = {
  id: "memory_semantic",
  name: "Memory search (semantic)",
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

    const queries = mem.queries.semantic
    if (queries.length === 0) {
      return {
        id: this.id,
        name: this.name,
        group: this.group,
        status: "skipped",
        reason: "No semantic queries generated",
      }
    }

    // Warmup
    for (let i = 0; i < Math.min(10, queries.length); i++) {
      await mem.memory.search({
        query: queries[i] as string,
        mode: "semantic",
        limit: 10,
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
          mode: "semantic",
          limit: 10,
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
