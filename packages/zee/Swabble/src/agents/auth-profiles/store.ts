import fs from "node:fs";

import lockfile from "proper-lockfile";

import { resolveZeeAgentDir } from "../agent-paths.js";
import { resolveOAuthPath } from "../../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import { syncZeeAuthCredentials } from "./zee-auth-sync.js";
import { AUTH_STORE_LOCK_OPTIONS, AUTH_STORE_VERSION } from "./constants.js";
import { syncExternalCliCredentials } from "./external-cli-sync.js";
import {
  ensureAuthStoreFile,
  resolveAuthStorePath,
  resolveLegacyAuthStorePath,
} from "./paths.js";
import type { AuthProfileCredential, AuthProfileStore } from "./types.js";

type LegacyAuthJson = Record<string, unknown>;

type LegacyOAuthJson = Record<
  string,
  {
    access?: unknown;
    refresh?: unknown;
    expires?: unknown;
    accountId?: unknown;
    email?: unknown;
    enterpriseUrl?: unknown;
    projectId?: unknown;
    clientId?: unknown;
  }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function coerceNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function coerceCredential(value: unknown, fallbackProvider: string): AuthProfileCredential | null {
  if (!isRecord(value)) return null;
  const type = coerceString(value.type);
  const provider = coerceString(value.provider).trim() || fallbackProvider;
  if (!provider.trim()) return null;

  if (type === "api_key") {
    const key = coerceString(value.key).trim();
    if (!key) return null;
    const email = coerceString(value.email).trim() || undefined;
    return { type: "api_key", provider, key, ...(email ? { email } : {}) };
  }

  if (type === "token") {
    const token = coerceString(value.token).trim();
    if (!token) return null;
    const expires = coerceNumber(value.expires);
    const email = coerceString(value.email).trim() || undefined;
    return {
      type: "token",
      provider,
      token,
      ...(expires > 0 ? { expires } : {}),
      ...(email ? { email } : {}),
    };
  }

  if (type === "oauth") {
    const access = coerceString(value.access).trim();
    const refresh = coerceString(value.refresh).trim();
    const expires = coerceNumber(value.expires);
    if (!access || !refresh || expires <= 0) return null;
    const accountId = coerceString(value.accountId).trim() || undefined;
    const email = coerceString(value.email).trim() || undefined;
    const enterpriseUrl = coerceString(value.enterpriseUrl).trim() || undefined;
    const projectId = coerceString(value.projectId).trim() || undefined;
    const clientId = coerceString(value.clientId).trim() || undefined;
    return {
      type: "oauth",
      provider,
      access,
      refresh,
      expires,
      ...(accountId ? { accountId } : {}),
      ...(email ? { email } : {}),
      ...(enterpriseUrl ? { enterpriseUrl } : {}),
      ...(projectId ? { projectId } : {}),
      ...(clientId ? { clientId } : {}),
    };
  }

  return null;
}

