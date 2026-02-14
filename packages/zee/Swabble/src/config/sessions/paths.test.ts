import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
  resolveSessionTranscriptsDirForAgent,
} from "./paths.js";

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

  it("falls back to default session path for absolute sessionFile paths outside the sessions directory", () => {
    const sessionsDir = resolveSessionTranscriptsDirForAgent("main");
    const outsidePath = path.resolve(path.dirname(sessionsDir), "work", "sessions", "abc-123.jsonl");

    const resolved = resolveSessionFilePath(
      "sess-1",
      { sessionFile: outsidePath },
      { agentId: "main" },
    );

    expect(resolved).toBe(path.resolve(sessionsDir, "sess-1.jsonl"));
  });

  it("prefers storePath when resolving session file options", () => {
    const opts = resolveSessionFilePathOptions({
      storePath: "/tmp/custom/agent-store/sessions.json",
      agentId: "ops",
    });
    expect(opts).toEqual({
      sessionsDir: path.resolve("/tmp/custom/agent-store"),
    });
  });

  it("falls back to agentId when storePath is absent", () => {
    const opts = resolveSessionFilePathOptions({ agentId: "ops" });
    expect(opts).toEqual({ agentId: "ops" });
  });

  it("uses sessionsDir override for session files", () => {
    const resolved = resolveSessionFilePath("sess-1", undefined, {
      sessionsDir: "/tmp/custom/sessions",
    });
    expect(resolved).toBe(path.resolve("/tmp/custom/sessions/sess-1.jsonl"));
  });

  it("still resolves transcript paths under agent directories", () => {
    const resolved = resolveSessionTranscriptPath("sess-1", "main");
    expect(resolved.endsWith(path.join("agents", "main", "sessions", "sess-1.jsonl"))).toBe(true);
  });
});
