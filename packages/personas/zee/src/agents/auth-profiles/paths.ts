import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { saveJsonFile } from "../../infra/json-file.js";
import { resolveZeeAgentDir } from "../agent-paths.js";
import { resolveUserPath } from "../../utils.js";
import { AUTH_STORE_VERSION } from "./constants.js";
import type { AuthProfileStore } from "./types.js";

const APP_NAME = "agent-core";

function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_CORE_TEST_HOME || env.OPENCODE_TEST_HOME || os.homedir();
}

function resolveUserPathForAgentCore(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, getHomeDir(env));
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

function resolveStateDirOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = (env.AGENT_CORE_STATE_DIR || env.OPENCODE_STATE_DIR)?.trim();
  if (!override) return undefined;
  return resolveUserPathForAgentCore(override, env);
}

function resolveOpencodeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateOverride = resolveStateDirOverride(env);
  if (stateOverride) return path.join(stateOverride, "data");
  const xdgDataHome = env.XDG_DATA_HOME || path.join(getHomeDir(env), ".local", "share");
  return path.join(xdgDataHome, APP_NAME);
}

/**
 * OpenCode/agent-core credentials store (global).
 *
 * Zee should not keep its own auth-profiles.json secret store.
 */
export function resolveAuthStorePath(_agentDir?: string): string {
  return path.join(resolveOpencodeDataDir(), "auth.json");
}

/**
 * Zee-side auth metadata store (per agent).
 *
 * Contains only non-secret state (ordering, lastGood, cooldowns, usage stats).
 */
export function resolveAuthMetadataPath(agentDir?: string): string {
  const resolved = resolveUserPath(agentDir ?? resolveZeeAgentDir());
  return path.join(resolved, "auth-metadata.json");
}

export function resolveAuthStorePathForDisplay(agentDir?: string): string {
  const pathname = resolveAuthStorePath(agentDir);
  return pathname.startsWith("~") ? pathname : resolveUserPath(pathname);
}

export function ensureAuthStoreFile(pathname: string) {
  if (fs.existsSync(pathname)) return;
  // OpenCode auth.json is a plain object keyed by provider id.
  saveJsonFile(pathname, {});
}

export function ensureAuthMetadataFile(pathname: string) {
  if (fs.existsSync(pathname)) return;
  const payload: Pick<AuthProfileStore, "version" | "order" | "lastGood" | "usageStats"> = {
    version: AUTH_STORE_VERSION,
    order: undefined,
    lastGood: undefined,
    usageStats: undefined,
  };
  saveJsonFile(pathname, payload);
}
