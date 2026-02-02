import { describe, expect, test, beforeEach } from "bun:test"
import {
  contentHash,
  shouldThrottle,
  recordSent,
  clearAllHistory,
} from "../../src/cron/service/throttle"
import { createCronServiceState, type CronServiceState } from "../../src/cron/service/state"
import { runDueJobs, executeJob } from "../../src/cron/service/timer"
import type { CronJob, CronStoreFile } from "../../src/cron/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides?: Partial<Parameters<typeof createCronServiceState>[0]>): CronServiceState {
  const state = createCronServiceState({
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    storePath: "/tmp/test-cron.json",
    cronEnabled: true,
    enqueueSystemEvent: () => {},
    requestHeartbeatNow: () => {},
    runIsolatedAgentJob: async () => ({ status: "ok", summary: "done" }),
    ...overrides,
  })
  return state
}

function makeJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    name: "test-job",
    enabled: true,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "do stuff" },
    state: { nextRunAtMs: 500 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Throttle module unit tests
// ---------------------------------------------------------------------------

describe("throttle", () => {
  beforeEach(() => {
    clearAllHistory()
  })

  test("contentHash returns consistent hex string", () => {
    const h1 = contentHash("hello world")
    const h2 = contentHash("hello world")
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  test("contentHash differs for different input", () => {
    expect(contentHash("aaa")).not.toBe(contentHash("bbb"))
  })

  test("shouldThrottle returns undefined when no config", () => {
    expect(shouldThrottle("j1", "hash", 1000, undefined)).toBeUndefined()
  })

  test("shouldThrottle returns undefined when no matching dedup", () => {
    recordSent("j1", "hash-a", 900)
    const result = shouldThrottle("j1", "hash-b", 1000, { dedupWindowMs: 5000 })
    expect(result).toBeUndefined()
  })

  test("shouldThrottle detects duplicate within window", () => {
    const hash = contentHash("same output")
    recordSent("j1", hash, 900)
    const result = shouldThrottle("j1", hash, 1000, { dedupWindowMs: 5000 })
    expect(result).toBeDefined()
    expect(result).toContain("duplicate")
  })

  test("shouldThrottle allows same hash after window expires", () => {
    const hash = contentHash("same output")
    recordSent("j1", hash, 100)
    const result = shouldThrottle("j1", hash, 6000, { dedupWindowMs: 5000 })
    expect(result).toBeUndefined()
  })

  test("shouldThrottle enforces maxPerWindow", () => {
    recordSent("j1", "h1", 900)
    recordSent("j1", "h2", 950)
    const result = shouldThrottle("j1", "h3", 1000, {
      dedupWindowMs: 5000,
      maxPerWindow: 2,
    })
    expect(result).toBeDefined()
    expect(result).toContain("max notifications")
  })

  test("shouldThrottle allows after maxPerWindow entries expire", () => {
    recordSent("j1", "h1", 100)
    recordSent("j1", "h2", 200)
    const result = shouldThrottle("j1", "h3", 6000, {
      dedupWindowMs: 5000,
      maxPerWindow: 2,
    })
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Concurrency control tests
// ---------------------------------------------------------------------------

describe("concurrency control", () => {
  beforeEach(() => {
    clearAllHistory()
  })

  test("runDueJobs skips job when activeRuns >= maxConcurrentRuns (default 1)", async () => {
    const state = makeState({ nowMs: () => 1000 })
    const job = makeJob()
    state.store = { version: 1, jobs: [job] } as CronStoreFile
    state.activeRuns.set("job-1", 1)

    await runDueJobs(state)
    // Job should not have been executed (runningAtMs stays undefined since it was skipped)
    expect(job.state.lastRunAtMs).toBeUndefined()
  })

  test("runDueJobs allows job when activeRuns < maxConcurrentRuns", async () => {
    let ran = false
    const state = makeState({
      nowMs: () => 1000,
      runIsolatedAgentJob: async () => {
        ran = true
        return { status: "ok", summary: "done" }
      },
    })
    const job = makeJob({ maxConcurrentRuns: 2 })
    state.store = { version: 1, jobs: [job] } as CronStoreFile
    state.activeRuns.set("job-1", 1)

    await runDueJobs(state)
    expect(ran).toBe(true)
  })

  test("runDueJobs blocks job when activeRuns reaches maxConcurrentRuns=2", async () => {
    const state = makeState({ nowMs: () => 1000 })
    const job = makeJob({ maxConcurrentRuns: 2 })
    state.store = { version: 1, jobs: [job] } as CronStoreFile
    state.activeRuns.set("job-1", 2)

    await runDueJobs(state)
    expect(job.state.lastRunAtMs).toBeUndefined()
  })

  test("executeJob increments and decrements activeRuns", async () => {
    let capturedActive = 0
    const state = makeState({
      nowMs: () => 1000,
      runIsolatedAgentJob: async () => {
        capturedActive = state.activeRuns.get("job-1") ?? 0
        return { status: "ok", summary: "done" }
      },
    })
    const job = makeJob()
    state.store = { version: 1, jobs: [job] } as CronStoreFile

    expect(state.activeRuns.get("job-1")).toBeUndefined()
    await executeJob(state, job, 1000, { forced: false })
    expect(capturedActive).toBe(1)
    // After completion, activeRuns should be cleaned up
    expect(state.activeRuns.has("job-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Throttle integration with executeJob
// ---------------------------------------------------------------------------

describe("throttle integration", () => {
  beforeEach(() => {
    clearAllHistory()
  })

  test("duplicate output is throttled on isolated job", async () => {
    const events: string[] = []
    const state = makeState({
      nowMs: () => 1000,
      runIsolatedAgentJob: async () => ({
        status: "ok",
        summary: "same result",
        outputText: "same result",
      }),
      enqueueSystemEvent: (text) => events.push(text),
    })
    const job = makeJob({
      throttle: { dedupWindowMs: 60_000 },
    })
    state.store = { version: 1, jobs: [job] } as CronStoreFile

    // First run should succeed and deliver
    await executeJob(state, job, 1000, { forced: false })
    expect(job.state.lastStatus).toBe("ok")
    expect(events.length).toBe(1)

    // Reset state for second run
    job.state.nextRunAtMs = 500

    // Second run with same output should be throttled
    await executeJob(state, job, 1000, { forced: false })
    expect(job.state.lastStatus).toBe("throttled")
    // No additional event enqueued
    expect(events.length).toBe(1)
  })

  test("different output is not throttled", async () => {
    let callCount = 0
    const state = makeState({
      nowMs: () => 1000,
      runIsolatedAgentJob: async () => {
        callCount++
        return {
          status: "ok",
          summary: `result-${callCount}`,
          outputText: `result-${callCount}`,
        }
      },
      enqueueSystemEvent: () => {},
    })
    const job = makeJob({
      throttle: { dedupWindowMs: 60_000 },
    })
    state.store = { version: 1, jobs: [job] } as CronStoreFile

    await executeJob(state, job, 1000, { forced: false })
    expect(job.state.lastStatus).toBe("ok")

    job.state.nextRunAtMs = 500
    await executeJob(state, job, 1000, { forced: false })
    expect(job.state.lastStatus).toBe("ok")
  })

  test("output after dedup window expires is not throttled", async () => {
    let now = 1000
    const state = makeState({
      nowMs: () => now,
      runIsolatedAgentJob: async () => ({
        status: "ok",
        summary: "same",
        outputText: "same",
      }),
      enqueueSystemEvent: () => {},
    })
    const job = makeJob({
      throttle: { dedupWindowMs: 5_000 },
    })
    state.store = { version: 1, jobs: [job] } as CronStoreFile

    await executeJob(state, job, now, { forced: false })
    expect(job.state.lastStatus).toBe("ok")

    // Advance time past the window
    now = 7000
    job.state.nextRunAtMs = 500
    await executeJob(state, job, now, { forced: false })
    expect(job.state.lastStatus).toBe("ok")
  })

  test("error results are never throttled", async () => {
    const state = makeState({
      nowMs: () => 1000,
      runIsolatedAgentJob: async () => ({
        status: "error",
        error: "something broke",
      }),
      enqueueSystemEvent: () => {},
    })
    const job = makeJob({
      throttle: { dedupWindowMs: 60_000 },
    })
    state.store = { version: 1, jobs: [job] } as CronStoreFile

    await executeJob(state, job, 1000, { forced: false })
    expect(job.state.lastStatus).toBe("error")

    job.state.nextRunAtMs = 500
    await executeJob(state, job, 1000, { forced: false })
    // Errors should pass through, not be throttled
    expect(job.state.lastStatus).toBe("error")
  })
})
