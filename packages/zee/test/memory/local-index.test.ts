import { describe, expect, it } from "bun:test";
import type { FtsSearchResult } from "../../../../src/memory/sqlite-fts";
import { Memory } from "../../../../src/memory/unified";

function makeLocalRow(overrides: Partial<FtsSearchResult> = {}): FtsSearchResult {
  return {
    id: "mem-local-1",
    content: "Alice prefers TypeScript",
    summary: "Alice preference",
    category: "fact",
    namespace: "default",
    domain: "people",
    topic: "preferences",
    subtopic: "language",
    createdAt: 1_700_000_000_000,
    score: 0.82,
    rank: -2.1,
    snippet: "Alice prefers <b>TypeScript</b>",
    ...overrides,
  };
}

function makeDegradedMemory(rows: FtsSearchResult[]): Memory {
  const memory = new Memory({
    embedding: { provider: "google", dimensions: 384 },
    localIndex: {
      enabled: true,
      backend: "sqlite-fts",
      degradedRead: "keyword_only",
    },
    markdown: { enabled: false },
  });

  const mem = memory as any;
  mem.init = async () => {};
  mem.initialized = false;
  mem.initFailed = true;
  mem.ftsStore = {
    search: () => rows,
    stats: () => ({ totalEntries: rows.length, dbSizeBytes: 256 }),
  };

  return memory;
}

describe("memory local index degraded reads", () => {
  it("serves keyword results from local index when Qdrant is unavailable", async () => {
    const memory = makeDegradedMemory([makeLocalRow()]);

    const results = await memory.search({
      query: "TypeScript",
      mode: "keyword",
      includeSnippets: true,
      limit: 5,
    });

    expect(results.length).toBe(1);
    expect(results[0].source).toBe("local-index");
    expect(results[0].degraded).toBe(true);
    expect(results[0].entry.content).toContain("Alice prefers TypeScript");
    expect(results[0].snippet).toContain("TypeScript");
  });

  it("does not degrade semantic mode to local index", async () => {
    const memory = makeDegradedMemory([makeLocalRow()]);

    const results = await memory.search({
      query: "TypeScript",
      mode: "semantic",
      limit: 5,
    });

    expect(results).toEqual([]);
  });

  it("reports local index status in stats when Qdrant is unavailable", async () => {
    const rows = [makeLocalRow(), makeLocalRow({ id: "mem-local-2" })];
    const memory = makeDegradedMemory(rows);

    const stats = await memory.stats();

    expect(stats.total).toBe(0);
    expect(stats.localIndex.enabled).toBe(true);
    expect(stats.localIndex.backend).toBe("sqlite-fts");
    expect(stats.localIndex.available).toBe(true);
    expect(stats.localIndex.degradedRead).toBe("keyword_only");
    expect(stats.localIndex.totalEntries).toBe(2);
    expect(stats.fts?.totalEntries).toBe(2);
  });
});
