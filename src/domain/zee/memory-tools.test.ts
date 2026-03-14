/**
 * Domain Memory Tools Tests
 *
 * Tests tool execute() with real Memory backend:
 * - zee:memory-query: unified retrieval (search, browse, filter modes; time ranges; entity filter)
 * - zee:memory-entities: generate, list, read actions
 * - zee:memory-belief: reinforce, challenge, status actions
 * - zee:memory-reflect: triggers reflect job, returns results
 * - zee:memory-store: accepts confidence/evidenceFor params
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock Bun-dependent modules before any imports that trigger them
vi.mock("../../../packages/zee/src/global/index", () => ({
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

vi.mock("../../config/runtime", () => ({
  getMemoryQdrantConfig: () => ({}),
  getMemoryEmbeddingConfig: () => ({}),
  getMemoryMigrationHints: () => ({}),
  getMemoryLocalIndexConfig: () => ({ enabled: false, backend: "sqlite-fts", degradedRead: "off" }),
  getMemoryRerankerConfig: () => ({ enabled: false }),
  isMemoryQdrantCollectionConfiguredByUser: () => false,
}));

vi.mock("../../../packages/zee/src/util/log", () => {
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
import { getMemory, resetMemory } from "../../memory/unified";
import { resetMarkdownSync } from "../../memory/markdown-sync";
import type { ToolExecutionContext, ToolExecutionResult } from "../../mcp/types";
import {
  memoryStoreTool,
  memoryQueryTool,
  memoryEntitiesTool,
  memoryBeliefTool,
  memoryReflectTool,
} from "./tools";

const COLLECTION = `test_memv2_tools_${Date.now()}`;
const QDRANT_URL = "http://localhost:6333";
const testDir = mkdtempSync(join(tmpdir(), "memv2-tools-"));

let qdrantAvailable = false;

// Stored entry ID for belief tests
let beliefEntryId: string;

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

/** Build a minimal ToolExecutionContext for testing */
function makeCtx(): ToolExecutionContext {
  return {
    sessionId: "test-session",
    messageId: "test-message",
    agent: "test",
    abort: new AbortController().signal,
    extra: { surface: "test", sessionId: "test-session" },
    metadata: () => {},
  };
}

/** Initialize a tool and get the execute function */
async function getExecute(tool: any): Promise<(args: any, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> {
  const runtime = await tool.init();
  return runtime.execute;
}

beforeAll(async () => {
  qdrantAvailable = await checkQdrant();
  if (!qdrantAvailable) return;

  globalThis.fetch = patchedFetch;
  resetMemory();
  resetMarkdownSync();

  // Initialize the singleton with test config
	  const mem = getMemory({
	    qdrant: { url: QDRANT_URL, collection: COLLECTION },
	    embedding: { provider: "google", dimensions: 384 },
	    namespace: "zee",
	    markdown: { baseDir: testDir, enabled: true },
	  });
  await mem.init();
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

describe("zee:memory-store", () => {
  it("stores a memory with confidence and evidence params", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryStoreTool);
    const result = await execute({
      content: "Bun is faster than Node for most workloads",
      category: "fact",
      importance: 0.8,
      domain: "tech",
      topic: "runtimes",
      confidence: 0.75,
      evidenceFor: ["Benchmarks show 2x throughput"],
    }, makeCtx());

    expect(result.title).toBe("Memory Stored");
    expect(result.output).toContain("Bun is faster");
    expect(result.output).toContain("75%");
    expect(result.metadata.id).toBeDefined();

    // Save the ID for belief tests
    beliefEntryId = result.metadata.id as string;
  });

  it("stores a simple note without confidence", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryStoreTool);
    const result = await execute({
      content: "Meeting with Alice tomorrow at 3pm",
      category: "note",
      importance: 0.5,
    }, makeCtx());

    expect(result.title).toBe("Memory Stored");
    expect(result.output).toContain("Meeting with Alice");
  });
});

describe("zee:memory-belief", () => {
  it("returns belief status for an entry", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryBeliefTool);
    const result = await execute({
      action: "status",
      id: beliefEntryId,
    }, makeCtx());

    expect(result.output).toContain("Confidence:");
    expect(result.output).toContain("75%");
    expect(result.output).toContain("Evidence FOR");
    expect(result.output).toContain("Evidence AGAINST");
  });

  it("reinforces a belief with evidence", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryBeliefTool);
    const result = await execute({
      action: "reinforce",
      id: beliefEntryId,
      evidence: "Independent benchmark confirms faster cold starts",
      strength: 0.1,
    }, makeCtx());

    expect(result.title).toContain("Reinforced");
    expect(result.output).toContain("85%");
    expect(result.output).toContain("Independent benchmark");
  });

  it("challenges a belief with evidence", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryBeliefTool);
    const result = await execute({
      action: "challenge",
      id: beliefEntryId,
      evidence: "Node 22 closed the performance gap significantly",
      strength: 0.15,
    }, makeCtx());

    expect(result.title).toContain("Challenged");
    expect(result.output).toContain("Node 22");
  });

  it("returns not found for invalid ID", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryBeliefTool);
    const result = await execute({
      action: "status",
      id: "00000000-0000-0000-0000-000000000000",
    }, makeCtx());

    expect(result.output).toContain("not found");
  });
});

