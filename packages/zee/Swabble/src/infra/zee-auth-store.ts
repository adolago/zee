import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type ZeeAuthEntry = {
  type?: string;
  key?: string;
};

type ZeeAuthStore = Record<string, ZeeAuthEntry>;

const CACHE_TTL_MS = 30_000;

let cachedAt = 0;
let cachedStore: ZeeAuthStore | null = null;

function resolveZeeAuthPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  const xdgStateHome = env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), ".local", "state");
  return [path.join(xdgDataHome, "zee", "auth.json"), path.join(xdgStateHome, "zee", "auth.json")];
}

function readZeeAuthStoreCached(env: NodeJS.ProcessEnv = process.env): ZeeAuthStore | null {
  const now = Date.now();
  if (cachedStore && now - cachedAt < CACHE_TTL_MS) return cachedStore;

  for (const candidate of resolveZeeAuthPaths(env)) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as ZeeAuthStore;
      cachedStore = parsed;
      cachedAt = now;
      return parsed;
    } catch {}
  }

  cachedStore = null;
  cachedAt = now;
  return null;
}

/**
 * Return the provider API key from Zee's global auth store ONLY.
 * This intentionally ignores environment variables and per-agent auth profiles.
 */
export function getZeeAuthApiKeySync(providerId: string): string | undefined {
  const store = readZeeAuthStoreCached();
  const entry = store?.[providerId];
  const key = typeof entry?.key === "string" ? entry.key.trim() : "";
  if (entry?.type === "api" && key) return key;
  return undefined;
}