function coerceOrder(value: unknown): AuthProfileStore["order"] | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [provider, raw] of Object.entries(value)) {
    if (!provider.trim()) continue;
    if (!Array.isArray(raw)) continue;
    const items = raw.map((entry) => String(entry).trim()).filter(Boolean);
    if (items.length === 0) continue;
    out[provider] = items;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function coerceStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const v = coerceString(raw).trim();
    if (!key.trim() || !v) continue;
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function coerceUsageStats(value: unknown): AuthProfileStore["usageStats"] | undefined {
  if (!isRecord(value)) return undefined;
  return value as AuthProfileStore["usageStats"];
}

function coerceAuthProfileStore(raw: unknown): AuthProfileStore {
  if (!isRecord(raw)) {
    return {
      version: AUTH_STORE_VERSION,
      profiles: {},
      order: undefined,
      lastGood: undefined,
      usageStats: undefined,
    };
  }

  const profilesRaw = raw.profiles;
  const profiles: Record<string, AuthProfileCredential> = {};
  if (isRecord(profilesRaw)) {
    for (const [profileId, credRaw] of Object.entries(profilesRaw)) {
      const id = profileId.trim();
      if (!id) continue;
      const providerHint = id.includes(":") ? id.split(":")[0] : id;
      const cred = coerceCredential(credRaw, providerHint);
      if (!cred) continue;
      profiles[id] = cred;
    }
  }

  const versionRaw = raw.version;
  const version =
    typeof versionRaw === "number" && Number.isFinite(versionRaw) && versionRaw > 0
      ? versionRaw
      : AUTH_STORE_VERSION;

  return {
    version,
    profiles,
    order: coerceOrder(raw.order),
    lastGood: coerceStringMap(raw.lastGood),
    usageStats: coerceUsageStats(raw.usageStats),
  };
}

function migrateLegacyAuthJson(agentDir?: string): AuthProfileStore | null {
  const legacyPath = resolveLegacyAuthStorePath(agentDir);
  if (!fs.existsSync(legacyPath)) return null;
  const raw = loadJsonFile(legacyPath) as LegacyAuthJson | undefined;
  if (!isRecord(raw)) return null;

  const store: AuthProfileStore = {
    version: AUTH_STORE_VERSION,
    profiles: {},
    order: undefined,
    lastGood: undefined,
    usageStats: undefined,
  };

  for (const [providerIdRaw, credRaw] of Object.entries(raw)) {
    const providerId = providerIdRaw.trim();
    if (!providerId) continue;
    const cred = coerceCredential(credRaw, providerId);
    if (!cred) continue;
    store.profiles[`${providerId}:default`] = cred;
  }

  // If we found any usable credentials, migrate and delete legacy file.
  if (Object.keys(store.profiles).length === 0) return null;

  const authPath = resolveAuthStorePath(agentDir);
  saveAuthProfileStore(store, agentDir);
  try {
    fs.unlinkSync(legacyPath);
  } catch {
    // ignore unlink errors; best-effort migration
  }
  return store;
}

function importLegacyOAuthJson(store: AuthProfileStore): boolean {
  const oauthPath = resolveOAuthPath();
  const raw = loadJsonFile(oauthPath) as LegacyOAuthJson | undefined;
  if (!isRecord(raw)) return false;

  let mutated = false;
  for (const [providerIdRaw, entryRaw] of Object.entries(raw)) {
    const providerId = providerIdRaw.trim();
    if (!providerId || !isRecord(entryRaw)) continue;

    const profileId = `${providerId}:default`;
    if (store.profiles[profileId]) continue;

    const access = coerceString(entryRaw.access).trim();
    const refresh = coerceString(entryRaw.refresh).trim();
    const expires = coerceNumber(entryRaw.expires);
    if (!access || !refresh || expires <= 0) continue;

    const accountId = coerceString(entryRaw.accountId).trim() || undefined;
    const email = coerceString(entryRaw.email).trim() || undefined;
    const enterpriseUrl = coerceString(entryRaw.enterpriseUrl).trim() || undefined;
    const projectId = coerceString(entryRaw.projectId).trim() || undefined;
    const clientId = coerceString(entryRaw.clientId).trim() || undefined;

    store.profiles[profileId] = {
      type: "oauth",
      provider: providerId,
      access,
      refresh,
      expires,
      ...(accountId ? { accountId } : {}),
      ...(email ? { email } : {}),
      ...(enterpriseUrl ? { enterpriseUrl } : {}),
      ...(projectId ? { projectId } : {}),
      ...(clientId ? { clientId } : {}),
    };
    mutated = true;
  }

  return mutated;
}

function mergeMainProfilesIntoAgentStore(store: AuthProfileStore, agentDir?: string): boolean {
  if (!agentDir?.trim()) return false;
  const mainDir = resolveZeeAgentDir();
  // Treat "main agent dir" as the one resolved from env + defaults.
  if (resolveAuthStorePath(agentDir) === resolveAuthStorePath(mainDir)) return false;

  const mainStore = ensureAuthProfileStore(undefined);
  let mutated = false;
  for (const [profileId, cred] of Object.entries(mainStore.profiles ?? {})) {
    if (store.profiles[profileId]) continue;
    store.profiles[profileId] = cred;
    mutated = true;
  }
  return mutated;
}

export async function updateAuthProfileStoreWithLock(params: {
  agentDir?: string;
  updater: (store: AuthProfileStore) => boolean;
}): Promise<AuthProfileStore | null> {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(authPath, AUTH_STORE_LOCK_OPTIONS);
    const store = ensureAuthProfileStore(params.agentDir);
    const shouldSave = params.updater(store);
    if (shouldSave) {
      saveAuthProfileStore(store, params.agentDir);
    }
    return store;
  } catch {
    return null;
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // ignore unlock errors
      }
    }
  }
}

export function loadAuthProfileStore(): AuthProfileStore {
  return ensureAuthProfileStore(undefined);
}

export function ensureAuthProfileStore(
  agentDir?: string,
  _options?: { allowKeychainPrompt?: boolean },
): AuthProfileStore {
  const authPath = resolveAuthStorePath(agentDir);

  // Migration: legacy auth.json -> auth-profiles.json
  const migrated = migrateLegacyAuthJson(agentDir);
  if (migrated) {
    return migrated;
  }

  ensureAuthStoreFile(authPath);
  const store = coerceAuthProfileStore(loadJsonFile(authPath));

  let mutated = false;
  mutated = importLegacyOAuthJson(store) || mutated;
  mutated = mergeMainProfilesIntoAgentStore(store, agentDir) || mutated;
  mutated = syncExternalCliCredentials(store) || mutated;
  mutated = syncZeeAuthCredentials(store) || mutated;

  if (mutated) {
    saveAuthProfileStore(store, agentDir);
  }

  return store;
}

export function saveAuthProfileStore(store: AuthProfileStore, agentDir?: string): void {
  const authPath = resolveAuthStorePath(agentDir);
  ensureAuthStoreFile(authPath);
  saveJsonFile(authPath, store);
}
