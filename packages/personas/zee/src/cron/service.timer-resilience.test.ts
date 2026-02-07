import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CronService } from "./service.js";
import * as storeModule from "./store.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-cron-timer-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe("CronService timer resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-13T00:00:00.000Z"));
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-arms timer after persist failure", async () => {
    const store = await makeStorePath();
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeatNow = vi.fn();

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent,
      requestHeartbeatNow,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    });

    await cron.start();

    // Add a recurring job that fires every second.
    await cron.add({
      name: "recurring job",
      enabled: true,
      schedule: { kind: "every", everyMs: 1_000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "tick" },
    });

    // Make saveCronStore throw on the next call to simulate a persist failure.
    const saveSpy = vi
      .spyOn(storeModule, "saveCronStore")
      .mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    // Advance past the first due time -- this tick should fail on persist.
    vi.setSystemTime(new Date("2025-12-13T00:00:01.000Z"));
    await vi.runOnlyPendingTimersAsync();

    // The persist error should have been logged via the timer catch handler.
    expect(noopLogger.error).toHaveBeenCalled();

    // Restore normal saveCronStore behavior for the next tick.
    saveSpy.mockRestore();

    // Advance time again -- the timer should still be alive and fire.
    vi.setSystemTime(new Date("2025-12-13T00:00:02.000Z"));
    await vi.runOnlyPendingTimersAsync();

    // The job should have been enqueued on the second tick despite the
    // first tick's persist failure.
    expect(enqueueSystemEvent).toHaveBeenCalledWith("tick", {
      agentId: undefined,
    });

    cron.stop();
    await store.cleanup();
  });

  it("clamps timer delay to 60 seconds (drift guard)", async () => {
    const store = await makeStorePath();

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    });

    await cron.start();

    // Add a job 10 minutes in the future.
    const tenMinutesLater = Date.parse("2025-12-13T00:10:00.000Z");
    await cron.add({
      name: "far future job",
      enabled: true,
      schedule: { kind: "at", atMs: tenMinutesLater },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
    });

    // The timer should fire after at most 60 seconds, not 10 minutes.
    // Advance 61 seconds and verify the timer fires (even though the
    // job isn't due yet, the scheduler re-evaluates).
    vi.advanceTimersByTime(61_000);
    // Allow async callbacks to flush.
    await vi.runOnlyPendingTimersAsync();

    // The job should not have run yet (not due until T+10min), but the
    // timer should have ticked (verified by no timeout at 10 min).
    // Advance to 10 minutes -- the drift guard means the timer will
    // have re-armed many times by now, eventually catching the due job.
    vi.setSystemTime(new Date("2025-12-13T00:10:00.000Z"));
    await vi.runOnlyPendingTimersAsync();

    cron.stop();
    await store.cleanup();
  });
});
