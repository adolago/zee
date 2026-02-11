import { describe, expect, it } from "vitest";

import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { limitHistoryBytes, limitHistoryTurns } from "./history.js";

function makeMessage(role: "user" | "assistant", text: string): AgentMessage {
  return { role, content: [{ type: "text", text }] } as AgentMessage;
}

describe("limitHistoryTurns", () => {
  it("returns all messages when under limit", () => {
    const msgs = [makeMessage("user", "a"), makeMessage("assistant", "b")];
    expect(limitHistoryTurns(msgs, 5)).toEqual(msgs);
  });

  it("returns all messages when limit is undefined", () => {
    const msgs = [makeMessage("user", "a"), makeMessage("assistant", "b")];
    expect(limitHistoryTurns(msgs, undefined)).toEqual(msgs);
  });

  it("keeps only the last N user turns", () => {
    const msgs = [
      makeMessage("user", "1"),
      makeMessage("assistant", "r1"),
      makeMessage("user", "2"),
      makeMessage("assistant", "r2"),
      makeMessage("user", "3"),
      makeMessage("assistant", "r3"),
    ];
    const result = limitHistoryTurns(msgs, 2);
    expect(result).toHaveLength(4);
    expect((result[0].content as Array<{ text: string }>)[0].text).toBe("2");
  });
});

describe("limitHistoryBytes", () => {
  it("returns all messages when under default limit", () => {
    const msgs = [makeMessage("user", "hello"), makeMessage("assistant", "world")];
    expect(limitHistoryBytes(msgs, undefined)).toEqual(msgs);
  });

  it("drops oldest messages when over byte limit", () => {
    const big = "x".repeat(1000);
    const msgs = [
      makeMessage("user", big),
      makeMessage("assistant", big),
      makeMessage("user", "recent"),
    ];
    // Set a limit that fits the last 2 messages but not all 3
    const twoMsgSize =
      Buffer.byteLength(JSON.stringify(msgs[1]), "utf8") +
      Buffer.byteLength(JSON.stringify(msgs[2]), "utf8");
    const result = limitHistoryBytes(msgs, twoMsgSize + 10);
    expect(result).toHaveLength(2);
    expect((result[1].content as Array<{ text: string }>)[0].text).toBe("recent");
  });

  it("always keeps at least one message", () => {
    const big = "x".repeat(10000);
    const msgs = [makeMessage("user", big)];
    const result = limitHistoryBytes(msgs, 10);
    expect(result).toHaveLength(1);
  });

  it("returns unchanged array when within limit", () => {
    const msgs = [makeMessage("user", "a"), makeMessage("assistant", "b")];
    const result = limitHistoryBytes(msgs, 10 * 1024 * 1024);
    expect(result).toBe(msgs);
  });

  it("handles empty array", () => {
    expect(limitHistoryBytes([], 100)).toEqual([]);
  });

  it("respects explicit maxBytes=0 by returning all messages", () => {
    const msgs = [makeMessage("user", "a")];
    // limit <= 0 returns messages unchanged
    expect(limitHistoryBytes(msgs, 0)).toEqual(msgs);
  });
});
