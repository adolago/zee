import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveSessionFilePath, resolveSessionTranscriptsDirForAgent } from "./paths.js";

describe("session paths", () => {
  it("normalizes absolute sessionFile paths within the agent sessions directory", () => {
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main");
    const absolutePath = path.join(sessionsDir, "abc-123.jsonl");

    const resolved = resolveSessionFilePath(
      "sess-1",
      { sessionFile: absolutePath },
      { agentId: "main" },
    );

    expect(resolved).toBe(path.resolve(sessionsDir, "abc-123.jsonl"));
  });

  it("normalizes absolute sessionFile paths with topic suffixes within the sessions directory", () => {
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main");
    const absolutePath = path.join(sessionsDir, "abc-123-topic-42.jsonl");

    const resolved = resolveSessionFilePath(
      "sess-1",
      { sessionFile: absolutePath },
      { agentId: "main" },
    );

    expect(resolved).toBe(path.resolve(sessionsDir, "abc-123-topic-42.jsonl"));
  });

  it("leaves absolute sessionFile paths outside the sessions directory unchanged", () => {
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main");
    const outsidePath = path.resolve(path.dirname(sessionsDir), "work", "sessions", "abc-123.jsonl");

    const resolved = resolveSessionFilePath(
      "sess-1",
      { sessionFile: outsidePath },
      { agentId: "main" },
    );

    expect(resolved).toBe(outsidePath);
  });
});
