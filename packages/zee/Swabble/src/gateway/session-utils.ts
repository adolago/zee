import { loadSessionStore, type SessionStoreRecord } from "../config/sessions.js";

type SessionConfig = {
  session?: {
    mainKey?: string;
  };
  agents?: {
    list?: Array<{ id?: string; default?: boolean }>;
  };
};

function normalize(value: string | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed.toLowerCase() : "";
}

function resolveDefaultAgentId(cfg: SessionConfig): string {
  const list = cfg.agents?.list ?? [];
  const explicitDefault = list.find((agent) => agent.default && normalize(agent.id).length > 0);
  if (explicitDefault?.id) return normalize(explicitDefault.id);

  const first = list.find((agent) => normalize(agent.id).length > 0);
  if (first?.id) return normalize(first.id);

  return "main";
}

function splitAgentSessionKey(key: string): { agentId: string; sessionPart: string } | undefined {
  const match = key.match(/^agent:([^:]+):(.+)$/i);
  if (!match) return undefined;
  return {
    agentId: normalize(match[1]),
    sessionPart: match[2] ?? "",
  };
}

function canonicalSessionPart(sessionPart: string, mainKey: string): string {
  const normalized = normalize(sessionPart);
  if (!normalized || normalized === "main" || normalized === mainKey) return mainKey;
  return normalized;
}

export function resolveSessionStoreKey(params: {
  cfg: SessionConfig;
  sessionKey?: string;
  agentId?: string;
}): string {
  const mainKey = normalize(params.cfg.session?.mainKey) || "main";
  const requested = normalize(params.sessionKey);
  const defaultAgent = normalize(params.agentId) || resolveDefaultAgentId(params.cfg);
  const parsed = requested ? splitAgentSessionKey(requested) : undefined;
  const agentId = parsed?.agentId || defaultAgent;
  const sessionPart = canonicalSessionPart(parsed?.sessionPart ?? requested, mainKey);
  return `agent:${agentId}:${sessionPart}`;
}

export function findStoreKeysIgnoreCase(store: SessionStoreRecord, targetKey: string): string[] {
  const target = normalize(targetKey);
  if (!target) return [];

  const found: string[] = [];
  for (const key of Object.keys(store)) {
    if (normalize(key) === target) {
      found.push(key);
    }
  }
  return found;
}

export function pruneLegacyStoreKeys(params: {
  store: SessionStoreRecord;
  canonicalKey: string;
  candidates: string[];
}): void {
  for (const key of params.candidates) {
    if (key === params.canonicalKey) continue;
    delete params.store[key];
  }
}

export function resolveGatewaySessionStoreTarget(params: {
  cfg: SessionConfig;
  key: string;
  store?: SessionStoreRecord;
}): {
  canonicalKey: string;
  storeKeys: string[];
} {
  const canonicalKey = resolveSessionStoreKey({
    cfg: params.cfg,
    sessionKey: params.key,
  });
  const store = params.store ?? loadSessionStore();
  const candidates = findStoreKeysIgnoreCase(store, canonicalKey);
  const uniqueStoreKeys = [canonicalKey, ...candidates.filter((key) => key !== canonicalKey)];

  return {
    canonicalKey,
    storeKeys: uniqueStoreKeys,
  };
}
