import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { consumeSessionHandoff, recordSessionHandoff } from "./handoff.js";

describe("session handoff", () => {
  it("records and consumes a WhatsApp handoff once", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zee-handoff-"));
    const original = process.env.ZEE_STATE_DIR;
    process.env.ZEE_STATE_DIR = root;
    try {
      await recordSessionHandoff({
        channel: "whatsapp",
        target: "+15550001111",
        sessionKey: "agent:main:main",
      });
      const first = await consumeSessionHandoff({
        channel: "whatsapp",
        peerId: "+15550001111",
      });
      expect(first).toBe("agent:main:main");
      const second = await consumeSessionHandoff({
        channel: "whatsapp",
        peerId: "+15550001111",
      });
      expect(second).toBeNull();
    } finally {
      process.env.ZEE_STATE_DIR = original;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("ignores non-WhatsApp channels", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zee-handoff-"));
    const original = process.env.ZEE_STATE_DIR;
    process.env.ZEE_STATE_DIR = root;
    try {
      await recordSessionHandoff({
        channel: "email",
        target: "123456789",
        sessionKey: "agent:main:main",
      });
      const result = await consumeSessionHandoff({
        channel: "email",
        peerId: "123456789",
      });
      expect(result).toBeNull();
    } finally {
      process.env.ZEE_STATE_DIR = original;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("ignores WhatsApp group targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zee-handoff-"));
    const original = process.env.ZEE_STATE_DIR;
    process.env.ZEE_STATE_DIR = root;
    try {
      await recordSessionHandoff({
        channel: "whatsapp",
        target: "120363406150318674@g.us",
        sessionKey: "agent:main:main",
      });
      const result = await consumeSessionHandoff({
        channel: "whatsapp",
        peerId: "120363406150318674@g.us",
      });
      expect(result).toBeNull();
    } finally {
      process.env.ZEE_STATE_DIR = original;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
