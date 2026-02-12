import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultVoiceWakeTriggers,
  loadVoiceWakeConfig,
  resolveEffectiveVoiceWakeTriggers,
  setVoiceWakeEnabled,
  setVoiceWakeTriggers,
} from "./voicewake.js";

describe("voicewake store", () => {
  it("returns defaults when missing", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-voicewake-"));
    const cfg = await loadVoiceWakeConfig(baseDir);
    expect(cfg.enabled).toBe(true);
    expect(cfg.triggers).toEqual(defaultVoiceWakeTriggers());
    expect(resolveEffectiveVoiceWakeTriggers(cfg)).toEqual(defaultVoiceWakeTriggers());
    expect(cfg.updatedAtMs).toBe(0);
  });

  it("sanitizes and persists triggers", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-voicewake-"));
    const saved = await setVoiceWakeTriggers(["  hi  ", "", "  there "], baseDir);
    expect(saved.enabled).toBe(true);
    expect(saved.triggers).toEqual(["hi", "there"]);
    expect(saved.updatedAtMs).toBeGreaterThan(0);

    const loaded = await loadVoiceWakeConfig(baseDir);
    expect(loaded.enabled).toBe(true);
    expect(loaded.triggers).toEqual(["hi", "there"]);
    expect(loaded.updatedAtMs).toBeGreaterThan(0);
  });

  it("falls back to defaults when triggers empty", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-voicewake-"));
    const saved = await setVoiceWakeTriggers(["", "   "], baseDir);
    expect(saved.triggers).toEqual(defaultVoiceWakeTriggers());
  });

  it("preserves configured triggers when disabling voice wake", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-voicewake-"));
    await setVoiceWakeTriggers(["zee", "assistant"], baseDir);
    const disabled = await setVoiceWakeEnabled(false, baseDir);
    expect(disabled.enabled).toBe(false);
    expect(disabled.triggers).toEqual(["zee", "assistant"]);
    expect(resolveEffectiveVoiceWakeTriggers(disabled)).toEqual([]);

    const enabled = await setVoiceWakeEnabled(true, baseDir);
    expect(enabled.enabled).toBe(true);
    expect(resolveEffectiveVoiceWakeTriggers(enabled)).toEqual(["zee", "assistant"]);
  });
});
