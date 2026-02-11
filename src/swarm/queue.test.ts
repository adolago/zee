import { describe, expect, test } from "bun:test";
import { TaskQueue } from "./queue";

describe("TaskQueue", () => {
  test("orders by priority descending and FIFO within equal priority", () => {
    const queue = new TaskQueue({
      cap: 10,
      dropPolicy: "old",
      dedupeMode: "none",
    });

    queue.enqueue({
      id: "a",
      description: "low",
      prompt: "low",
      priority: 0,
      enqueuedAt: 1,
    });
    queue.enqueue({
      id: "b",
      description: "high",
      prompt: "high",
      priority: 5,
      enqueuedAt: 2,
    });
    queue.enqueue({
      id: "c",
      description: "high-2",
      prompt: "high-2",
      priority: 5,
      enqueuedAt: 3,
    });

    expect(queue.dequeue()?.id).toBe("b");
    expect(queue.dequeue()?.id).toBe("c");
    expect(queue.dequeue()?.id).toBe("a");
  });

  test("summarizes dropped tasks when queue overflows", () => {
    const queue = new TaskQueue({
      cap: 2,
      dropPolicy: "summarize",
      dedupeMode: "none",
      summaryLimit: 5,
    });

    queue.enqueue({
      id: "a",
      description: "first task",
      prompt: "first task",
      priority: 0,
      enqueuedAt: 1,
    });
    queue.enqueue({
      id: "b",
      description: "second task",
      prompt: "second task",
      priority: 0,
      enqueuedAt: 2,
    });
    const result = queue.enqueue({
      id: "c",
      description: "third task",
      prompt: "third task",
      priority: 0,
      enqueuedAt: 3,
    });

    expect(result.enqueued).toBe(true);
    expect(result.dropped.map((x) => x.id)).toEqual(["a"]);
    expect(queue.size).toBe(2);

    const summary = queue.consumeSummary("task");
    expect(summary).toContain("Dropped 1 task");
    expect(summary).toContain("first task");
  });

  test("rejects new tasks when policy is 'new'", () => {
    const queue = new TaskQueue({
      cap: 1,
      dropPolicy: "new",
      dedupeMode: "none",
    });

    queue.enqueue({
      id: "a",
      description: "first",
      prompt: "first",
      priority: 0,
      enqueuedAt: 1,
    });
    const result = queue.enqueue({
      id: "b",
      description: "second",
      prompt: "second",
      priority: 0,
      enqueuedAt: 2,
    });

    expect(result.enqueued).toBe(false);
    expect(result.deduped).toBe(false);
    expect(queue.size).toBe(1);
    expect(queue.dequeue()?.id).toBe("a");
  });

  test("dedupes by task id", () => {
    const queue = new TaskQueue({
      cap: 5,
      dedupeMode: "task-id",
      dropPolicy: "old",
    });

    queue.enqueue({
      id: "same",
      description: "task",
      prompt: "alpha",
      priority: 0,
      enqueuedAt: 1,
    });
    const result = queue.enqueue({
      id: "same",
      description: "task duplicate",
      prompt: "beta",
      priority: 3,
      enqueuedAt: 2,
    });

    expect(result.enqueued).toBe(false);
    expect(result.deduped).toBe(true);
    expect(queue.size).toBe(1);
    expect(queue.dequeue()?.prompt).toBe("alpha");
  });
});
