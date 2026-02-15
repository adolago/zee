import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __testing,
  checkGatewayAuthRateLimit,
  clearGatewayAuthRateLimit,
  recordGatewayAuthFailure,
  resolveGatewayAuthClientIp,
} from "./auth-rate-limit.js";

describe("auth rate limiter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __testing.reset();
    vi.useRealTimers();
  });

  it("locks out by IP after repeated failures and unlocks after lockout", () => {
    let now = Date.parse("2026-02-13T12:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const cfg = {
      enabled: true,
      windowMs: 60_000,
      maxAttemptsPerIp: 2,
      maxAttemptsPerToken: 10,
      lockoutMs: 5_000,
    };

    expect(recordGatewayAuthFailure({ cfg, ip: "10.0.0.1" }).limited).toBe(false);
    const second = recordGatewayAuthFailure({ cfg, ip: "10.0.0.1" });
    expect(second.limited).toBe(true);
    expect((second.retryAfterMs ?? 0) > 0).toBe(true);

    expect(checkGatewayAuthRateLimit({ cfg, ip: "10.0.0.1" }).limited).toBe(true);
    now += 5_100;
    expect(checkGatewayAuthRateLimit({ cfg, ip: "10.0.0.1" }).limited).toBe(false);
  });

  it("supports token/password-based lockouts independent of IP", () => {
    const now = Date.parse("2026-02-13T12:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const cfg = {
      enabled: true,
      windowMs: 60_000,
      maxAttemptsPerIp: 50,
      maxAttemptsPerToken: 2,
      lockoutMs: 10_000,
    };

    expect(recordGatewayAuthFailure({ cfg, tokenOrPassword: "secret-token" }).limited).toBe(false);
    const second = recordGatewayAuthFailure({ cfg, tokenOrPassword: "secret-token" });
    expect(second.limited).toBe(true);

    expect(checkGatewayAuthRateLimit({ cfg, tokenOrPassword: "another-secret" }).limited).toBe(
      false,
    );
  });

  it("clears lock state on successful auth", () => {
    const cfg = {
      enabled: true,
      windowMs: 60_000,
      maxAttemptsPerIp: 1,
      maxAttemptsPerToken: 1,
      lockoutMs: 60_000,
    };
    const blocked = recordGatewayAuthFailure({
      cfg,
      ip: "127.0.0.1",
      tokenOrPassword: "abc",
    });
    expect(blocked.limited).toBe(true);
    clearGatewayAuthRateLimit({ ip: "127.0.0.1", tokenOrPassword: "abc" });
    expect(
      checkGatewayAuthRateLimit({
        cfg,
        ip: "127.0.0.1",
        tokenOrPassword: "abc",
      }).limited,
    ).toBe(false);
  });

  it("resolves client IP from request with forwarded headers", () => {
    const ip = resolveGatewayAuthClientIp({
      req: {
        socket: { remoteAddress: "127.0.0.1" },
        headers: {
          "x-forwarded-for": "203.0.113.7, 127.0.0.1",
          "x-real-ip": "203.0.113.7",
        },
      } as never,
      trustedProxies: ["127.0.0.1"],
    });
    expect(ip).toBe("203.0.113.7");
  });

  it("prunes only expired entries without clearing active lock state", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const cfg = {
      enabled: true,
      windowMs: 1_000,
      maxAttemptsPerIp: 1,
      maxAttemptsPerToken: 1,
      lockoutMs: 1_000,
    };

    // Old state that should be pruned.
    expect(recordGatewayAuthFailure({ cfg, ip: "10.0.0.1" }).limited).toBe(true);

    // Fresh state that must remain after pruning.
    now = 3_000;
    expect(recordGatewayAuthFailure({ cfg, ip: "10.0.0.2" }).limited).toBe(true);

    // Cleanup runs during checks.
    expect(checkGatewayAuthRateLimit({ cfg, ip: "10.0.0.2" }).limited).toBe(true);
  });
});
