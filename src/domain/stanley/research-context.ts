/**
 * Stanley Research Context Manager
 *
 * Session-scoped tool call deduplication and context tracking
 * for multi-step financial research workflows.
 */

/**
 * Record of a single tool call within a research session.
 */
export interface ToolCallRecord {
  toolId: string;
  args: Record<string, unknown>;
  cacheKey: string;
  resultSummary: string;
  fullOutput: string;
  estimatedTokens: number;
  timestamp: number;
}

export interface ResearchContextConfig {
  /** Context usage threshold (0-1) to trigger pruning. Default: 0.80 */
  pruneThreshold: number;
  /** Max characters for truncated summaries. Default: 2000 */
  summaryMaxChars: number;
  /** Enable deduplication. Default: true */
  deduplication: boolean;
}

const DEFAULT_CONFIG: ResearchContextConfig = {
  pruneThreshold: 0.80,
  summaryMaxChars: 2000,
  deduplication: true,
};

/**
 * Compute a deterministic cache key from toolId + args.
 * Keys are sorted alphabetically; undefined values are filtered.
 */
export function computeCacheKey(toolId: string, args: Record<string, unknown>): string {
  const sortedEntries = Object.entries(args)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const canonical = sortedEntries
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("&");
  return `${toolId}:${canonical}`;
}

export class ResearchContextManager {
  private records: ToolCallRecord[] = [];
  private cache = new Map<string, ToolCallRecord>();
  private config: ResearchContextConfig;
  private totalEstimatedTokens = 0;

  constructor(config?: Partial<ResearchContextConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if this exact tool+args combination has been called before */
  isDuplicate(toolId: string, args: Record<string, unknown>): boolean {
    if (!this.config.deduplication) return false;
    return this.cache.has(computeCacheKey(toolId, args));
  }

  /** Get cached result for a duplicate call */
  getCachedResult(toolId: string, args: Record<string, unknown>): ToolCallRecord | undefined {
    return this.cache.get(computeCacheKey(toolId, args));
  }

  /** Record a completed tool call */
  record(toolId: string, args: Record<string, unknown>, output: string): ToolCallRecord {
    const key = computeCacheKey(toolId, args);
    // Rough token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(output.length / 4);
    const record: ToolCallRecord = {
      toolId,
      args,
      cacheKey: key,
      resultSummary: this.truncate(output),
      fullOutput: output,
      estimatedTokens,
      timestamp: Date.now(),
    };
    this.records.push(record);
    this.cache.set(key, record);
    this.totalEstimatedTokens += estimatedTokens;
    return record;
  }

  /** Check if context needs pruning */
  shouldPrune(currentInputTokens: number, modelContextLimit: number): boolean {
    return currentInputTokens / modelContextLimit > this.config.pruneThreshold;
  }

  /** Summarize older records, keeping the most recent N intact */
  summarizeOldRecords(keepRecent = 3): string {
    if (this.records.length <= keepRecent) return "";
    const toPrune = this.records.slice(0, this.records.length - keepRecent);
    const lines = toPrune.map((r) => {
      const argsStr = this.formatArgs(r.args);
      return `- ${r.toolId}(${argsStr}): ${r.resultSummary}`;
    });
    return ["[Previous research tool results - summarized]", ...lines].join("\n");
  }

  getRecords(): readonly ToolCallRecord[] {
    return this.records;
  }

  getEstimatedTokens(): number {
    return this.totalEstimatedTokens;
  }

  getStats() {
    return {
      totalCalls: this.records.length,
      uniqueCalls: this.cache.size,
      duplicatesAvoided: Math.max(0, this.records.length - this.cache.size),
      estimatedTokens: this.totalEstimatedTokens,
    };
  }

  reset(): void {
    this.records = [];
    this.cache.clear();
    this.totalEstimatedTokens = 0;
  }

  private truncate(output: string): string {
    if (output.length <= this.config.summaryMaxChars) return output;
    return output.slice(0, this.config.summaryMaxChars) + "... [truncated]";
  }

  private formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return "";
    const formatted = entries.slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
    return entries.length > 3 ? formatted + ", ..." : formatted;
  }
}

// -- Module-level singleton for current session --

let activeManager: ResearchContextManager | null = null;

export function getResearchContextManager(): ResearchContextManager {
  if (!activeManager) {
    activeManager = new ResearchContextManager();
  }
  return activeManager;
}

export function resetResearchContextManager(): void {
  activeManager?.reset();
  activeManager = null;
}
