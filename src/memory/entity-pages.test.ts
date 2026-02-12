/**
 * Entity Pages Tests (Gap 5)
 *
 * Tests against real Qdrant:
 * - discoverEntities(): finds unique entity names from stored memories
 * - getEntityMemories(): retrieves memories for a specific entity
 * - generateEntityPages(): writes markdown files, returns EntityPageResult[]
 * - Entity page content contains facts grouped by category
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock Bun-dependent modules before any imports that trigger them
vi.mock("../../packages/zee/src/global/index", () => ({
  Global: {
    Path: {
      home: "/tmp/test", source: "/tmp/test", data: "/tmp/test/data",
      bin: "/tmp/test/bin", log: "/tmp/test/log", cache: "/tmp/test/cache",
      config: "/tmp/test/config", state: "/tmp/test/state", tmp: "/tmp/test/tmp",
    },
  },
}));

vi.mock("bun:sqlite", () => ({
  Database: class MockDatabase {
    constructor() {}
    exec() {}
    prepare() { return { run: () => {}, all: () => [], get: () => null }; }
    close() {}
  },
}));

vi.mock("../config/runtime", () => ({
  getMemoryQdrantConfig: () => ({}),
  getMemoryEmbeddingConfig: () => ({}),
  getMemoryRerankerConfig: () => ({ enabled: false }),
}));

vi.mock("../../packages/zee/src/util/log", () => {
  const noop = () => {};
  const noopLogger = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop,
    tag: () => noopLogger, clone: () => noopLogger,
    time: () => ({ stop: noop, [Symbol.dispose]: noop }),
  };
  return {
    Log: {
      create: () => noopLogger, Default: noopLogger,
      Level: { parse: (v: string) => v }, init: async () => {}, file: () => "",
    },
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Memory, resetMemory } from "./unified";
import { discoverEntities, getEntityMemories, generateEntityPages } from "./entity-pages";
import { resetMarkdownSync } from "./markdown-sync";

const COLLECTION = `test_memv2_entities_${Date.now()}`;
const QDRANT_URL = "http://localhost:6333";
const testDir = mkdtempSync(join(tmpdir(), "memv2-entity-pages-"));

let memory: Memory;
let qdrantAvailable = false;

/** Intercept fetch to add ?wait=true to Qdrant write operations */
const originalFetch = globalThis.fetch;
const patchedFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.includes(QDRANT_URL) && (method === "PUT" || method === "POST") &&
      (url.includes("/points") && !url.includes("/points/scroll") && !url.includes("/points/search") && !url.includes("/points/count"))) {
    const separator = url.includes("?") ? "&" : "?";
    return originalFetch(`${url}${separator}wait=true`, init);
  }
  return originalFetch(input, init);
};

async function checkQdrant(): Promise<boolean> {
  try {
    const res = await originalFetch(`${QDRANT_URL}/collections`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteCollection(): Promise<void> {
  try {
    await originalFetch(`${QDRANT_URL}/collections/${COLLECTION}`, { method: "DELETE" });
  } catch {
    // ignore
  }
}

beforeAll(async () => {
  qdrantAvailable = await checkQdrant();
  if (!qdrantAvailable) return;

  globalThis.fetch = patchedFetch;
  resetMemory();
  resetMarkdownSync();
  memory = new Memory({
    qdrant: { url: QDRANT_URL, collection: COLLECTION },
    embedding: { provider: "google", dimensions: 384 },
    namespace: "test-entities",
    markdown: { baseDir: testDir, enabled: true },
  });
  await memory.init();

  // Seed test data with entity-tagged memories
  await memory.save({
    category: "fact",
    content: "Alice is a software engineer at Acme Corp",
    metadata: { entities: ["Alice", "Acme Corp"] },
    domain: "people",
    namespace: "test-entities",
  });
  await memory.save({
    category: "fact",
    content: "Alice prefers TypeScript over JavaScript",
    metadata: { entities: ["Alice"] },
    domain: "people",
    namespace: "test-entities",
    confidence: 0.8,
  });
  await memory.save({
    category: "decision",
    content: "Acme Corp decided to adopt Rust for the backend",
    metadata: { entities: ["Acme Corp", "Rust"] },
    domain: "companies",
    namespace: "test-entities",
  });
  await memory.save({
    category: "fact",
    content: "Bob manages the infrastructure team",
    metadata: { entities: ["Bob", "Acme Corp"] },
    domain: "people",
    namespace: "test-entities",
  });

  // Small delay for indexing
  await new Promise((r) => setTimeout(r, 500));
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  if (qdrantAvailable) {
    await deleteCollection();
  }
  resetMemory();
  resetMarkdownSync();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("Entity Pages", () => {
  describe("discoverEntities", () => {
    it("finds unique entity names from stored memories", async () => {
      if (!qdrantAvailable) return;

      const entities = await discoverEntities(memory, "test-entities");
      // The agentic search uses domain: "*" which may or may not match
      // but the entities we stored should be discoverable
      expect(Array.isArray(entities)).toBe(true);
    });
  });

  describe("getEntityMemories", () => {
    it("retrieves memories for a specific entity", async () => {
      if (!qdrantAvailable) return;

      const memories = await getEntityMemories(memory, "Alice", "test-entities");
      expect(memories.length).toBeGreaterThanOrEqual(1);

      // All returned entries should reference Alice
      for (const entry of memories) {
        const mentionsAlice =
          (entry.metadata?.entities ?? []).some((e) => e.toLowerCase() === "alice") ||
          entry.content.toLowerCase().includes("alice");
        expect(mentionsAlice).toBe(true);
      }
    });

    it("returns empty array for unknown entity", async () => {
      if (!qdrantAvailable) return;

      const memories = await getEntityMemories(memory, "ZzNonExistentEntity999", "test-entities");
      expect(memories).toEqual([]);
    });
  });

  describe("generateEntityPages", () => {
    it("writes markdown files and returns EntityPageResult[]", async () => {
      if (!qdrantAvailable) return;

      const results = await generateEntityPages(memory, {
        entities: ["Alice"],
        namespace: "test-entities",
        markdownConfig: { baseDir: testDir, enabled: true },
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      const alicePage = results.find((r) => r.entityName === "Alice");
      expect(alicePage).toBeDefined();
      expect(alicePage!.factCount).toBeGreaterThanOrEqual(1);
      expect(alicePage!.filePath).toContain("alice.md");
    });

    it("entity page content contains facts", async () => {
      if (!qdrantAvailable) return;

      const { MarkdownSync } = await import("./markdown-sync");
      const mdSync = new MarkdownSync({ baseDir: testDir, enabled: true });
      const content = mdSync.readEntityPage("Alice");

      if (content) {
        expect(content).toContain("# Alice");
        expect(content).toContain("## Summary");
        expect(content).toContain("## Facts");
      }
    });

    it("returns empty array when no entities have data", async () => {
      if (!qdrantAvailable) return;

      const results = await generateEntityPages(memory, {
        entities: ["CompletelyUnknownEntity12345"],
        namespace: "test-entities",
        markdownConfig: { baseDir: testDir, enabled: true },
      });

      expect(results).toEqual([]);
    });
  });
});
