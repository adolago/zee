import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
} from "./paths.js";

describe("session path helpers", () => {
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
