import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type VoiceWakeConfig = {
  enabled: boolean;
  triggers: string[];
  updatedAtMs: number;
};

const DEFAULT_TRIGGERS = ["zee", "claude", "computer"];

function resolvePath(baseDir?: string) {
  const root = baseDir ?? resolveStateDir();
  return path.join(root, "settings", "voicewake.json");
}

function sanitizeTriggers(
  triggers: string[] | undefined | null,
  options?: { allowEmpty?: boolean },
): string[] {
  const cleaned = (triggers ?? [])
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter((w) => w.length > 0);
  if (options?.allowEmpty === true) return cleaned;
  return cleaned.length > 0 ? cleaned : DEFAULT_TRIGGERS;
}

async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJSONAtomic(filePath: string, value: unknown) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

let lock: Promise<void> = Promise.resolve();
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release: (() => void) | undefined;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

export function defaultVoiceWakeTriggers() {
  return [...DEFAULT_TRIGGERS];
}

export function resolveEffectiveVoiceWakeTriggers(cfg: VoiceWakeConfig): string[] {
  return cfg.enabled === false ? [] : sanitizeTriggers(cfg.triggers);
}

export async function loadVoiceWakeConfig(baseDir?: string): Promise<VoiceWakeConfig> {
  const filePath = resolvePath(baseDir);
  const existing = await readJSON<VoiceWakeConfig>(filePath);
  if (!existing) {
    return {
      enabled: true,
      triggers: defaultVoiceWakeTriggers(),
      updatedAtMs: 0,
    };
  }
  const enabled = existing.enabled !== false;
  return {
    enabled,
    triggers: sanitizeTriggers(existing.triggers, { allowEmpty: !enabled }),
    updatedAtMs:
      typeof existing.updatedAtMs === "number" && existing.updatedAtMs > 0
        ? existing.updatedAtMs
        : 0,
  };
}

export async function setVoiceWakeConfig(
  next: Partial<Pick<VoiceWakeConfig, "enabled" | "triggers">>,
  baseDir?: string,
): Promise<VoiceWakeConfig> {
  const filePath = resolvePath(baseDir);
  return await withLock(async () => {
    const previous = await loadVoiceWakeConfig(baseDir);
    const enabled = typeof next.enabled === "boolean" ? next.enabled : previous.enabled;
    const triggersInput = next.triggers ?? previous.triggers;
    const normalized = sanitizeTriggers(triggersInput, { allowEmpty: !enabled });
    const resolvedTriggers =
      enabled && normalized.length === 0 ? defaultVoiceWakeTriggers() : normalized;
    const saved: VoiceWakeConfig = {
      enabled,
      triggers: resolvedTriggers,
      updatedAtMs: Date.now(),
    };
    await writeJSONAtomic(filePath, saved);
    return saved;
  });
}

export async function setVoiceWakeTriggers(
  triggers: string[],
  baseDir?: string,
): Promise<VoiceWakeConfig> {
  return await setVoiceWakeConfig({ enabled: true, triggers }, baseDir);
}

export async function setVoiceWakeEnabled(
  enabled: boolean,
  baseDir?: string,
): Promise<VoiceWakeConfig> {
  return await setVoiceWakeConfig({ enabled }, baseDir);
}
