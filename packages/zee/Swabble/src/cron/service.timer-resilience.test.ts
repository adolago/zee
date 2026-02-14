import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CronService } from "./service.js";
import { onTimer } from "./service/timer.js";

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
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
          return;
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code)
              : "";
          if (!["ENOTEMPTY", "EBUSY", "EPERM"].includes(code) || attempt === 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    },
  };
}

function lastSetTimeoutDelay(spy: ReturnType<typeof vi.spyOn<typeof globalThis, "setTimeout">>): number | null {
  for (let index = spy.mock.calls.length - 1; index >= 0; index -= 1) {
    const delay = spy.mock.calls[index]?.[1];
    if (typeof delay === "number") return delay;
  }
  return null;
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
    let nowMs = Date.parse("2025-12-13T00:00:00.000Z");

    const cron = new CronService({
      nowMs: () => nowMs,
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

    // Simulate a persist failure by making the store directory read-only.
    const storeDir = path.dirname(store.storePath);
    await fs.mkdir(storeDir, { recursive: true });
    await fs.chmod(storeDir, 0o500);
    await expect(fs.writeFile(path.join(storeDir, "probe.tmp"), "x", "utf-8")).rejects.toThrow();

    // Trigger the tick directly so we can assert the timer re-arms even when
    // persistence fails. The caller (armTimer) is responsible for logging.
    nowMs = Date.parse("2025-12-13T00:00:01.000Z");
    await expect(onTimer((cron as unknown as { state: unknown }).state as never)).rejects.toThrow();
    expect((cron as unknown as { state: { timer: unknown } }).state.timer).not.toBeNull();

    // Restore normal saveCronStore behavior for the next tick.
    await fs.chmod(storeDir, 0o700);

    // Run again with the store writable; the job should fire.
    nowMs = Date.parse("2025-12-13T00:00:02.000Z");
    await onTimer((cron as unknown as { state: unknown }).state as never);

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
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    });

    await cron.start();
    const callsBeforeAdd = setTimeoutSpy.mock.calls.length;

    // Add a job 10 minutes in the future.
    const tenMinutesLater = Date.parse("2025-12-13T00:10:00.000Z");
    await cron.add({
      name: "far future job",
      enabled: true,
      schedule: { kind: "at", at: new Date(tenMinutesLater).toISOString() },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
    });

    // The timer should arm for at most 60 seconds, not 10 minutes.
    const addPhaseSpy = { mock: { calls: setTimeoutSpy.mock.calls.slice(callsBeforeAdd) } } as typeof setTimeoutSpy;
    const initialDelay = lastSetTimeoutDelay(addPhaseSpy);
    expect(initialDelay).not.toBeNull();
    expect(initialDelay as number).toBeLessThanOrEqual(60_000);

    // Advance one minute and verify it re-arms with the same cap.
    await vi.advanceTimersByTimeAsync(61_000);
    const rearmedDelay = lastSetTimeoutDelay(setTimeoutSpy);
    expect(rearmedDelay).not.toBeNull();
    expect(rearmedDelay as number).toBeLessThanOrEqual(60_000);

    cron.stop();
    setTimeoutSpy.mockRestore();
    await store.cleanup();
  });
});
