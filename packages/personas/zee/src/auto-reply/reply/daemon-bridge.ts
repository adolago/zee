import fs from "node:fs";
import path from "node:path";

import lockfile from "proper-lockfile";

import type { ZeeConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { logVerbose } from "../../globals.js";
import {
  resolveAgentIdFromSessionKey,
  toAgentRequestSessionKey,
  toAgentStoreSessionKey,
} from "../../routing/session-key.js";
import { resolveUserPath } from "../../utils.js";
import type { MsgContext } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";

type DaemonBridgeStoreEntry = {
  sessionId: string;
  agentId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type DaemonBridgeStore = {
  version: 1;
  sessions: Record<string, DaemonBridgeStoreEntry>;
};

type ResolvedDaemonBridgeConfig = {
  enabled: boolean;
  url: string;
  sessionStorePath: string;
  timeoutMs: number;
  createSession: boolean;
};

const DEFAULT_DAEMON_URL = "http://127.0.0.1:3210";
const DEFAULT_TIMEOUT_MS = 30_000;
const STORE_VERSION = 1;

const STORE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

function resolveDaemonBridgeConfig(cfg: ZeeConfig | undefined): ResolvedDaemonBridgeConfig {
  const bridge = cfg?.gateway?.daemonBridge;
  const enabled = Boolean(bridge?.enabled);
  const urlRaw = typeof bridge?.url === "string" ? bridge.url.trim() : "";
  const url = (urlRaw || DEFAULT_DAEMON_URL).replace(/\/+$/, "");
  const sessionStoreRaw = typeof bridge?.sessionStore === "string" ? bridge.sessionStore.trim() : "";
  const sessionStorePath = sessionStoreRaw
    ? resolveUserPath(sessionStoreRaw)
    : path.join(resolveStateDir(), "gateway", "daemon-sessions.json");
  const timeoutMs =
    typeof bridge?.timeoutMs === "number" && Number.isFinite(bridge.timeoutMs) && bridge.timeoutMs > 0
      ? Math.floor(bridge.timeoutMs)
      : DEFAULT_TIMEOUT_MS;
  const createSession = bridge?.createSession !== false;
  return {
    enabled,
    url,
    sessionStorePath,
    timeoutMs,
    createSession,
  };
}

export function isDaemonBridgeEnabled(cfg: ZeeConfig | undefined): boolean {
  // Auto-enable when running embedded (AGENT_CORE_URL is injected by embedded-gateway.ts)
  if (process.env.AGENT_CORE_URL?.trim()) return true;
  return resolveDaemonBridgeConfig(cfg).enabled;
}

function normalizeSessionKey(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeStore(filePath: string, store: DaemonBridgeStore): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, filePath);
}

async function ensureStoreFile(filePath: string): Promise<void> {
  try {
    await fs.promises.access(filePath);
  } catch {
    await writeStore(filePath, { version: STORE_VERSION, sessions: {} });
  }
}

async function loadStore(filePath: string): Promise<DaemonBridgeStore> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = safeParseJson<DaemonBridgeStore>(raw);
    if (parsed && parsed.version === STORE_VERSION && parsed.sessions) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return { version: STORE_VERSION, sessions: {} };
}

async function withStoreLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await ensureStoreFile(filePath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, STORE_LOCK_OPTIONS);
    return await fn();
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

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function createDaemonSession(
  bridge: ResolvedDaemonBridgeConfig,
  surface?: string,
): Promise<{ sessionId: string }> {
  const res = await fetchWithTimeout(
    `${bridge.url}/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(surface ? { surface } : {}),
    },
    bridge.timeoutMs,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `daemon bridge session create failed: ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
    );
  }
  const payload = safeParseJson<{ id?: string }>(await res.text());
  const sessionId = payload?.id?.trim();
  if (!sessionId) {
    throw new Error("daemon bridge session create failed: missing session id");
  }
  return { sessionId };
}

async function getOrCreateSessionId(params: {
  bridge: ResolvedDaemonBridgeConfig;
  sessionKey: string;
  agentId: string;
  surface?: string;
}): Promise<{ sessionId: string; created: boolean }> {
  const { bridge, sessionKey, agentId, surface } = params;
  const key = normalizeSessionKey(sessionKey);
  if (!key) {
    throw new Error("daemon bridge: missing session key");
  }

  return await withStoreLock(bridge.sessionStorePath, async () => {
    const store = await loadStore(bridge.sessionStorePath);
    const existing = store.sessions[key];
    if (existing?.sessionId) {
      store.sessions[key] = {
        ...existing,
        agentId,
        updatedAt: new Date().toISOString(),
      };
      await writeStore(bridge.sessionStorePath, store);
      return { sessionId: existing.sessionId, created: false };
    }

    if (!bridge.createSession) {
      throw new Error("daemon bridge: session missing and auto-create disabled");
    }

    const created = await createDaemonSession(bridge, surface);
    const now = new Date().toISOString();
    store.sessions[key] = {
      sessionId: created.sessionId,
      agentId,
      createdAt: now,
      updatedAt: now,
    };
    await writeStore(bridge.sessionStorePath, store);
    return { sessionId: created.sessionId, created: true };
  });
}

async function deleteSessionMapping(params: {
  bridge: ResolvedDaemonBridgeConfig;
  sessionKey: string;
}): Promise<void> {
  const key = normalizeSessionKey(params.sessionKey);
  if (!key) return;
  await withStoreLock(params.bridge.sessionStorePath, async () => {
    const store = await loadStore(params.bridge.sessionStorePath);
    if (store.sessions[key]) {
      delete store.sessions[key];
      await writeStore(params.bridge.sessionStorePath, store);
    }
  });
}