describe("zee:memory-query (temporal / filter modes)", () => {
  it("queries with relative time (30d) via search mode", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryQueryTool);
    const result = await execute({
      mode: "search",
      query: "test",
      since: "30d",
      limit: 10,
    }, makeCtx());

    // Should find the entries we stored (they were just created)
    expect(result.metadata).toBeDefined();
    expect(typeof result.title).toBe("string");
  });

  it("queries with absolute ISO dates", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryQueryTool);
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const tomorrow = new Date(Date.now() + 86400000).toISOString();

    const result = await execute({
      mode: "search",
      query: "test",
      since: yesterday,
      until: tomorrow,
      limit: 10,
    }, makeCtx());

    expect(result.metadata).toBeDefined();
  });

  it("filters by domain with query via filter mode", async () => {
    if (!qdrantAvailable) return;

    // First store an entry with entity metadata
    const storeExec = await getExecute(memoryStoreTool);
    await storeExec({
      content: "Charlie mentioned the project deadline is Friday",
      category: "fact",
      importance: 0.6,
      tags: ["charlie"],
    }, makeCtx());

    await new Promise((r) => setTimeout(r, 300));

    const execute = await getExecute(memoryQueryTool);
    const result = await execute({
      mode: "filter",
      since: "1d",
      query: "Charlie project deadline",
      limit: 5,
    }, makeCtx());

    expect(result.metadata).toBeDefined();
  });

  it("combines query with minConfidence filter", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryQueryTool);
    const result = await execute({
      mode: "filter",
      since: "30d",
      query: "faster than",
      minConfidence: 0.5,
      limit: 5,
    }, makeCtx());

    expect(result.metadata).toBeDefined();
  });

  it("browses domains via browse mode", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryQueryTool);
    const result = await execute({
      mode: "browse",
      browseAction: "list-domains",
    }, makeCtx());

    expect(result.metadata).toBeDefined();
    expect(typeof result.output).toBe("string");
  });
});

describe("zee:memory-entities", () => {
  it("list action returns entity list or empty message", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryEntitiesTool);
    const result = await execute({
      action: "list",
    }, makeCtx());

    expect(result.title).toBeDefined();
    // Either shows entities or "No Entities"
    expect(typeof result.output).toBe("string");
  });

  it("generate action creates entity pages", async () => {
    if (!qdrantAvailable) return;

    // Store entity-tagged memories first
    const storeExec = await getExecute(memoryStoreTool);
    await storeExec({
      content: "Qdrant supports filtering and hybrid search",
      category: "fact",
      importance: 0.7,
      tags: ["qdrant"],
    }, makeCtx());

    await new Promise((r) => setTimeout(r, 300));

    const execute = await getExecute(memoryEntitiesTool);
    const result = await execute({
      action: "generate",
    }, makeCtx());

    expect(result.metadata).toBeDefined();
    // May generate pages or report "No Pages Generated" depending on entity discovery
    expect(typeof result.output).toBe("string");
  });

  it("read action returns page content or not found", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryEntitiesTool);
    const result = await execute({
      action: "read",
      entity: "NonExistentEntity12345",
    }, makeCtx());

    expect(result.title).toContain("Not Found");
    expect(result.output).toContain("No entity page found");
  });

  it("read without entity name returns error", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryEntitiesTool);
    const result = await execute({
      action: "read",
    }, makeCtx());

    expect(result.output).toContain("entity");
  });
});

describe("zee:memory-reflect", () => {
  it("triggers reflect job and returns results", async () => {
    if (!qdrantAvailable) return;

    const execute = await getExecute(memoryReflectTool);
    const result = await execute({
      namespace: "zee",
      scanLimit: 20,
      updateEntityPages: false,
    }, makeCtx());

    expect(result.title).toContain("Reflect");
    expect(result.output).toContain("Duplicates merged:");
    expect(result.output).toContain("Stale beliefs found:");
    expect(result.output).toContain("Beliefs decayed:");
    expect(result.output).toContain("Entity pages updated:");
    expect(result.metadata).toHaveProperty("durationMs");
  });
});
