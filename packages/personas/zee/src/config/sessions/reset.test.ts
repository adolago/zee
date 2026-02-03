import { describe, expect, it } from "vitest";

import { evaluateSessionFreshness, resolveSessionResetPolicy } from "./reset.js";

describe("Session reset policy", () => {
  it("keeps sessions fresh in manual mode (no auto reset)", () => {
    const policy = resolveSessionResetPolicy({
      sessionCfg: { reset: { mode: "manual", idleMinutes: 5, atHour: 0 } },
      resetType: "dm",
    });

    expect(policy.mode).toBe("manual");
    expect(policy.idleMinutes).toBeUndefined();

    const now = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const freshness = evaluateSessionFreshness({
      updatedAt: now - 365 * 24 * 60 * 60 * 1000,
      now,
      policy,
    });

    expect(freshness.fresh).toBe(true);
    expect(freshness.dailyResetAt).toBeUndefined();
    expect(freshness.idleExpiresAt).toBeUndefined();
  });
});
