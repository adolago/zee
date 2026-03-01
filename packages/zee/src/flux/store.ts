import type { FluxEvent, FluxQuery, FluxSessionPath, FluxStoreConfig } from "./types"

export class FluxStore {
  private events: FluxEvent[] = []
  private config: FluxStoreConfig

  constructor(config: FluxStoreConfig) {
    this.config = config
  }

  setConfig(config: FluxStoreConfig): void {
    this.config = config
    this.prune()
  }

  getConfig(): FluxStoreConfig {
    return this.config
  }

  add(event: FluxEvent): void {
    if (!this.config.enabled) return
    this.events.push(event)
    this.prune()
  }

  list(query: FluxQuery = {}): FluxEvent[] {
    const offset = Math.max(0, query.offset ?? 0)
    const limit = Math.max(1, Math.min(1000, query.limit ?? 200))
    const from = query.from ?? Number.MIN_SAFE_INTEGER
    const to = query.to ?? Number.MAX_SAFE_INTEGER

    const filtered = this.events.filter((event) => {
      if (event.timestamp < from || event.timestamp > to) return false
      if (query.traceID && event.traceID !== query.traceID) return false
      if (query.sessionID && event.sessionID !== query.sessionID) return false
      if (query.domain && event.domain !== query.domain) return false
      if (query.kind && event.kind !== query.kind) return false
      return true
    })

    return filtered.slice(offset, offset + limit)
  }

  count(query: FluxQuery = {}): number {
    const from = query.from ?? Number.MIN_SAFE_INTEGER
    const to = query.to ?? Number.MAX_SAFE_INTEGER
    let total = 0
    for (const event of this.events) {
      if (event.timestamp < from || event.timestamp > to) continue
      if (query.traceID && event.traceID !== query.traceID) continue
      if (query.sessionID && event.sessionID !== query.sessionID) continue
      if (query.domain && event.domain !== query.domain) continue
      if (query.kind && event.kind !== query.kind) continue
      total++
    }
    return total
  }

  getTrace(traceID: string): FluxEvent[] {
    return this.events.filter((event) => event.traceID === traceID)
  }

  getSessionPath(sessionID: string): FluxSessionPath {
    const events = this.events.filter((event) => event.sessionID === sessionID)
    const traces = Array.from(new Set(events.map((event) => event.traceID)))
    const totals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    }

    for (const event of events) {
      const token = event.token
      if (!token) continue
      totals.input += token.input ?? 0
      totals.output += token.output ?? 0
      totals.cacheRead += token.cacheRead ?? 0
      totals.cacheWrite += token.cacheWrite ?? 0
      totals.reasoning += token.reasoning ?? 0
      totals.total += token.total ?? 0
    }

    return {
      sessionID,
      traces,
      events,
      totals,
    }
  }

  getStats(): { total: number; traceCount: number; sessionCount: number } {
    const traceIDs = new Set<string>()
    const sessionIDs = new Set<string>()
    for (const event of this.events) {
      traceIDs.add(event.traceID)
      if (event.sessionID) sessionIDs.add(event.sessionID)
    }
    return {
      total: this.events.length,
      traceCount: traceIDs.size,
      sessionCount: sessionIDs.size,
    }
  }

  private prune(): void {
    const now = Date.now()
    const oldest = now - this.config.retentionMs
    if (this.events.length === 0) return

    // Time-based pruning
    if (this.events[0].timestamp < oldest) {
      this.events = this.events.filter((event) => event.timestamp >= oldest)
    }

    // Per-trace guardrail
    const perTrace = new Map<string, number>()
    const pruned: FluxEvent[] = []
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]
      const count = perTrace.get(event.traceID) ?? 0
      if (count >= this.config.maxEventsPerTrace) continue
      perTrace.set(event.traceID, count + 1)
      pruned.push(event)
    }
    pruned.reverse()
    this.events = pruned

    // Global cap
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(this.events.length - this.config.maxEvents)
    }
  }
}
