import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPendingToolResultsAfterIdle } from "./pi-embedded-runner/wait-for-idle-before-flush.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type FakeSessionManager = {
  flushed: number;
  flushPendingToolResults: () => void;
};

function createSessionManager(): FakeSessionManager {
  return {
    flushed: 0,
    flushPendingToolResults() {
      this.flushed += 1;
    },
  };
}

describe("flushPendingToolResultsAfterIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for idle before flush", async () => {
    const idle = deferred<void>();
    const sessionManager = createSessionManager();

    const flushPromise = flushPendingToolResultsAfterIdle({
      agent: { waitForIdle: () => idle.promise },
      sessionManager,
      timeoutMs: 1_000,
    });

    await Promise.resolve();
    expect(sessionManager.flushed).toBe(0);

    idle.resolve();
    await flushPromise;

    expect(sessionManager.flushed).toBe(1);
  });

  it("flushes after timeout when idle never resolves", async () => {
    vi.useFakeTimers();
    const sessionManager = createSessionManager();

    const flushPromise = flushPendingToolResultsAfterIdle({
      agent: { waitForIdle: () => new Promise<void>(() => {}) },
      sessionManager,
      timeoutMs: 30,
    });

    await vi.advanceTimersByTimeAsync(30);
    await flushPromise;

    expect(sessionManager.flushed).toBe(1);
  });

  it("clears timeout handle when waitForIdle resolves first", async () => {
    vi.useFakeTimers();
    const sessionManager = createSessionManager();

    await flushPendingToolResultsAfterIdle({
      agent: { waitForIdle: async () => {} },
      sessionManager,
      timeoutMs: 30_000,
    });

    expect(sessionManager.flushed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