type DaemonMessageResponse = {
  error?: string;
  info?: {
    error?: { name?: string; message?: string };
  } | null;
  parts?: Array<{ type?: string; text?: string }>;
};

async function readDaemonResponse(res: Response): Promise<DaemonMessageResponse> {
  const raw = await res.text();
  const parsed = safeParseJson<DaemonMessageResponse>(raw);
  if (!parsed) {
    throw new Error("daemon bridge: invalid JSON response");
  }
  return parsed;
}

async function sendMessageToDaemon(params: {
  bridge: ResolvedDaemonBridgeConfig;
  sessionKey: string;
  agentId: string;
  text: string;
  surface?: string;
}): Promise<{ text: string; sessionId: string }> {
  const { bridge, sessionKey, agentId, text, surface } = params;
  let { sessionId } = await getOrCreateSessionId({ bridge, sessionKey, agentId, surface });

  const postMessage = async (targetSessionId: string): Promise<Response> => {
    return await fetchWithTimeout(
      `${bridge.url}/session/${targetSessionId}/message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parts: [
            {
              type: "text",
              text,
            },
          ],
          agent: agentId,
        }),
      },
      bridge.timeoutMs,
    );
  };

  let res = await postMessage(sessionId);
  if (res.status === 404) {
    await deleteSessionMapping({ bridge, sessionKey });
    if (!bridge.createSession) {
      throw new Error("daemon bridge: session missing and auto-create disabled");
    }
    const recreated = await getOrCreateSessionId({ bridge, sessionKey, agentId, surface });
    sessionId = recreated.sessionId;
    res = await postMessage(sessionId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `daemon bridge message failed: ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
    );
  }

  let payload = await readDaemonResponse(res);
  // The daemon streams responses with status 200 even on errors, so a
  // StorageNotFoundError (missing session) arrives inside the JSON payload
  // rather than as HTTP 404. Detect it here and trigger the same recovery
  // path. Only match storage/session errors -- not ProviderModelNotFoundError
  // or other "NotFound" variants which would recur after re-creating the
  // session.
  if (payload.error && /^StorageNotFoundError/i.test(String(payload.error))) {
    await deleteSessionMapping({ bridge, sessionKey });
    if (!bridge.createSession) {
      throw new Error("daemon bridge: session missing and auto-create disabled");
    }
    const recreated = await getOrCreateSessionId({ bridge, sessionKey, agentId, surface });
    sessionId = recreated.sessionId;
    res = await postMessage(sessionId);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `daemon bridge message failed (retry): ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
      );
    }
    payload = await readDaemonResponse(res);
  }
  if (payload.error) {
    throw new Error(`daemon bridge message error: ${payload.error}`);
  }
  const textParts = Array.isArray(payload.parts)
    ? payload.parts.filter((part) => part?.type === "text").map((part) => part?.text ?? "")
    : [];
  const combined = textParts.join("");
  const infoError = payload.info?.error?.message;
  if (!combined.trim() && infoError) {
    throw new Error(`daemon bridge message error: ${infoError}`);
  }
  return { text: combined, sessionId };
}

function resolveInboundText(ctx: MsgContext): string {
  if (typeof ctx.BodyForAgent === "string") return ctx.BodyForAgent;
  if (typeof ctx.BodyForCommands === "string") return ctx.BodyForCommands;
  if (typeof ctx.CommandBody === "string") return ctx.CommandBody;
  if (typeof ctx.RawBody === "string") return ctx.RawBody;
  if (typeof ctx.Body === "string") return ctx.Body;
  return "";
}

export async function getReplyFromDaemonBridge(
  ctx: MsgContext,
  opts?: GetReplyOptions,
  configOverride?: ZeeConfig,
): Promise<ReplyPayload | undefined> {
  const cfg = configOverride ?? loadConfig();
  const bridge = resolveDaemonBridgeConfig(cfg);
  if (!bridge.enabled) return undefined;
  if (opts?.isHeartbeat) return undefined;

  const inboundSessionKey = ctx.CommandTargetSessionKey?.trim() || ctx.SessionKey?.trim();
  if (!inboundSessionKey) {
    throw new Error("daemon bridge: missing session key");
  }
  const inputText = resolveInboundText(ctx);
  const surface = ctx.Surface?.trim().toLowerCase() || ctx.Provider?.trim().toLowerCase();
  const isExternalMessagingSurface = surface === "whatsapp" || surface === "matrix";

  // Hub mode: all external inboxes are Zee (WhatsApp + Matrix).
  // Keep the original session "rest" (channel/peer/thread) for continuity, but
  // force the agentId to zee so users only talk to Zee externally.
  const sessionKey = isExternalMessagingSurface
    ? toAgentStoreSessionKey({
        agentId: "zee",
        requestKey: toAgentRequestSessionKey(inboundSessionKey),
      })
    : inboundSessionKey;
  const agentId = isExternalMessagingSurface ? "zee" : resolveAgentIdFromSessionKey(sessionKey);

  void opts?.onReplyStart?.();

  try {
    const result = await sendMessageToDaemon({
      bridge,
      sessionKey,
      agentId,
      text: inputText,
      surface,
    });
    return { text: result.text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logVerbose(`daemon bridge request failed: ${message}`);
    return { text: `Error: ${message}` };
  }
}
