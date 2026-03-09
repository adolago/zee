/**
 * Memory Bridge
 *
 * Auto-persist Investing results to external memory systems.
 * This is a hook interface — concrete implementations are provided by the host (e.g., Zee).
 */

/** Context tree location for organizing persisted memories */
export interface MemoryLocation {
  domain: string;
  topic: string;
  subtopic: string;
}

/** A memory entry to persist */
export interface MemoryEntry {
  location: MemoryLocation;
  content: string;
  category: "fact" | "note" | "decision";
  confidence?: number;
  metadata?: Record<string, unknown>;
}

/** Interface for memory persistence backends */
export interface MemoryBackend {
  /** Persist a memory entry */
  persist(entry: MemoryEntry): Promise<void>;
  /** Query memories by location */
  query(location: Partial<MemoryLocation>, limit?: number): Promise<MemoryEntry[]>;
}

/** Rules for when to auto-persist results */
export interface PersistRule {
  /** Match tool/action pattern */
  pattern: string;
  /** Memory location template (supports {symbol}, {strategy} placeholders) */
  location: MemoryLocation;
  /** Category for the memory */
  category: "fact" | "note" | "decision";
  /** Minimum confidence/score to trigger persistence */
  minScore?: number;
  /** Transform result before persisting */
  transform?: (data: unknown) => string;
}

/** Default persistence rules matching the plan's table */
export const DEFAULT_PERSIST_RULES: PersistRule[] = [
  {
    pattern: "research.*",
    location: { domain: "finance", topic: "research", subtopic: "{symbol}" },
    category: "fact",
  },
  {
    pattern: "portfolio.analytics",
    location: { domain: "finance", topic: "portfolio", subtopic: "snapshot" },
    category: "fact",
  },
  {
    pattern: "notes.createTrade",
    location: { domain: "finance", topic: "trades", subtopic: "{symbol}" },
    category: "note",
  },
  {
    pattern: "signals.generate",
    location: { domain: "finance", topic: "signals", subtopic: "{strategy}" },
    category: "fact",
    minScore: 0.7,
  },
  {
    pattern: "macro.getRegime",
    location: { domain: "finance", topic: "macro", subtopic: "regime" },
    category: "fact",
  },
  {
    pattern: "notes.createThesis",
    location: { domain: "finance", topic: "thesis", subtopic: "{symbol}" },
    category: "decision",
  },
  {
    pattern: "accounting.getRedFlags",
    location: { domain: "finance", topic: "accounting", subtopic: "{symbol}" },
    category: "fact",
  },
];

export class MemoryBridge {
  private backend: MemoryBackend | null = null;
  private rules: PersistRule[];

  constructor(rules?: PersistRule[]) {
    this.rules = rules ?? DEFAULT_PERSIST_RULES;
  }

  /** Set the memory backend */
  setBackend(backend: MemoryBackend): void {
    this.backend = backend;
  }

  /** Check if a backend is configured */
  get isConfigured(): boolean {
    return this.backend !== null;
  }

  /** Process a tool result for auto-persistence */
  async onToolResult(
    toolAction: string,
    data: unknown,
    context?: Record<string, string>,
  ): Promise<void> {
    if (!this.backend) return;

    for (const rule of this.rules) {
      if (!matchPattern(rule.pattern, toolAction)) continue;

      // Check minimum score if applicable
      if (rule.minScore !== undefined) {
        const score = extractScore(data);
        if (score !== undefined && score < rule.minScore) continue;
      }

      const location = resolveLocation(rule.location, context);
      const content = rule.transform
        ? rule.transform(data)
        : typeof data === "string"
          ? data
          : JSON.stringify(data, null, 2);

      try {
        await this.backend.persist({
          location,
          content,
          category: rule.category,
          metadata: context,
        });
      } catch {
        // Best effort — don't break the tool call flow
      }
    }
  }

  /** Query prior context for a symbol/topic */
  async getContext(
    location: Partial<MemoryLocation>,
    limit = 5,
  ): Promise<MemoryEntry[]> {
    if (!this.backend) return [];
    try {
      return await this.backend.query(location, limit);
    } catch {
      return [];
    }
  }
}

/** Simple glob-like pattern matching */
function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return value.startsWith(pattern.slice(0, -2));
  }
  return pattern === value;
}

/** Extract a numeric score from tool result data */
function extractScore(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.conviction === "number") return d.conviction;
  if (typeof d.confidence === "number") return d.confidence;
  if (typeof d.score === "number") return d.score;
  return undefined;
}

/** Resolve placeholders in location */
function resolveLocation(
  template: MemoryLocation,
  context?: Record<string, string>,
): MemoryLocation {
  const resolve = (s: string) => {
    if (!context) return s;
    return s.replace(/\{(\w+)\}/g, (_, key) => context[key] ?? key);
  };

  return {
    domain: resolve(template.domain),
    topic: resolve(template.topic),
    subtopic: resolve(template.subtopic),
  };
}
