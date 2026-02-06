import lockfile from "proper-lockfile";

import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import { AUTH_STORE_LOCK_OPTIONS, AUTH_STORE_VERSION } from "./constants.js";
import {
  ensureAuthMetadataFile,
  ensureAuthStoreFile,
  resolveAuthMetadataPath,
  resolveAuthStorePath,
} from "./paths.js";
import type { AuthProfileCredential, AuthProfileStore, ProfileUsageStats } from "./types.js";

type OpencodeAuthInfo =
  | {
      type: "api";
      key: string;
    }
  | ({
      type: "oauth";
      refresh: string;
      access: string;
      expires: number;
      accountId?: string;
    } & Record<string, unknown>)
  | {
      type: "wellknown";
      key: string;
      token: string;
    };

type OpencodeAuthJson = Record<string, OpencodeAuthInfo>;

type AuthMetaFile = {
  version: number;
  order?: AuthProfileStore["order"];
  lastGood?: AuthProfileStore["lastGood"];
  usageStats?: Record<string, ProfileUsageStats>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceOpencodeAuthJson(raw: unknown): OpencodeAuthJson {
  if (!isRecord(raw)) return {};

  const out: OpencodeAuthJson = {};
  for (const [providerId, value] of Object.entries(raw)) {
    if (!providerId.trim()) continue;
    if (!isRecord(value)) continue;
    const type = value.type;
    if (type === "api") {
      const key = typeof value.key === "string" ? value.key : "";
      if (!key.trim()) continue;
      out[providerId] = { type: "api", key };
      continue;
    }
    if (type === "oauth") {
      const refresh = typeof value.refresh === "string" ? value.refresh : "";
      const access = typeof value.access === "string" ? value.access : "";
      const expires = typeof value.expires === "number" ? value.expires : 0;
      if (!refresh.trim() || !access.trim() || !Number.isFinite(expires) || expires <= 0) continue;

      // Preserve known optional fields + passthrough fields that other components expect
      // (e.g. projectId for Google OAuth wrapper).
      const accountId = typeof value.accountId === "string" ? value.accountId : undefined;
      out[providerId] = {
        ...value,
        type: "oauth",
        refresh,
        access,
        expires,
        ...(accountId ? { accountId } : {}),
      };
      continue;
    }
    if (type === "wellknown") {
      const key = typeof value.key === "string" ? value.key : "";
      const token = typeof value.token === "string" ? value.token : "";
      if (!key.trim() || !token.trim()) continue;
      out[providerId] = { type: "wellknown", key, token };
    }
  }

  return out;
}

function readAuthMetaFile(agentDir?: string): AuthMetaFile {
  const pathname = resolveAuthMetadataPath(agentDir);
  ensureAuthMetadataFile(pathname);
  const raw = loadJsonFile(pathname);
  if (!isRecord(raw)) {
    return { version: AUTH_STORE_VERSION };
  }
  return {
    version:
      typeof raw.version === "number" && Number.isFinite(raw.version) && raw.version > 0
        ? raw.version
        : AUTH_STORE_VERSION,
    order: isRecord(raw.order) ? (raw.order as AuthProfileStore["order"]) : undefined,
    lastGood: isRecord(raw.lastGood) ? (raw.lastGood as AuthProfileStore["lastGood"]) : undefined,
    usageStats: isRecord(raw.usageStats) ? (raw.usageStats as Record<string, ProfileUsageStats>) : undefined,
  };
}

function writeAuthMetaFile(meta: AuthMetaFile, agentDir?: string): void {
  const pathname = resolveAuthMetadataPath(agentDir);
  ensureAuthMetadataFile(pathname);
  saveJsonFile(pathname, {
    version: AUTH_STORE_VERSION,
    order: meta.order ?? undefined,
    lastGood: meta.lastGood ?? undefined,
    usageStats: meta.usageStats ?? undefined,
  } satisfies AuthMetaFile);
}

function toAuthProfileStore(auth: OpencodeAuthJson, meta: AuthMetaFile): AuthProfileStore {
  const profiles: Record<string, AuthProfileCredential> = {};
  for (const [providerIdRaw, info] of Object.entries(auth)) {
    const providerId = providerIdRaw.trim();
    if (!providerId) continue;
    const profileId = `${providerId}:default`;
    if (info.type === "api") {
      profiles[profileId] = {
        type: "api_key",
        provider: providerId,
        key: info.key,
      };
      continue;
    }
    if (info.type === "wellknown") {
      profiles[profileId] = {
        type: "token",
        provider: providerId,
        token: info.token,
      };
      continue;
    }

    const oauth: Record<string, unknown> = info;
    const enterpriseUrl = typeof oauth.enterpriseUrl === "string" ? oauth.enterpriseUrl : undefined;
    const projectId = typeof oauth.projectId === "string" ? oauth.projectId : undefined;
    const email = typeof oauth.email === "string" ? oauth.email : undefined;
    const clientId = typeof oauth.clientId === "string" ? oauth.clientId : undefined;

    profiles[profileId] = {
      type: "oauth",
      provider: providerId,
      access: info.access,
      refresh: info.refresh,
      expires: info.expires,
      ...(enterpriseUrl ? { enterpriseUrl } : {}),
      ...(projectId ? { projectId } : {}),
      ...(info.accountId ? { accountId: info.accountId } : {}),
      ...(email ? { email } : {}),
      ...(clientId ? { clientId } : {}),
    };
  }

  return {
    version: AUTH_STORE_VERSION,
    profiles,
    order: meta.order,
    lastGood: meta.lastGood,
    usageStats: meta.usageStats,
  };
}

function toOpencodeAuthJson(store: AuthProfileStore): OpencodeAuthJson {
  const out: OpencodeAuthJson = {};

  for (const cred of Object.values(store.profiles ?? {})) {
    const provider = String(cred?.provider ?? "").trim();
    if (!provider) continue;

    if (cred.type === "api_key") {
      const key = cred.key?.trim();
      if (!key) continue;
      out[provider] = { type: "api", key };
      continue;
    }

    if (cred.type === "token") {
      const token = cred.token?.trim();
      if (!token) continue;
      // OpenCode auth.json doesn't have a dedicated "token" type. Treat tokens
      // as API-like strings (the provider decides how to use them).
      out[provider] = { type: "api", key: token };
      continue;
    }

    // oauth
    const refresh = cred.refresh?.trim();
    const access = cred.access?.trim();
    const expires = cred.expires;
    if (!refresh || !access || typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0) continue;

    out[provider] = {
      type: "oauth",
      refresh,
      access,
      expires,
      ...(cred.accountId ? { accountId: cred.accountId } : {}),
      ...(cred.enterpriseUrl ? { enterpriseUrl: cred.enterpriseUrl } : {}),
      ...(cred.projectId ? { projectId: cred.projectId } : {}),
      ...(cred.email ? { email: cred.email } : {}),
      ...(cred.clientId ? { clientId: cred.clientId } : {}),
    };
  }

  return out;
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
  const authPath = resolveAuthStorePath();
  ensureAuthStoreFile(authPath);
  const auth = coerceOpencodeAuthJson(loadJsonFile(authPath));
  const meta = readAuthMetaFile(undefined);
  return toAuthProfileStore(auth, meta);
}

export function ensureAuthProfileStore(
  agentDir?: string,
  _options?: { allowKeychainPrompt?: boolean },
): AuthProfileStore {
  const authPath = resolveAuthStorePath(agentDir);
  ensureAuthStoreFile(authPath);
  const auth = coerceOpencodeAuthJson(loadJsonFile(authPath));
  const meta = readAuthMetaFile(agentDir);
  return toAuthProfileStore(auth, meta);
}

export function saveAuthProfileStore(store: AuthProfileStore, agentDir?: string): void {
  const authPath = resolveAuthStorePath(agentDir);
  ensureAuthStoreFile(authPath);

  const nextAuth = toOpencodeAuthJson(store);
  saveJsonFile(authPath, nextAuth);

  writeAuthMetaFile(
    {
      version: AUTH_STORE_VERSION,
      order: store.order,
      lastGood: store.lastGood,
      usageStats: store.usageStats,
    },
    agentDir,
  );
}

