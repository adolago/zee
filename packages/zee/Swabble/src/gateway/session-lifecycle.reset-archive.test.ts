import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { rotateSessionOnTrigger } from "./session-lifecycle.js";

describe("session lifecycle rotation", () => {
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

  it("archives the previous transcript on /new rotation", () => {
    const root = mkdtemp("zee-swabble-session-new-");
    const storePath = path.join(root, "sessions.json");
    const oldSessionId = "session-old-new";
    const oldTranscript = path.join(root, `${oldSessionId}.jsonl`);
    fs.writeFileSync(oldTranscript, '{"message":{"role":"user","content":"old"}}\n', "utf-8");

    const { nextEntry, archived } = rotateSessionOnTrigger({
      trigger: "new",
      storePath,
      entry: {
        sessionId: oldSessionId,
        sessionFile: oldTranscript,
        thinkingLevel: "high",
        verboseLevel: "on",
      },
      now: 123,
      generateSessionId: () => "session-new-1",
    });

    expect(nextEntry.sessionId).toBe("session-new-1");
    expect(nextEntry.updatedAt).toBe(123);
    expect(nextEntry.thinkingLevel).toBe("high");
    expect(nextEntry.verboseLevel).toBe("on");
    expect(archived).toHaveLength(1);
    expect(archived[0]!.startsWith(`${oldTranscript}.reset.`)).toBe(true);
    expect(fs.existsSync(oldTranscript)).toBe(false);
  });

  it("archives the previous transcript on /reset rotation", () => {
    const root = mkdtemp("zee-swabble-session-reset-");
    const storePath = path.join(root, "sessions.json");
    const oldSessionId = "session-old-reset";
    const oldTranscript = path.join(root, `${oldSessionId}.jsonl`);
    fs.writeFileSync(oldTranscript, '{"message":{"role":"assistant","content":"old"}}\n', "utf-8");

    const { nextEntry, archived } = rotateSessionOnTrigger({
      trigger: "reset",
      storePath,
      entry: { sessionId: oldSessionId, sessionFile: oldTranscript },
      generateSessionId: () => "session-new-2",
    });

    expect(nextEntry.sessionId).toBe("session-new-2");
    expect(archived).toHaveLength(1);
    expect(archived[0]!.startsWith(`${oldTranscript}.reset.`)).toBe(true);
    expect(fs.existsSync(oldTranscript)).toBe(false);
  });

  it("does not archive when there is no previous session", () => {
    const { nextEntry, archived } = rotateSessionOnTrigger({
      trigger: "new",
      generateSessionId: () => "session-new-3",
    });

    expect(nextEntry.sessionId).toBe("session-new-3");
    expect(archived).toEqual([]);
  });
});
