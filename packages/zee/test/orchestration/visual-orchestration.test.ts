import { describe, expect, test } from "bun:test"
import {
  EventStreamVisualOrchestrationSink,
  resolveVisualConfig,
  type OrchestrationVisualEvent,
} from "@root/orchestration-visual"

describe("visual orchestration contracts", () => {
  test("resolveVisualConfig defaults to event mode", () => {
    const resolved = resolveVisualConfig()
    expect(resolved).toEqual({
      enabled: true,
      mode: "events",
      backend: undefined,
    })
  })

  test("event stream sink forwards events", async () => {
    const events: OrchestrationVisualEvent[] = []
    const sink = new EventStreamVisualOrchestrationSink({
      onEvent: (event) => {
        events.push(event)
      },
    })

    await sink.emit({
      type: "task_started",
      timestamp: Date.now(),
      swarmId: "swarm-1",
      taskId: "task-1",
      workerId: "worker-1",
      details: { attempt: 1 },
    })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("task_started")
    expect(events[0].taskId).toBe("task-1")
  })
})
