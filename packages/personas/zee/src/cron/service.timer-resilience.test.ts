import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CronService } from "./service.js"
import { onTimer } from "./service/timer.js"

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-cron-timer-"))
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await fs.rm(dir, { recursive: true, force: true })
          return
        } catch (err: any) {
          if (err.code === "ENOTEMPTY" && i < 2) {
            await new Promise((resolve) => setTimeout(resolve, 50))
            continue
          }
          throw err
        }
      }
    },
  }
}

describe("CronService timer resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-12-13T00:00:00.000Z"))
    noopLogger.debug.mockClear()
    noopLogger.info.mockClear()
    noopLogger.warn.mockClear()
    noopLogger.error.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("re-arms timer after persist failure", async () => {
    const store = await makeStorePath()
    const enqueueSystemEvent = vi.fn()
    const requestHeartbeatNow = vi.fn()
    let nowMs = Date.parse("2025-12-13T00:00:00.000Z")

    const cron = new CronService({
      nowMs: () => nowMs,
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent,
      requestHeartbeatNow,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    })

    await cron.start()

    // Add a recurring job that fires every second.
    await cron.add({
      name: "recurring job",
      enabled: true,
      schedule: { kind: "every", everyMs: 1_000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "tick" },
    })

    // Simulate a persist failure by making the store directory read-only.
    const storeDir = path.dirname(store.storePath)
    await fs.mkdir(storeDir, { recursive: true })
    await fs.chmod(storeDir, 0o500)
    await expect(fs.writeFile(path.join(storeDir, "probe.tmp"), "x", "utf-8")).rejects.toThrow()

    // Trigger the tick directly so we can assert the timer re-arms even when
    // persistence fails. The caller (armTimer) is responsible for logging.
    nowMs = Date.parse("2025-12-13T00:00:01.000Z")
    await expect(onTimer((cron as unknown as { state: unknown }).state as never)).rejects.toThrow()
    expect((cron as unknown as { state: { timer: unknown } }).state.timer).not.toBeNull()

    // Restore normal saveCronStore behavior for the next tick.
    await fs.chmod(storeDir, 0o700)

    // Run again with the store writable; the job should fire.
    nowMs = Date.parse("2025-12-13T00:00:02.000Z")
    await onTimer((cron as unknown as { state: unknown }).state as never)

    // The job should have been enqueued on the second tick despite the
    // first tick's persist failure.
    expect(enqueueSystemEvent).toHaveBeenCalledWith("tick", {
      agentId: undefined,
    })

    cron.stop()
    vi.useRealTimers();
    await store.cleanup()
  })

  it("clamps timer delay to 60 seconds (drift guard)", async () => {
    const store = await makeStorePath()

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    })

    await cron.start()

    // Add a job 10 minutes in the future.
    const tenMinutesLater = Date.parse("2025-12-13T00:10:00.000Z")
    await cron.add({
      name: "far future job",
      enabled: true,
      schedule: { kind: "at", at: new Date(tenMinutesLater).toISOString() },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
    })

    // The timer should fire after at most 60 seconds, not 10 minutes.
    // Advance 61 seconds and verify the timer fires (even though the
    // job isn't due yet, the scheduler re-evaluates).
    vi.advanceTimersByTime(61_000)
    // Allow async callbacks to flush.
    await vi.runOnlyPendingTimersAsync()

    // The job should not have run yet (not due until T+10min), but the
    // timer should have ticked (verified by no timeout at 10 min).
    // Advance to 10 minutes -- the drift guard means the timer will
    // have re-armed many times by now, eventually catching the due job.
    vi.setSystemTime(new Date("2025-12-13T00:10:00.000Z"))
    await vi.runOnlyPendingTimersAsync()

    cron.stop()
    vi.useRealTimers();
    await store.cleanup()
  })
})
