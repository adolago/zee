import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { log } from "./constants.js";
import type { AuthProfileCredential, AuthProfileStore, OAuthCredential } from "./types.js";

/**
 * Path to Zee's auth.json file.
 * Zee stores auth at ~/.local/share/zee/auth.json
 */
const ZEE_AUTH_PATH = path.join(os.homedir(), ".local", "share", "zee", "auth.json");
const LEGACY_AGENT_CORE_AUTH_PATH = path.join(
  os.homedir(),
  ".local",
  "share",
  "agent-core",
  "auth.json",
);

/**
 * Minimum time before expiry to consider a credential "fresh" (10 minutes).
 */
const NEAR_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Cache TTL for auth reads (30 seconds).
 */
const SYNC_TTL_MS = 30_000;

let lastSyncAt = 0;
let cachedAuth: AgentCoreAuth | null = null;

/**
 * Zee auth.json format.
 * Each key is a provider ID (e.g., "kimi-for-coding", "anthropic").
 */
type AgentCoreAuthEntry = {
  type: "oauth" | "api" | "wellknown";
  // OAuth fields
  access?: string;
  refresh?: string;
  expires?: number;
  // API key fields
  key?: string;
  // WellKnown fields
  token?: string;
  // Common optional fields
  email?: string;
  accountId?: string;
  enterpriseUrl?: string;
  projectId?: string;
};

type AgentCoreAuth = Record<string, AgentCoreAuthEntry>;

/**
 * Read Zee auth.json with caching (fallbacks to legacy agent-core path).
 */
function readZeeAuthCached(): AgentCoreAuth | null {
  const now = Date.now();
  if (cachedAuth && now - lastSyncAt < SYNC_TTL_MS) {
    return cachedAuth;
  }

  try {
    const authPath = fs.existsSync(ZEE_AUTH_PATH)
      ? ZEE_AUTH_PATH
      : fs.existsSync(LEGACY_AGENT_CORE_AUTH_PATH)
        ? LEGACY_AGENT_CORE_AUTH_PATH
        : null;

    if (!authPath) {
      return null;
    }
    const raw = fs.readFileSync(authPath, "utf-8");
    const parsed = JSON.parse(raw) as AgentCoreAuth;
    cachedAuth = parsed;
    lastSyncAt = now;
    return parsed;
  } catch (err) {
    log.debug("failed to read zee auth.json", { error: String(err) });
    return null;
  }
}

/**
 * Convert agent-core auth entry to zee AuthProfileCredential.
 */
function convertToZeeCredential(
  providerId: string,
  entry: AgentCoreAuthEntry,
): AuthProfileCredential | null {
  if (entry.type === "oauth") {
    if (!entry.access) return null;
    return {
      type: "oauth",
      provider: providerId,
      access: entry.access,
      refresh: entry.refresh,
      expires: entry.expires ?? Date.now() + 3600_000, // default 1h if not set
      email: entry.email,
      accountId: entry.accountId,
      enterpriseUrl: entry.enterpriseUrl,
      projectId: entry.projectId,
    } as OAuthCredential;
  }

  if (entry.type === "api") {
    if (!entry.key) return null;
    return {
      type: "api_key",
      provider: providerId,
      key: entry.key,
      email: entry.email,
    };
  }

  if (entry.type === "wellknown") {
    if (!entry.token) return null;
    return {
      type: "token",
      provider: providerId,
      token: entry.token,
      email: entry.email,
    };
  }

  return null;
}

/**
 * Check if credential is fresh (not near expiry).
 */
function isCredentialFresh(cred: AuthProfileCredential | undefined, now: number): boolean {
  if (!cred) return false;
  if (cred.type === "api_key") return true; // API keys don't expire
  if (cred.type === "token") {
    if (typeof cred.expires !== "number") return true;
    return cred.expires > now + NEAR_EXPIRY_MS;
  }
  if (cred.type === "oauth") {
    if (typeof cred.expires !== "number") return true;
    return cred.expires > now + NEAR_EXPIRY_MS;
  }
  return false;
}

/**
 * Shallow compare OAuth credentials.
 */
function shallowEqualCredentials(
  a: AuthProfileCredential | undefined,
  b: AuthProfileCredential,
): boolean {
  if (!a) return false;
  if (a.type !== b.type) return false;

  if (a.type === "oauth" && b.type === "oauth") {
    return (
      a.provider === b.provider &&
      a.access === b.access &&
      a.refresh === b.refresh &&
      a.expires === b.expires
    );
  }

  if (a.type === "api_key" && b.type === "api_key") {
    return a.provider === b.provider && a.key === b.key;
  }

  if (a.type === "token" && b.type === "token") {
    return a.provider === b.provider && a.token === b.token;
  }

  return false;
}

/**
 * Generate a profile ID for Zee auth-synced credentials.
 * Format: zee:<provider-id>
 */
function makeZeeProfileId(providerId: string): string {
  return `zee:${providerId}`;
}

/**
 * Sync OAuth/token credentials from Zee's auth.json into the auth-profiles store.
 *
 * This allows the Zee gateway to use credentials authenticated via Zee CLI
 * (e.g., `zee auth login --provider kimi-for-coding`).
 *
 * Returns true if any credentials were updated.
 */
export function syncZeeAuthCredentials(store: AuthProfileStore): boolean {
  const disabled = (
    process.env.ZEE_DISABLE_ZEE_AUTH_SYNC ||
    process.env.ZEE_DISABLE_AGENT_CORE_SYNC
  )
    ?.trim()
    .toLowerCase();
  if (disabled === "1" || disabled === "true" || disabled === "yes") {
    return false;
  }
  const zeeAuth = readZeeAuthCached();
  if (!zeeAuth) {
    return false;
  }

  let mutated = false;
  const now = Date.now();

  for (const [providerId, entry] of Object.entries(zeeAuth)) {
    const profileId = makeZeeProfileId(providerId);
    const existing = store.profiles[profileId];

    // Skip if existing credential is fresh
    if (isCredentialFresh(existing, now)) {
      continue;
    }

    const newCred = convertToZeeCredential(providerId, entry);
    if (!newCred) {
      continue;
    }

    // Skip if credentials are the same
    if (shallowEqualCredentials(existing, newCred)) {
      continue;
    }

    // Check if new credential is better (fresher expiry)
    const shouldUpdate =
      !existing ||
      (newCred.type === "oauth" &&
        existing.type === "oauth" &&
        (newCred.expires ?? 0) > (existing.expires ?? 0)) ||
      (newCred.type === "token" &&
        existing.type === "token" &&
        (newCred.expires ?? Infinity) > (existing.expires ?? 0)) ||
      newCred.type === "api_key";

    if (shouldUpdate) {
      store.profiles[profileId] = newCred;
      mutated = true;
      log.info("synced credentials from zee auth store", {
        profileId,
        provider: providerId,
        type: newCred.type,
        expires:
          "expires" in newCred && newCred.expires
            ? new Date(newCred.expires).toISOString()
            : undefined,
      });
    }
  }

  return mutated;
}
