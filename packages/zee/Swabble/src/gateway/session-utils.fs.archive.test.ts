import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  archiveSessionTranscripts,
  resolveSessionTranscriptCandidates,
} from "./session-utils.fs.js";

describe("session transcript archival helpers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function mkdtemp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it("resolves candidate paths from storePath and explicit sessionFile", () => {
    const root = mkdtemp("zee-swabble-session-utils-");
    const storePath = path.join(root, "sessions.json");
    const sessionFile = path.join(root, "custom", "session-a.jsonl");

    const candidates = resolveSessionTranscriptCandidates("session-a", storePath, sessionFile, "OPS");
    expect(candidates).toEqual(
      expect.arrayContaining([
        path.resolve(sessionFile),
        path.resolve(path.join(root, "session-a.jsonl")),
      ]),
    );
  });

  it("archives transcript files during reset rotation", () => {
    const root = mkdtemp("zee-swabble-session-utils-reset-");
    const sessionId = "session-reset-1";
    const storePath = path.join(root, "sessions.json");
    const transcriptPath = path.join(root, `${sessionId}.jsonl`);
    fs.writeFileSync(transcriptPath, '{"message":{"role":"user","content":"hello"}}\n', "utf-8");

    const archived = archiveSessionTranscripts({
      sessionId,
      storePath,
      reason: "reset",
    });

    expect(archived).toHaveLength(1);
    expect(archived[0]!.startsWith(`${transcriptPath}.reset.`)).toBe(true);
    expect(fs.existsSync(transcriptPath)).toBe(false);
    expect(fs.existsSync(archived[0]!)).toBe(true);
  });

  it("is best-effort when transcript files are missing", () => {
    const root = mkdtemp("zee-swabble-session-utils-missing-");
    const archived = archiveSessionTranscripts({
      sessionId: "session-missing-1",
      storePath: path.join(root, "sessions.json"),
      reason: "reset",
    });

    expect(archived).toEqual([]);
  });
});
