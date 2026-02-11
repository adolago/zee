import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveDefaultConfigCandidates,
  resolveConfigPath,
  resolveConfigPathCandidate,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers ZEE_OAUTH_DIR over ZEE_STATE_DIR", () => {
    const env = {
      ZEE_OAUTH_DIR: "/custom/oauth",
      ZEE_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from ZEE_STATE_DIR when unset", () => {
    const env = {
      ZEE_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses ZEE_STATE_DIR when set", () => {
    const env = {
      ZEE_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("returns the default config candidate when no overrides exist", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    expect(candidates).toEqual([path.join(home, ".zee", "zee.json")]);
  });

  it("orders config candidates as state override then default", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates(
      { ZEE_STATE_DIR: "/override" } as NodeJS.ProcessEnv,
      () => home,
    );
    expect(candidates).toEqual([path.join("/override", "zee.json"), path.join(home, ".zee", "zee.json")]);
  });

  it("prefers ~/.zee when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zee-state-"));
    try {
      const newDir = path.join(root, ".zee");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prefers an existing config candidate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zee-config-"));
    try {
      const dir = path.join(root, ".zee");
      await fs.mkdir(dir, { recursive: true });
      const configPath = path.join(dir, "zee.json");
      await fs.writeFile(configPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(configPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses overridden state dir when config path is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zee-config-override-"));
    try {
      const overrideDir = path.join(root, "override");
      const env = { ZEE_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "zee.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
