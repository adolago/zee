import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
const embedQuery = vi.fn(async () => [1, 0, 0]);

const runGeminiEmbeddingBatches = vi.fn(
  async (params: { requests: Array<{ custom_id: string }> }) =>
    new Map(params.requests.map((req) => [req.custom_id, [1, 0, 0]] as const)),
);

vi.mock("./batch-gemini.js", () => ({
  runGeminiEmbeddingBatches,
}));

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "google",
    provider: {
      id: "google",
      model: "gemini-embedding-001",
      embedQuery,
      embedBatch,
    },
    google: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      headers: { "x-goog-api-key": "test", "Content-Type": "application/json" },
      model: "gemini-embedding-001",
      modelPath: "models/gemini-embedding-001",
    },
  }),
}));

describe("memory indexing with Google batches", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    embedBatch.mockClear();
    embedQuery.mockClear();
    runGeminiEmbeddingBatches.mockClear();
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-mem-batch-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("uses Gemini async batches when enabled", async () => {
    await fs.writeFile(path.join(workspaceDir, "memory", "2026-01-07.md"), "hello\n\nfrom\n\nbatch\n");

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "google",
            model: "gemini-embedding-001",
            store: { path: indexPath },
            cache: { enabled: false },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0 },
            remote: { batch: { enabled: true, wait: true } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    await manager.sync({ force: true });
    expect(runGeminiEmbeddingBatches).toHaveBeenCalled();
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("falls back to non-batch embeddings and disables batch after repeated failures", async () => {
    runGeminiEmbeddingBatches.mockImplementation(async () => {
      throw new Error("gemini batch create failed: 503 upstream");
    });

    await fs.writeFile(path.join(workspaceDir, "memory", "2026-01-08.md"), "hello\n\nbatch\n");

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "google",
            model: "gemini-embedding-001",
            store: { path: indexPath },
            cache: { enabled: false },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0 },
            remote: { batch: { enabled: true, wait: true } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) throw new Error("manager missing");
    manager = result.manager;

    await manager.sync({ force: true });
    expect(embedBatch).toHaveBeenCalled();

    const status1 = manager.status();
    expect(status1.batch?.enabled).toBe(true);
    expect(status1.batch?.failures).toBeGreaterThan(0);
    expect(status1.batch?.lastProvider).toBe("google");

    await manager.sync({ force: true });
    const status2 = manager.status();
    expect(status2.batch?.enabled).toBe(false);
  });
});

