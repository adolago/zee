import JSON5 from "json5";

import type { ConfigFileSnapshot } from "./types.js";
import type { SecurityRedactionConfig } from "./types.security.js";

/**
 * Sentinel value used to replace sensitive config fields in gateway responses.
 * Write-side handlers (config.set, config.apply, config.patch) detect this
 * sentinel and restore the original value from the on-disk config, so a
 * round-trip through the UI does not corrupt credentials.
 */
export const REDACTED_SENTINEL = "<redacted>";

const ENV_REF_RE = /^\$\{[A-Z0-9_]+\}$/;
const HIGH_RISK_PATH_PARTS = new Set([
  "auth",
  "oauth",
  "credentials",
  "credential",
  "secrets",
  "secret",
  "tokens",
  "token",
  "apikeys",
  "api_keys",
]);

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePathPattern(raw: string): RegExp {
  const trimmed = raw.trim();
  const source = trimmed
    .split("*")
    .map((part) => escapeRegExp(part))
    .join(".*");
  return new RegExp(`^${source}$`, "i");
}

type RedactionPolicyResolved = {
  defaultDeny: boolean;
  allowlist: RegExp[];
  matchers: RegExp[];
};

function resolvePolicy(policy?: SecurityRedactionConfig): RedactionPolicyResolved {
  return {
    defaultDeny: policy?.defaultDeny === true,
    allowlist: (policy?.allowlist ?? [])
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .map((entry) => compilePathPattern(entry)),
    matchers: (policy?.nestedKeyMatchers ?? [])
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .map((entry) => {
        try {
          return new RegExp(entry, "i");
        } catch {
          return compilePathPattern(entry);
        }
      }),
  };
}

function isAllowlisted(pathSegments: string[], policy: RedactionPolicyResolved): boolean {
  if (policy.allowlist.length === 0) return false;
  const path = pathSegments.join(".");
  return policy.allowlist.some((pattern) => pattern.test(path));
}

function shouldRedactString(params: {
  key: string;
  value: string;
  pathSegments: string[];
  policy: RedactionPolicyResolved;
}): boolean {
  const { key, value, pathSegments, policy } = params;
  if (!value.trim()) return false;
  if (isEnvReference(value)) return false;
  if (isAllowlisted(pathSegments, policy)) return false;

  const path = pathSegments.join(".");
  if (isSensitiveKey(key)) return true;
  if (policy.matchers.some((pattern) => pattern.test(key) || pattern.test(path))) return true;

  if (!policy.defaultDeny) return false;
  const parentSegments = pathSegments.slice(0, -1).map((segment) => segment.toLowerCase());
  return parentSegments.some(
    (segment) =>
      HIGH_RISK_PATH_PARTS.has(segment) ||
      isSensitiveKey(segment),
  );
}

function redactValue(
  value: unknown,
  policy: RedactionPolicyResolved,
  path: string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, policy, [...path, String(index)]));
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (
      typeof child === "string" &&
      shouldRedactString({
        key,
        value: child,
        pathSegments: childPath,
        policy,
      })
    ) {
      out[key] = REDACTED_SENTINEL;
      continue;
    }
    out[key] = redactValue(child, policy, childPath);
  }
  return out;
}

export function redactConfigObject<T = unknown>(value: T, policy?: SecurityRedactionConfig): T {
  return redactValue(value, resolvePolicy(policy)) as T;
}

export function redactConfigSnapshot(
  snapshot: ConfigFileSnapshot,
  policy?: SecurityRedactionConfig,
): ConfigFileSnapshot {
  const effectivePolicy = policy ?? snapshot.config?.security?.redaction;
  let redactedRaw: string | null = snapshot.raw;
  if (typeof snapshot.raw === "string") {
    try {
      const parsed = JSON5.parse(snapshot.raw) as unknown;
      const redacted = redactConfigObject(parsed, effectivePolicy);
      redactedRaw = JSON.stringify(redacted, null, 2).trimEnd().concat("\n");
    } catch {
      // Avoid leaking secrets when raw can't be parsed.
      redactedRaw = null;
    }
  }

  return {
    ...snapshot,
    raw: redactedRaw,
    parsed: redactConfigObject(snapshot.parsed, effectivePolicy),
    config: redactConfigObject(snapshot.config, effectivePolicy),
  };
}

function restoreValue(
  next: unknown,
  base: unknown,
  path: string[],
  policy: RedactionPolicyResolved,
): unknown {
  if (Array.isArray(next)) {
    const baseArr = Array.isArray(base) ? base : [];
    return next.map((value, index) =>
      restoreValue(value, baseArr[index], [...path, String(index)], policy),
    );
  }
  if (!isPlainObject(next)) return next;

  const baseObj = isPlainObject(base) ? base : {};
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(next)) {
    const baseChild = baseObj[key];
    if (
      child === REDACTED_SENTINEL &&
      shouldRedactString({
        key,
        value: REDACTED_SENTINEL,
        pathSegments: [...path, key],
        policy,
      })
    ) {
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
    out[key] = restoreValue(child, baseChild, [...path, key], policy);
  }
  return out;
}

export function restoreRedactedValues<T = unknown>(
  next: T,
  base: unknown,
  policy?: SecurityRedactionConfig,
): T {
  return restoreValue(next, base, [], resolvePolicy(policy)) as T;
}
