import { describe, expect, it, vi } from "vitest";

vi.mock("../../memory/index.js", () => {
  return {
    getMemorySearchManager: async () => {
      return {
        manager: {
          search: async () => {
            throw new Error("google embeddings failed: 429 rate limit");
          },
          readFile: async () => {
            throw new Error("path required");
          },
          status: () => ({
            files: 0,
            chunks: 0,
            dirty: true,
            workspaceDir: "/tmp",
            dbPath: "/tmp/index.sqlite",
            provider: "google",
            model: "gemini-embedding-001",
            requestedProvider: "google",
          }),
        },
      };
    },
  };
});

import { createMemoryGetTool, createMemorySearchTool } from "./memory-tool.js";

describe("memory tools", () => {
  it("does not throw when memory_search fails (e.g. embeddings 429)", async () => {
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemorySearchTool({ config: cfg });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("tool missing");

    const result = await tool.execute("call_1", { query: "hello" });
    expect(result.details).toEqual({
      results: [],
      disabled: true,
      error: "google embeddings failed: 429 rate limit",
    });
  });

  it("does not throw when memory_get fails", async () => {
    const cfg = { agents: { list: [{ id: "main", default: true }] } };
    const tool = createMemoryGetTool({ config: cfg });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("tool missing");

    const result = await tool.execute("call_2", { path: "memory/NOPE.md" });
    expect(result.details).toEqual({
      path: "memory/NOPE.md",
      text: "",
      disabled: true,
      error: "path required",
    });
  });
});
