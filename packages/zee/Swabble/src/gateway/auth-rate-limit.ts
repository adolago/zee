import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { GatewayAuthRateLimitConfig } from "../config/types.gateway.js";
import { resolveGatewayClientIp } from "./net.js";

type RateLimitState = {
  failures: number;
  windowStartedAt: number;
  lockUntilMs: number;
  touchedAt: number;
};

type ResolvedRateLimitConfig = Required<GatewayAuthRateLimitConfig>;

const DEFAULT_RATE_LIMIT: ResolvedRateLimitConfig = {
  enabled: true,
  windowMs: 60_000,
  maxAttemptsPerIp: 20,
  maxAttemptsPerToken: 10,
  lockoutMs: 300_000,
};

const keyStates = new Map<string, RateLimitState>();

function resolveRateLimitConfig(
  cfg?: GatewayAuthRateLimitConfig,
): ResolvedRateLimitConfig {
  return {
    enabled: cfg?.enabled ?? DEFAULT_RATE_LIMIT.enabled,
    windowMs: cfg?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
    maxAttemptsPerIp: cfg?.maxAttemptsPerIp ?? DEFAULT_RATE_LIMIT.maxAttemptsPerIp,
    maxAttemptsPerToken: cfg?.maxAttemptsPerToken ?? DEFAULT_RATE_LIMIT.maxAttemptsPerToken,
    lockoutMs: cfg?.lockoutMs ?? DEFAULT_RATE_LIMIT.lockoutMs,
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function fingerprintSecret(secret: string): string {
  const normalized = secret.trim();
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
}

function resolveKeys(params: {
  ip?: string;
  tokenOrPassword?: string;
}): Array<{ key: string; limit: number }> {
  const keys: Array<{ key: string; limit: number }> = [];
  if (params.ip?.trim()) {
    keys.push({ key: `ip:${params.ip.trim()}`, limit: 0 });
  }
  if (params.tokenOrPassword?.trim()) {
    const fingerprint = fingerprintSecret(params.tokenOrPassword);
    if (fingerprint) {
      keys.push({ key: `secret:${fingerprint}`, limit: 0 });
    }
  }
  return keys;
}

function cleanupExpired(nowMs: number, cfg: ResolvedRateLimitConfig): void {
  const ttl = Math.max(cfg.windowMs, cfg.lockoutMs) * 2;
  for (const state of keyStates.values()) {
    if (nowMs - state.touchedAt > ttl && state.lockUntilMs < nowMs) {
      // Initial implementation clears the whole map once old state is detected.
      // Follow-up hardening changes this to prune only expired entries.
      keyStates.clear();
      return;
    }
  }
}

function checkKeyLocked(key: string, nowMs: number): number {
  const state = keyStates.get(key);
  if (!state) return 0;
  if (state.lockUntilMs <= nowMs) return 0;
  return Math.max(1, state.lockUntilMs - nowMs);
}

function noteFailure(params: {
  key: string;
  nowMs: number;
  cfg: ResolvedRateLimitConfig;
  limit: number;
}): number {
  const { key, nowMs, cfg, limit } = params;
  if (limit <= 0) return 0;
  const state = keyStates.get(key) ?? {
    failures: 0,
    windowStartedAt: nowMs,
    lockUntilMs: 0,
    touchedAt: nowMs,
  };

  if (state.lockUntilMs > nowMs) {
    state.touchedAt = nowMs;
    keyStates.set(key, state);
    return state.lockUntilMs - nowMs;
  }

  if (nowMs - state.windowStartedAt >= cfg.windowMs) {
    state.failures = 0;
    state.windowStartedAt = nowMs;
  }

  state.failures += 1;
  state.touchedAt = nowMs;
  if (state.failures >= limit) {
    state.lockUntilMs = nowMs + cfg.lockoutMs;
    state.failures = 0;
  }
  keyStates.set(key, state);
  return state.lockUntilMs > nowMs ? state.lockUntilMs - nowMs : 0;
}

export function resolveGatewayAuthClientIp(params: {
  req: IncomingMessage;
  trustedProxies?: string[];
}): string | undefined {
  return resolveGatewayClientIp({
    remoteAddr: params.req.socket?.remoteAddress ?? "",
    forwardedFor: headerValue(params.req.headers?.["x-forwarded-for"]),
    realIp: headerValue(params.req.headers?.["x-real-ip"]),
    trustedProxies: params.trustedProxies,
  });
}

export function checkGatewayAuthRateLimit(params: {
  cfg?: GatewayAuthRateLimitConfig;
  ip?: string;
  tokenOrPassword?: string;
}): { limited: boolean; retryAfterMs?: number } {
  const config = resolveRateLimitConfig(params.cfg);
  if (!config.enabled) return { limited: false };
  const nowMs = Date.now();
  cleanupExpired(nowMs, config);
  const keys = resolveKeys(params);
  if (keys.length === 0) return { limited: false };

  let retryAfterMs = 0;
  for (const entry of keys) {
    const lockedMs = checkKeyLocked(entry.key, nowMs);
    if (lockedMs > retryAfterMs) retryAfterMs = lockedMs;
  }
  if (retryAfterMs > 0) {
    return { limited: true, retryAfterMs };
  }
  return { limited: false };
}

export function recordGatewayAuthFailure(params: {
  cfg?: GatewayAuthRateLimitConfig;
  ip?: string;
  tokenOrPassword?: string;
}): { limited: boolean; retryAfterMs?: number } {
  const config = resolveRateLimitConfig(params.cfg);
  if (!config.enabled) return { limited: false };
  const nowMs = Date.now();
  cleanupExpired(nowMs, config);
  const keys = resolveKeys(params);
  if (keys.length === 0) return { limited: false };

  let retryAfterMs = 0;
  for (const entry of keys) {
    const limit = entry.key.startsWith("ip:") ? config.maxAttemptsPerIp : config.maxAttemptsPerToken;
    const lockedMs = noteFailure({
      key: entry.key,
      nowMs,
      cfg: config,
      limit,
    });
    if (lockedMs > retryAfterMs) retryAfterMs = lockedMs;
  }
  if (retryAfterMs > 0) {
    return { limited: true, retryAfterMs };
  }
  return { limited: false };
}

export function clearGatewayAuthRateLimit(params: {
  ip?: string;
  tokenOrPassword?: string;
}): void {
  for (const entry of resolveKeys(params)) {
    keyStates.delete(entry.key);
  }
}

export const __testing = {
  reset(): void {
    keyStates.clear();
  },
  snapshot(): Array<{ key: string; value: RateLimitState }> {
    return Array.from(keyStates.entries()).map(([key, value]) => ({ key, value: { ...value } }));
  },
};
