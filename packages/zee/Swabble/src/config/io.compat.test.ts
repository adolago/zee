import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createConfigIO } from "./io.js";

async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "zee-config-"));
  try {
    await run(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function writeConfig(configPath: string, port: number): Promise<string> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ gateway: { port } }, null, 2));
  return configPath;
}

describe("config io path selection", () => {
  it("prefers ZEE_CONFIG_PATH when set", async () => {
    await withTempHome(async (home) => {
      const overridePath = await writeConfig(path.join(home, "custom", "zee.json"), 19001);

      const io = createConfigIO({
        env: { ZEE_CONFIG_PATH: overridePath } as NodeJS.ProcessEnv,
        homedir: () => home,
      });

      expect(io.configPath).toBe(overridePath);
      expect(io.loadConfig().gateway?.port).toBe(19001);
    });
  });

  it("prefers ZEE_STATE_DIR candidate when present", async () => {
    await withTempHome(async (home) => {
      const defaultConfigPath = await writeConfig(path.join(home, ".zee", "zee.json"), 18789);
      const overrideDir = path.join(home, "override");
      const overrideConfigPath = await writeConfig(path.join(overrideDir, "zee.json"), 20001);

      const io = createConfigIO({
        env: { ZEE_STATE_DIR: overrideDir } as NodeJS.ProcessEnv,
        homedir: () => home,
      });

      expect(io.configPath).not.toBe(defaultConfigPath);
      expect(io.configPath).toBe(overrideConfigPath);
      expect(io.loadConfig().gateway?.port).toBe(20001);
    });
  });

  it("falls back to default candidate when ZEE_STATE_DIR config is missing", async () => {
    await withTempHome(async (home) => {
      const defaultConfigPath = await writeConfig(path.join(home, ".zee", "zee.json"), 18789);
      const overrideDir = path.join(home, "override");

      const io = createConfigIO({
        env: { ZEE_STATE_DIR: overrideDir } as NodeJS.ProcessEnv,
        homedir: () => home,
      });

      expect(io.configPath).toBe(defaultConfigPath);
      expect(io.loadConfig().gateway?.port).toBe(18789);
    });
  });
});

