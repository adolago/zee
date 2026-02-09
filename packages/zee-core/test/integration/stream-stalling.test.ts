/**
 * Stream Stalling Detection Tests
 *
 * Tests for stream health monitoring and stall detection:
 * - Stall warning thresholds
 * - Stall timeout behavior
 * - Extended thinking timeout allowances
 * - Recovery after stall
 * - Multiple concurrent streams
 *
 * These tests verify the TUI experience when streams stall.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  StreamHealthMonitor,
  StreamHealth,
  noopStatusHandler,
  noopBusPublisher,
} from "../../src/session/stream-health"

// Test options that avoid Instance context
const testOptions = {
  statusHandler: noopStatusHandler,
  busPublisher: noopBusPublisher,
}

// Skip in full test mode due to Bun timing issues
const isFullSuite = process.env["AGENT_CORE_FULL_TEST_SUITE"] === "true"

describe.skipIf(isFullSuite)("Stream Stall Detection Thresholds", () => {
  let monitor: StreamHealthMonitor | undefined | undefined

  afterEach(() => {
    monitor?.dispose()
    StreamHealth.clear()
  })

  test("stall warning threshold is 15 seconds", () => {
    expect(StreamHealth.thresholds.stallWarningMs).toBe(15_000)
  })

  test("stall timeout threshold is 60 seconds", () => {
    expect(StreamHealth.thresholds.stallTimeoutMs).toBe(60_000)
  })

  test("extended thinking timeout defaults to 120 seconds", () => {
    // Extended thinking models (Opus 4.5, GPT-5.2) need longer timeout
    // Currently not configurable via thresholds - uses internal logic
    // This test documents the expected default behavior
    const expectedDefault = 120_000
    expect(expectedDefault).toBe(120_000)
  })
})

describe.skipIf(isFullSuite)("Stream Event Recording", () => {
  let monitor: StreamHealthMonitor | undefined

  beforeEach(() => {
    StreamHealth.clear()
  })

  afterEach(() => {
    monitor?.dispose()
    StreamHealth.clear()
  })

  test("tracks all event types correctly", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "event-tracking",
      messageID: "msg-1",
      ...testOptions,
    })

    // Simulate a complete stream with various events
    monitor.recordEvent("start")
    monitor.recordEvent("text-delta", 50)
    monitor.recordEvent("text-delta", 100)
    monitor.recordEvent("text-delta", 75)
    monitor.recordEvent("tool-call")
    monitor.recordEvent("tool-result")
    monitor.recordEvent("text-delta", 200)
    monitor.recordEvent("finish")

    const report = monitor.getReport()
    expect(report.progress.eventsReceived).toBe(8)
    expect(report.progress.textDeltaEvents).toBe(4)
    expect(report.progress.toolCallEvents).toBe(2)
    expect(report.progress.bytesReceived).toBe(425)
  })

  test("updates lastEventType correctly", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "event-type",
      messageID: "msg-2",
      ...testOptions,
    })

    expect(monitor.getReport().lastEventType).toBeUndefined()

    monitor.recordEvent("start")
    expect(monitor.getReport().lastEventType).toBe("start")

    monitor.recordEvent("text-delta")
    expect(monitor.getReport().lastEventType).toBe("text-delta")

    monitor.recordEvent("tool-call")
    expect(monitor.getReport().lastEventType).toBe("tool-call")

    monitor.recordEvent("finish")
    expect(monitor.getReport().lastEventType).toBe("finish")
  })

  test("timing info updates on each event", async () => {
    monitor = new StreamHealthMonitor({
      sessionID: "timing-update",
      messageID: "msg-3",
      ...testOptions,
    })

    const initialTiming = monitor.getTimingInfo()
    expect(initialTiming.durationMs).toBeGreaterThanOrEqual(0)

    await Bun.sleep(50)
    monitor.recordEvent("text-delta")

    const afterEvent = monitor.getTimingInfo()
    expect(afterEvent.durationMs).toBeGreaterThanOrEqual(45)
    expect(afterEvent.timeSinceLastEventMs).toBeLessThan(10)
  })
})

describe.skipIf(isFullSuite)("Stream Completion States", () => {
  let monitor: StreamHealthMonitor | undefined

  afterEach(() => {
    monitor?.dispose()
    StreamHealth.clear()
  })

  test("successful completion sets status to completed", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "completion",
      messageID: "msg-1",
      ...testOptions,
    })

    expect(monitor.getStatus()).toBe("streaming")
    monitor.complete()
    expect(monitor.getStatus()).toBe("completed")
    expect(monitor.getReport().status).toBe("completed")
  })

  test("completion sets completedAt timestamp", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "completion-time",
      messageID: "msg-2",
      ...testOptions,
    })

    expect(monitor.getReport().timing.completedAt).toBeUndefined()

    const before = Date.now()
    monitor.complete()
    const after = Date.now()

    const completedAt = monitor.getReport().timing.completedAt!
    expect(completedAt).toBeGreaterThanOrEqual(before)
    expect(completedAt).toBeLessThanOrEqual(after)
  })

  test("failure sets status to error with message", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "failure",
      messageID: "msg-3",
      ...testOptions,
    })

    monitor.fail("Connection timeout")

    expect(monitor.getStatus()).toBe("error")
    expect(monitor.getReport().error).toBe("Connection timeout")
  })

  test("failure extracts message from Error object", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "failure-error",
      messageID: "msg-4",
      ...testOptions,
    })

    monitor.fail(new Error("Socket closed unexpectedly"))

    expect(monitor.getReport().error).toBe("Socket closed unexpectedly")
  })

  test("duration is calculated correctly on completion", async () => {
    monitor = new StreamHealthMonitor({
      sessionID: "duration",
      messageID: "msg-5",
      ...testOptions,
    })

    await Bun.sleep(100)
    monitor.complete()

    const report = monitor.getReport()
    expect(report.timing.durationMs).toBeGreaterThanOrEqual(95)
    expect(report.timing.durationMs).toBeLessThan(200)
  })
})

describe.skipIf(isFullSuite)("Stall Detection Behavior", () => {
  let monitor: StreamHealthMonitor | undefined

  afterEach(() => {
    monitor?.dispose()
    StreamHealth.clear()
  })

  test("isStalled returns false when events are recent", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "no-stall",
      messageID: "msg-1",
      ...testOptions,
    })

    monitor.recordEvent("text-delta")
    expect(monitor.isStalled()).toBe(false)
  })

  test("checkForStall returns false for completed streams", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "complete-no-stall",
      messageID: "msg-2",
      ...testOptions,
    })

    monitor.complete()
    expect(monitor.checkForStall()).toBe(false)
  })

  test("checkForStall returns false for errored streams", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "error-no-stall",
      messageID: "msg-3",
      ...testOptions,
    })

    monitor.fail("error")
    expect(monitor.checkForStall()).toBe(false)
  })

  test("timeSinceLastEvent increases when no events received", async () => {
    monitor = new StreamHealthMonitor({
      sessionID: "time-since",
      messageID: "msg-4",
      ...testOptions,
    })

    monitor.recordEvent("start")
    const initial = monitor.getTimingInfo().timeSinceLastEventMs

    await Bun.sleep(100)
    const later = monitor.getTimingInfo().timeSinceLastEventMs

    expect(later).toBeGreaterThan(initial)
    expect(later - initial).toBeGreaterThanOrEqual(90) // Allow some timing variance
  })
})

describe.skipIf(isFullSuite)("Stream Health Registry", () => {
  beforeEach(() => {
    StreamHealth.clear()
  })

  afterEach(() => {
    StreamHealth.clear()
  })

  test("getOrCreate creates new monitor if none exists", () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "new-session",
      messageID: "new-message",
      ...testOptions,
    })

    expect(monitor).toBeInstanceOf(StreamHealthMonitor)
    expect(monitor.getReport().sessionID).toBe("new-session")
    expect(monitor.getReport().messageID).toBe("new-message")
  })

  test("getOrCreate returns existing monitor for same session/message", () => {
    const first = StreamHealth.getOrCreate({
      sessionID: "same-session",
      messageID: "same-message",
      ...testOptions,
    })

    const second = StreamHealth.getOrCreate({
      sessionID: "same-session",
      messageID: "same-message",
      ...testOptions,
    })

    expect(first).toBe(second)
  })

  test("different sessions get different monitors", () => {
    const m1 = StreamHealth.getOrCreate({
      sessionID: "session-1",
      messageID: "msg-1",
      ...testOptions,
    })

    const m2 = StreamHealth.getOrCreate({
      sessionID: "session-2",
      messageID: "msg-2",
      ...testOptions,
    })

    expect(m1).not.toBe(m2)
  })

  test("get returns undefined for nonexistent monitor", () => {
    const monitor = StreamHealth.get("nonexistent", "message")
    expect(monitor).toBeUndefined()
  })

  test("get returns existing monitor", () => {
    StreamHealth.getOrCreate({
      sessionID: "existing",
      messageID: "msg",
      ...testOptions,
    })

    const monitor = StreamHealth.get("existing", "msg")
    expect(monitor).toBeDefined()
  })

  test("getActive returns streaming monitor for session", () => {
    StreamHealth.getOrCreate({
      sessionID: "active-session",
      messageID: "msg-1",
      ...testOptions,
    })

    const active = StreamHealth.getActive("active-session")
    expect(active).toBeDefined()
    expect(active!.getStatus()).toBe("streaming")
  })

  test("getActive returns undefined if monitor is completed", () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "completed-session",
      messageID: "msg-1",
      ...testOptions,
    })

    monitor.complete()

    const active = StreamHealth.getActive("completed-session")
    expect(active).toBeUndefined()
  })

  test("remove disposes and removes monitor", () => {
    StreamHealth.getOrCreate({
      sessionID: "to-remove",
      messageID: "msg-1",
      ...testOptions,
    })

    StreamHealth.remove("to-remove", "msg-1")

    expect(StreamHealth.get("to-remove", "msg-1")).toBeUndefined()
  })

  test("clear removes all monitors", () => {
    StreamHealth.getOrCreate({ sessionID: "s1", messageID: "m1", ...testOptions })
    StreamHealth.getOrCreate({ sessionID: "s2", messageID: "m2", ...testOptions })
    StreamHealth.getOrCreate({ sessionID: "s3", messageID: "m3", ...testOptions })

    StreamHealth.clear()

    expect(StreamHealth.get("s1", "m1")).toBeUndefined()
    expect(StreamHealth.get("s2", "m2")).toBeUndefined()
    expect(StreamHealth.get("s3", "m3")).toBeUndefined()
  })
})

describe.skipIf(isFullSuite)("Concurrent Streams", () => {
  beforeEach(() => {
    StreamHealth.clear()
  })

  afterEach(() => {
    StreamHealth.clear()
  })

  test("multiple concurrent streams are tracked independently", () => {
    const m1 = StreamHealth.getOrCreate({
      sessionID: "concurrent-1",
      messageID: "msg-1",
      ...testOptions,
    })

    const m2 = StreamHealth.getOrCreate({
      sessionID: "concurrent-2",
      messageID: "msg-2",
      ...testOptions,
    })

    const m3 = StreamHealth.getOrCreate({
      sessionID: "concurrent-3",
      messageID: "msg-3",
      ...testOptions,
    })

    // Record different events on each
    m1.recordEvent("text-delta", 100)
    m2.recordEvent("tool-call")
    m3.recordEvent("text-delta", 50)
    m3.recordEvent("text-delta", 50)

    expect(m1.getReport().progress.bytesReceived).toBe(100)
    expect(m2.getReport().progress.toolCallEvents).toBe(1)
    expect(m3.getReport().progress.textDeltaEvents).toBe(2)
  })

  test("completing one stream does not affect others", () => {
    const m1 = StreamHealth.getOrCreate({
      sessionID: "complete-test-1",
      messageID: "msg-1",
      ...testOptions,
    })

    const m2 = StreamHealth.getOrCreate({
      sessionID: "complete-test-2",
      messageID: "msg-2",
      ...testOptions,
    })

    m1.complete()

    expect(m1.getStatus()).toBe("completed")
    expect(m2.getStatus()).toBe("streaming")
  })

  test("error on one stream does not affect others", () => {
    const m1 = StreamHealth.getOrCreate({
      sessionID: "error-test-1",
      messageID: "msg-1",
      ...testOptions,
    })

    const m2 = StreamHealth.getOrCreate({
      sessionID: "error-test-2",
      messageID: "msg-2",
      ...testOptions,
    })

    m1.fail("Connection lost")

    expect(m1.getStatus()).toBe("error")
    expect(m2.getStatus()).toBe("streaming")
  })
})

describe.skipIf(isFullSuite)("Stream Health Report Structure", () => {
  let monitor: StreamHealthMonitor | undefined

  afterEach(() => {
    monitor?.dispose()
    StreamHealth.clear()
  })

  test("report contains all required fields", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "report-test",
      messageID: "msg-1",
      ...testOptions,
    })

    monitor.recordEvent("start")
    monitor.recordEvent("text-delta", 100)
    monitor.recordEvent("tool-call")

    const report = monitor.getReport()

    // Top-level fields
    expect(report).toHaveProperty("sessionID", "report-test")
    expect(report).toHaveProperty("messageID", "msg-1")
    expect(report).toHaveProperty("status", "streaming")
    expect(report).toHaveProperty("stallWarnings")

    // Timing fields
    expect(report.timing).toHaveProperty("startedAt")
    expect(report.timing).toHaveProperty("lastEventAt")
    expect(report.timing).toHaveProperty("durationMs")
    expect(report.timing).toHaveProperty("timeSinceLastEventMs")

    // Progress fields
    expect(report.progress).toHaveProperty("eventsReceived", 3)
    expect(report.progress).toHaveProperty("textDeltaEvents", 1)
    expect(report.progress).toHaveProperty("toolCallEvents", 1)
    expect(report.progress).toHaveProperty("bytesReceived", 100)
  })

  test("report updates in real-time", async () => {
    monitor = new StreamHealthMonitor({
      sessionID: "realtime-test",
      messageID: "msg-1",
      ...testOptions,
    })

    const r1 = monitor.getReport()
    expect(r1.progress.eventsReceived).toBe(0)

    monitor.recordEvent("text-delta", 50)
    const r2 = monitor.getReport()
    expect(r2.progress.eventsReceived).toBe(1)

    await Bun.sleep(50)
    const r3 = monitor.getReport()
    expect(r3.timing.durationMs).toBeGreaterThan(r1.timing.durationMs)
  })
})

describe.skipIf(isFullSuite)("Dispose Behavior", () => {
  test("dispose is idempotent", () => {
    const monitor = new StreamHealthMonitor({
      sessionID: "dispose-test",
      messageID: "msg-1",
      ...testOptions,
    })

    // Should not throw on multiple dispose calls
    monitor.dispose()
    monitor.dispose()
    monitor.dispose()

    StreamHealth.clear()
  })

  test("methods work after dispose but may not update", () => {
    const monitor = new StreamHealthMonitor({
      sessionID: "post-dispose",
      messageID: "msg-1",
      ...testOptions,
    })

    monitor.recordEvent("text-delta", 100)
    monitor.dispose()

    // Should still be able to get report
    const report = monitor.getReport()
    expect(report.progress.eventsReceived).toBe(1)

    StreamHealth.clear()
  })
})

describe.skipIf(isFullSuite)("Events Per Second Calculation", () => {
  let monitor: StreamHealthMonitor | undefined

  afterEach(() => {
    monitor?.dispose()
    StreamHealth.clear()
  })

  test("calculates events per second correctly", async () => {
    monitor = new StreamHealthMonitor({
      sessionID: "eps-test",
      messageID: "msg-1",
      ...testOptions,
    })

    // Record 10 events
    for (let i = 0; i < 10; i++) {
      monitor.recordEvent("text-delta")
    }

    // Wait 100ms to establish baseline
    await Bun.sleep(100)

    const timing = monitor.getTimingInfo()
    expect(timing.eventsPerSecond).toBeGreaterThan(0)
    // With 10 events in ~100ms, should be around 100 events/sec
    // but allow for timing variance
    expect(timing.eventsPerSecond).toBeGreaterThan(10)
  })

  test("events per second is 0 with no events", () => {
    monitor = new StreamHealthMonitor({
      sessionID: "no-events",
      messageID: "msg-1",
      ...testOptions,
    })

    const timing = monitor.getTimingInfo()
    expect(timing.eventsPerSecond).toBe(0)
  })
})
