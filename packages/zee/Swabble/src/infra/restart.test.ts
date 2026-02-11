import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __testing,
  consumeGatewaySigusr1RestartAuthorization,
  isGatewaySigusr1RestartExternallyAllowed,
  scheduleGatewaySigusr1Restart,
  setGatewaySigusr1RestartPolicy,
} from "./restart.js";

describe("restart authorization", () => {
  const sigusr1Handler = () => {};

  beforeEach(() => {
    __testing.resetSigusr1State();
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockImplementation(() => true);
    process.on("SIGUSR1", sigusr1Handler);
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    __testing.resetSigusr1State();
    process.off("SIGUSR1", sigusr1Handler);
  });

  it("consumes a scheduled authorization once", async () => {
    expect(consumeGatewaySigusr1RestartAuthorization()).toBe(false);

    const result = scheduleGatewaySigusr1Restart({ delayMs: 0 });
    expect(result.ok).toBe(true);

    expect(consumeGatewaySigusr1RestartAuthorization()).toBe(true);
    expect(consumeGatewaySigusr1RestartAuthorization()).toBe(false);

    await vi.runAllTimersAsync();
  });

  it("returns ok: false when no SIGUSR1 listener exists", () => {
    process.off("SIGUSR1", sigusr1Handler);

    const result = scheduleGatewaySigusr1Restart({ delayMs: 0 });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("signal");

    expect(consumeGatewaySigusr1RestartAuthorization()).toBe(false);

    process.on("SIGUSR1", sigusr1Handler);
  });

  it("tracks external restart policy", () => {
    expect(isGatewaySigusr1RestartExternallyAllowed()).toBe(false);
    setGatewaySigusr1RestartPolicy({ allowExternal: true });
    expect(isGatewaySigusr1RestartExternallyAllowed()).toBe(true);
  });
});
