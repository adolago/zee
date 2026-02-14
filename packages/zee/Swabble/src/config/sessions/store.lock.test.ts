import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sleep } from "../../utils.js";
import type { SessionEntry } from "./types.js";
import {
  clearSessionStoreCacheForTest,
  getSessionStoreLockQueueSizeForTest,
  loadSessionStore,
  updateSessionStore,
  updateSessionStoreEntry,
  withSessionStoreLockForTest,
} from "./store.js";

describe("session store lock queue", () => {
  let tmpDirs: string[] = [];

  async function makeTmpStore(
    initial: Record<string, unknown> = {},
  ): Promise<{ dir: string; storePath: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-lock-test-"));
    tmpDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    if (Object.keys(initial).length > 0) {
      await fs.writeFile(storePath, JSON.stringify(initial, null, 2), "utf-8");
    }
    return { dir, storePath };
  }

  afterEach(async () => {
    clearSessionStoreCacheForTest();
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    tmpDirs = [];
  });

  it("serializes concurrent updates without data loss", async () => {
    const key = "agent:main:test";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s1", updatedAt: 100, counter: 0 },
    });

    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () =>
        updateSessionStore(storePath, async (store) => {
          const entry = store[key] as Record<string, unknown>;
          await sleep(Math.random() * 10);
          entry.counter = (entry.counter as number) + 1;
        }),
      ),
    );

    const store = loadSessionStore(storePath);
    expect((store[key] as Record<string, unknown>).counter).toBe(N);
  });

  it("merges concurrent updateSessionStoreEntry patches", async () => {
    const key = "agent:main:merge";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s1", updatedAt: 100 },
    });

    await Promise.all([
      updateSessionStoreEntry({
        storePath,
        sessionKey: key,
        update: async () => {
          await sleep(25);
          return { modelOverride: "model-a" };
        },
      }),
      updateSessionStoreEntry({
        storePath,
        sessionKey: key,
        update: async () => {
          await sleep(10);
          return { thinkingLevel: "high" };
        },
      }),
      updateSessionStoreEntry({
        storePath,
        sessionKey: key,
        update: async () => {
          await sleep(15);
          return { systemPromptOverride: "custom" };
        },
      }),
    ]);

    const store = loadSessionStore(storePath);
    const entry = store[key];
    expect(entry.modelOverride).toBe("model-a");
    expect(entry.thinkingLevel).toBe("high");
    expect(entry.systemPromptOverride).toBe("custom");
  });

  it("continues queue processing after a task throws", async () => {
    const key = "agent:main:err";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s1", updatedAt: 100 },
    });

    const errorPromise = updateSessionStore(storePath, async () => {
      throw new Error("boom");
    });
    const successPromise = updateSessionStore(storePath, async (store) => {
      store[key] = { ...store[key], modelOverride: "after-error" } as SessionEntry;
    });

    await expect(errorPromise).rejects.toThrow("boom");
    await successPromise;

    const store = loadSessionStore(storePath);
    expect(store[key]?.modelOverride).toBe("after-error");
  });

  it("runs different store paths in parallel", async () => {
    const { storePath: pathA } = await makeTmpStore({
      a: { sessionId: "a", updatedAt: 100 },
    });
    const { storePath: pathB } = await makeTmpStore({
      b: { sessionId: "b", updatedAt: 100 },
    });

    const order: string[] = [];
    const opA = updateSessionStore(pathA, async (store) => {
      order.push("a-start");
      await sleep(50);
      store.a = { ...store.a, modelOverride: "done-a" } as SessionEntry;
      order.push("a-end");
    });
    const opB = updateSessionStore(pathB, async (store) => {
      order.push("b-start");
      await sleep(10);
      store.b = { ...store.b, modelOverride: "done-b" } as SessionEntry;
      order.push("b-end");
    });
    await Promise.all([opA, opB]);

    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
    expect(loadSessionStore(pathA).a?.modelOverride).toBe("done-a");
    expect(loadSessionStore(pathB).b?.modelOverride).toBe("done-b");
  });

  it("cleans queue state after completion and after errors", async () => {
    const { storePath } = await makeTmpStore({
      x: { sessionId: "x", updatedAt: 100 },
    });

    await updateSessionStore(storePath, async (store) => {
      store.x = { ...store.x, modelOverride: "done" } as SessionEntry;
    });
    await sleep(0);
    expect(getSessionStoreLockQueueSizeForTest()).toBe(0);

    await updateSessionStore(storePath, async () => {
      throw new Error("fail");
    }).catch(() => undefined);
    await sleep(0);
    expect(getSessionStoreLockQueueSizeForTest()).toBe(0);
  });

  it("enforces FIFO order", async () => {
    const key = "agent:main:fifo";
    const { storePath } = await makeTmpStore({
      [key]: { sessionId: "s1", updatedAt: 100, order: "" },
    });

    const executionOrder: number[] = [];
    const promises = Array.from({ length: 5 }, (_, i) =>
      updateSessionStore(storePath, async (store) => {
        executionOrder.push(i);
        const entry = store[key] as Record<string, unknown>;
        entry.order = `${(entry.order as string) || ""}${i}`;
      }),
    );
    await Promise.all(promises);

    expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
    const store = loadSessionStore(storePath);
    expect((store[key] as Record<string, unknown>).order).toBe("01234");
  });

  it("times out waiting tasks and never runs them later", async () => {
    const { storePath } = await makeTmpStore({
      x: { sessionId: "x", updatedAt: 100 },
    });
    let timedOutRan = false;

    const lockHolder = withSessionStoreLockForTest(
      storePath,
      async () => {
        await sleep(80);
      },
      { timeoutMs: 2_000 },
    );
    const timedOut = withSessionStoreLockForTest(
      storePath,
      async () => {
        timedOutRan = true;
      },
      { timeoutMs: 20 },
    );

    await expect(timedOut).rejects.toThrow("timeout waiting for session store lock");
    await lockHolder;
    await sleep(30);
    expect(timedOutRan).toBe(false);
  });
});
