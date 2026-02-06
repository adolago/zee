import fs from "node:fs";
import path from "node:path";

import { saveJsonFile } from "../../infra/json-file.js";
import { resolveZeeAgentDir } from "../agent-paths.js";
import { resolveUserPath } from "../../utils.js";
import {
  AUTH_PROFILE_FILENAME,
  AUTH_STORE_VERSION,
  LEGACY_AUTH_FILENAME,
} from "./constants.js";
import type { AuthProfileStore } from "./types.js";

function resolveAgentDir(agentDir?: string): string {
  return resolveUserPath(agentDir ?? resolveZeeAgentDir());
}

/**
 * Zee's per-agent auth profile store (secrets + metadata).
 *
 * Default: `~/.zee/agents/<agentId>/agent/auth-profiles.json`
 */
export function resolveAuthStorePath(agentDir?: string): string {
  const resolved = resolveAgentDir(agentDir);
  return path.join(resolved, AUTH_PROFILE_FILENAME);
}

/**
 * Legacy per-agent auth store (pre auth-profiles.json).
 *
 * Default: `~/.zee/agents/<agentId>/agent/auth.json`
 */
export function resolveLegacyAuthStorePath(agentDir?: string): string {
  const resolved = resolveAgentDir(agentDir);
  return path.join(resolved, LEGACY_AUTH_FILENAME);
}

export function resolveAuthStorePathForDisplay(agentDir?: string): string {
  const pathname = resolveAuthStorePath(agentDir);
  return pathname.startsWith("~") ? pathname : resolveUserPath(pathname);
}

export function ensureAuthStoreFile(pathname: string) {
  if (fs.existsSync(pathname)) return;
  const payload: AuthProfileStore = {
    version: AUTH_STORE_VERSION,
    profiles: {},
    order: undefined,
    lastGood: undefined,
    usageStats: undefined,
  };
  saveJsonFile(pathname, payload);
}
