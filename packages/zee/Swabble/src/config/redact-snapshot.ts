import JSON5 from "json5";

import type { ConfigFileSnapshot } from "./types.js";

/**
 * Sentinel value used to replace sensitive config fields in gateway responses.
 * Write-side handlers (config.set, config.apply, config.patch) detect this
 * sentinel and restore the original value from the on-disk config, so a
 * round-trip through the UI does not corrupt credentials.
 */
export const REDACTED_SENTINEL = "<redacted>";

const ENV_REF_RE = /^\$\{[A-Z0-9_]+\}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isEnvReference(value: string): boolean {
  return ENV_REF_RE.test(value.trim());
}

function isSensitiveKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  if (k === "token" || k.endsWith("token")) return true;
  if (k === "password" || k.endsWith("password")) return true;
  if (k === "secret" || k.endsWith("secret")) return true;
  if (k === "apikey" || k.endsWith("apikey")) return true;
  if (k === "api_key" || k.endsWith("api_key")) return true;
  return false;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key) && typeof child === "string" && child.trim() && !isEnvReference(child)) {
      out[key] = REDACTED_SENTINEL;
      continue;
    }
    out[key] = redactValue(child);
  }
  return out;
}

export function redactConfigObject<T = unknown>(value: T): T {
  return redactValue(value) as T;
}

export function redactConfigSnapshot(snapshot: ConfigFileSnapshot): ConfigFileSnapshot {
  let redactedRaw: string | null = snapshot.raw;
  if (typeof snapshot.raw === "string") {
    try {
      const parsed = JSON5.parse(snapshot.raw) as unknown;
      const redacted = redactConfigObject(parsed);
      redactedRaw = JSON.stringify(redacted, null, 2).trimEnd().concat("\n");
    } catch {
      // Avoid leaking secrets when raw can't be parsed.
      redactedRaw = null;
    }
  }

  return {
    ...snapshot,
    raw: redactedRaw,
    parsed: redactConfigObject(snapshot.parsed),
    config: redactConfigObject(snapshot.config),
  };
}

function restoreValue(next: unknown, base: unknown, path: string[]): unknown {
  if (Array.isArray(next)) {
    const baseArr = Array.isArray(base) ? base : [];
    return next.map((value, index) => restoreValue(value, baseArr[index], [...path, String(index)]));
  }
  if (!isPlainObject(next)) return next;

  const baseObj = isPlainObject(base) ? base : {};
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(next)) {
    const baseChild = baseObj[key];
    if (isSensitiveKey(key) && child === REDACTED_SENTINEL) {
      const hasBaseValue = key in baseObj;
      if (!hasBaseValue) {
        const label = path.length > 0 ? `${path.join(".")}.${key}` : key;
        throw new Error(
          `config write rejected: \"${label}\" is redacted; set an explicit value instead of ${REDACTED_SENTINEL}`,
        );
      }
      out[key] = baseChild;
      continue;
    }
    out[key] = restoreValue(child, baseChild, [...path, key]);
  }
  return out;
}

export function restoreRedactedValues<T = unknown>(next: T, base: unknown): T {
  return restoreValue(next, base, []) as T;
}
