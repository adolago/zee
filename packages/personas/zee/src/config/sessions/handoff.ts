import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSON5 from "json5";

import { normalizeAccountId } from "../../routing/session-key.js";
import { normalizeMessageChannel } from "../../utils/message-channel.js";
import { normalizeTargetForProvider } from "../../infra/outbound/target-normalization.js";
import { isWhatsAppGroupJid } from "../../whatsapp/normalize.js";
import { resolveStateDir } from "../paths.js";

export type SessionHandoffConsumeMode = "once" | "until-expire";

export type SessionHandoffEntry = {
  sessionKey: string;
  createdAt: number;
  expiresAt: number;
  consume: SessionHandoffConsumeMode;
};

type SessionHandoffStore = Record<string, SessionHandoffEntry>;

const DEFAULT_HANDOFF_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_HANDOFF_CONSUME: SessionHandoffConsumeMode = "once";

function resolveHandoffStorePath(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return path.join(resolveStateDir(env, homedir), "handoffs.json");
}

function isStoreRecord(value: unknown): value is SessionHandoffStore {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeChannel(value: string): string | null {
  const normalized = normalizeMessageChannel(value);
  if (normalized) return normalized;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function normalizeHandoffTarget(channel: string, target: string): string | null {
  const normalized = normalizeTargetForProvider(channel, target) ?? target.trim().toLowerCase();
  return normalized || null;
}

function buildHandoffKey(params: {
  channel: string;
  accountId?: string | null;
  target: string;
}): string | null {
  const channel = normalizeChannel(params.channel);
  if (!channel) return null;
  // Restrict handoffs to WhatsApp for now.
  if (channel !== "whatsapp") return null;
  const target = normalizeHandoffTarget(channel, params.target);
  if (!target) return null;
  if (channel === "whatsapp" && isWhatsAppGroupJid(target)) return null;
  const accountId = normalizeAccountId(params.accountId);
  return `${channel}:${accountId}:${target}`;
}

function cleanupExpired(store: SessionHandoffStore, now: number): boolean {
  let changed = false;
  for (const [key, entry] of Object.entries(store)) {
    if (!entry || typeof entry !== "object") {
      delete store[key];
      changed = true;
      continue;
    }
    if (typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
      delete store[key];
      changed = true;
    }
  }
  return changed;
}

async function loadHandoffStore(storePath: string): Promise<SessionHandoffStore> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (isStoreRecord(parsed)) return parsed;
  } catch {
    // ignore missing/invalid store
  }
  return {};
}

async function saveHandoffStore(storePath: string, store: SessionHandoffStore): Promise<void> {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const json = JSON.stringify(store, null, 2);
  const tmp = `${storePath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(tmp, json, { mode: 0o600, encoding: "utf-8" });
    await fs.promises.rename(tmp, storePath);
    await fs.promises.chmod(storePath, 0o600);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      await fs.promises.mkdir(path.dirname(storePath), { recursive: true }).catch(() => undefined);
      await fs.promises.writeFile(storePath, json, { mode: 0o600, encoding: "utf-8" });
      await fs.promises.chmod(storePath, 0o600);
      return;
    }
    throw err;
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

type HandoffLockOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  staleMs?: number;
};

async function withHandoffLock<T>(
  storePath: string,
  fn: () => Promise<T>,
  opts: HandoffLockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const staleMs = opts.staleMs ?? 30_000;
  const lockPath = `${storePath}.lock`;
  const startedAt = Date.now();

  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });

  while (true) {
    try {
      const handle = await fs.promises.open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
          "utf-8",
        );
      } catch {
        // best-effort
      }
      await handle.close();
      break;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : null;
      if (code === "ENOENT") {
        await fs.promises
          .mkdir(path.dirname(storePath), { recursive: true })
          .catch(() => undefined);
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }
      if (code !== "EEXIST") throw err;

      const now = Date.now();
      if (now - startedAt > timeoutMs) {
        throw new Error(`timeout acquiring handoff store lock: ${lockPath}`);
      }
      try {
        const st = await fs.promises.stat(lockPath);
        if (now - st.mtimeMs > staleMs) {
          await fs.promises.unlink(lockPath);
          continue;
        }
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.promises.unlink(lockPath).catch(() => undefined);
  }
}

export async function recordSessionHandoff(params: {
  channel: string;
  accountId?: string | null;
  target: string;
  sessionKey: string;
  ttlMinutes?: number;
  consume?: SessionHandoffConsumeMode;
}): Promise<void> {
  const key = buildHandoffKey({
    channel: params.channel,
    accountId: params.accountId,
    target: params.target,
  });
  if (!key) return;
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) return;

  const ttlMinutes =
    typeof params.ttlMinutes === "number" && Number.isFinite(params.ttlMinutes)
      ? Math.max(1, Math.floor(params.ttlMinutes))
      : undefined;
  const ttlMs = (ttlMinutes ? ttlMinutes * 60_000 : DEFAULT_HANDOFF_TTL_MS);
  const now = Date.now();
  const entry: SessionHandoffEntry = {
    sessionKey,
    createdAt: now,
    expiresAt: now + ttlMs,
    consume: params.consume ?? DEFAULT_HANDOFF_CONSUME,
  };

  const storePath = resolveHandoffStorePath();
  await withHandoffLock(storePath, async () => {
    const store = await loadHandoffStore(storePath);
    cleanupExpired(store, now);
    store[key] = entry;
    await saveHandoffStore(storePath, store);
  });
}

export async function consumeSessionHandoff(params: {
  channel: string;
  accountId?: string | null;
  peerId: string;
}): Promise<string | null> {
  const key = buildHandoffKey({
    channel: params.channel,
    accountId: params.accountId,
    target: params.peerId,
  });
  if (!key) return null;
  const storePath = resolveHandoffStorePath();
  return await withHandoffLock(storePath, async () => {
    const store = await loadHandoffStore(storePath);
    const now = Date.now();
    cleanupExpired(store, now);
    const entry = store[key];
    if (!entry || typeof entry !== "object") {
      await saveHandoffStore(storePath, store);
      return null;
    }
    const sessionKey = entry.sessionKey;
    if (entry.consume !== "until-expire") {
      delete store[key];
    }
    await saveHandoffStore(storePath, store);
    return sessionKey ?? null;
  });
}
