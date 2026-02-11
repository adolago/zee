import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import { loadCronStore } from "./store.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-cron-migrate-"));
  return {
    dir,
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe("cron store migration", () => {
  beforeEach(() => {
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("migrates legacy cron schedule fields (cron/timezone) and jobId to id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-06T06:00:00.000Z"));

    const store = await makeStorePath();
    const legacyJob = {
      jobId: "morning-briefing",
      name: "Morning briefing",
      enabled: true,
      schedule: { kind: "cron", cron: "0 7 * * *", timezone: "UTC" },
      sessionTarget: "isolated",
      payload: {
        kind: "agentTurn",
        message: "hi",
      },
      state: {},
      delivery: { mode: "announce", channel: "whatsapp", to: "+123" },
    };
    await fs.mkdir(path.dirname(store.storePath), { recursive: true });
    await fs.writeFile(store.storePath, JSON.stringify({ version: 1, jobs: [legacyJob] }, null, 2));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    });

    await cron.start();
    cron.stop();

    const loaded = await loadCronStore(store.storePath);
    const migrated = loaded.jobs[0] as Record<string, unknown>;

    expect(migrated.id).toBe("morning-briefing");
    expect("jobId" in migrated).toBe(false);
    expect(migrated.createdAtMs).toEqual(expect.any(Number));
    expect(migrated.updatedAtMs).toEqual(expect.any(Number));
    expect(migrated.wakeMode).toBe("next-heartbeat");

    const schedule = migrated.schedule as Record<string, unknown>;
    expect(schedule.kind).toBe("cron");
    expect(schedule.expr).toBe("0 7 * * *");
    expect(schedule.tz).toBe("UTC");
    expect("cron" in schedule).toBe(false);
    expect("timezone" in schedule).toBe(false);

    const state = migrated.state as Record<string, unknown>;
    expect(typeof state.nextRunAtMs).toBe("number");
    expect((state.nextRunAtMs as number) > Date.parse("2026-02-06T06:00:00.000Z")).toBe(true);

    await store.cleanup();
  });

  it("migrates isolated jobs to announce delivery and drops isolation", async () => {
    const store = await makeStorePath();
    const atMs = 1_700_000_000_000;
    const legacyJob = {
      id: "job-1",
      agentId: undefined,
      name: "Legacy job",
      description: null,
      enabled: true,
      deleteAfterRun: false,
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_000_000,
      schedule: { kind: "at", atMs },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "agentTurn",
        message: "hi",
        deliver: true,
        channel: "whatsapp",
        to: "7200373102",
        bestEffortDeliver: true,
      },
      isolation: { postToMainPrefix: "Cron" },
      state: {},
    };
    await fs.mkdir(path.dirname(store.storePath), { recursive: true });
    await fs.writeFile(store.storePath, JSON.stringify({ version: 1, jobs: [legacyJob] }, null, 2));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    });

    await cron.start();
    cron.stop();

    const loaded = await loadCronStore(store.storePath);
    const migrated = loaded.jobs[0] as Record<string, unknown>;
    expect(migrated.delivery).toEqual({
      mode: "announce",
      channel: "whatsapp",
      to: "7200373102",
      bestEffort: true,
    });
    expect("isolation" in migrated).toBe(false);

    const payload = migrated.payload as Record<string, unknown>;
    expect(payload.deliver).toBeUndefined();
    expect(payload.channel).toBeUndefined();
    expect(payload.to).toBeUndefined();
    expect(payload.bestEffortDeliver).toBeUndefined();

    const schedule = migrated.schedule as Record<string, unknown>;
    expect(schedule.kind).toBe("at");
    expect(schedule.at).toBe(new Date(atMs).toISOString());

    await store.cleanup();
  });

  it("adds anchorMs to legacy every schedules", async () => {
    const store = await makeStorePath();
    const createdAtMs = 1_700_000_000_000;
    const legacyJob = {
      id: "job-every-legacy",
      agentId: undefined,
      name: "Legacy every",
      description: null,
      enabled: true,
      deleteAfterRun: false,
      createdAtMs,
      updatedAtMs: createdAtMs,
      schedule: { kind: "every", everyMs: 120_000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "systemEvent",
        text: "tick",
      },
      state: {},
    };
    await fs.mkdir(path.dirname(store.storePath), { recursive: true });
    await fs.writeFile(store.storePath, JSON.stringify({ version: 1, jobs: [legacyJob] }, null, 2));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" })),
    });

    await cron.start();
    cron.stop();

    const loaded = await loadCronStore(store.storePath);
    const migrated = loaded.jobs[0] as Record<string, unknown>;
    const schedule = migrated.schedule as Record<string, unknown>;
    expect(schedule.kind).toBe("every");
    expect(schedule.anchorMs).toBe(createdAtMs);

    await store.cleanup();
  });
});
