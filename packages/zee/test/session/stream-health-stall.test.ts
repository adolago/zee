import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  StreamHealthMonitor,
  StreamHealth,
  noopStatusHandler,
  noopBusPublisher,
} from "../../src/session/stream-health"

/**
 * Test options that avoid Instance context.
 * Pass these to StreamHealthMonitor and StreamHealth.getOrCreate().
 */
const testOptions = {
  statusHandler: noopStatusHandler,
  busPublisher: noopBusPublisher,
}

/**
 * Stream health stall detection tests using dependency injection.
 *
 * These tests use `noopStatusHandler` instead of mocking the Instance module.
 * This avoids global state pollution from mock.module() which affected other
 * test files in the same process.
 *
 * Note: Bus event subscription is not tested here because it requires Instance
 * context. Event emission is tested in integration tests that have a full
 * Instance context.
 */

describe("StreamHealth stall detection with timing", () => {
  beforeEach(() => {
    StreamHealth.clear()
  })

  afterEach(() => {
    StreamHealth.clear()
  })

  test("isStalled returns false immediately after event", () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "stall-test",
      messageID: "msg-1",
      ...testOptions,
    })

    monitor.recordEvent("start")

    // Immediately after recording, should not be stalled
    expect(monitor.isStalled()).toBe(false)
    expect(monitor.getReport().stallWarnings).toBe(0)

    monitor.dispose()
  })

  test("records events prevent stall detection", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "no-stall-test",
      messageID: "msg-2",
      ...testOptions,
    })

    // Continuously record events
    const interval = setInterval(() => {
      monitor.recordEvent("text-delta")
    }, 50)

    await Bun.sleep(500)
    clearInterval(interval)

    // Should not be stalled because we kept recording events
    expect(monitor.isStalled()).toBe(false)
    expect(monitor.getReport().stallWarnings).toBe(0)

    monitor.dispose()
  })

  test("checkForStall returns false when under threshold", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "counter-test",
      messageID: "msg-3",
      ...testOptions,
    })

    monitor.recordEvent("start")
    expect(monitor.getReport().stallWarnings).toBe(0)

    // Wait a short time (well under 15s threshold)
    await Bun.sleep(100)
    const result = monitor.checkForStall()

    // Should not be stalled yet
    expect(result).toBe(false)
    expect(monitor.getReport().stallWarnings).toBe(0)

    monitor.dispose()
  })

  test("recording events resets timing", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "reset-test",
      messageID: "msg-4",
      ...testOptions,
    })

    monitor.recordEvent("start")
    await Bun.sleep(100)

    const timing1 = monitor.getTimingInfo()
    expect(timing1.timeSinceLastEventMs).toBeGreaterThanOrEqual(90)

    // Record another event - should reset timeSinceLastEvent
    monitor.recordEvent("text-delta")
    const timing2 = monitor.getTimingInfo()

    expect(timing2.timeSinceLastEventMs).toBeLessThan(50) // Should be nearly 0

    monitor.dispose()
  })

  test("completed stream does not trigger stall", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "completed-test",
      messageID: "msg-5",
      ...testOptions,
    })

    monitor.recordEvent("start")
    monitor.complete()

    // Wait a bit
    await Bun.sleep(100)

    // Should not detect stall because stream is completed
    expect(monitor.checkForStall()).toBe(false)
    expect(monitor.getStatus()).toBe("completed")

    monitor.dispose()
  })

  test("failed stream does not trigger stall", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "failed-test",
      messageID: "msg-6",
      ...testOptions,
    })

    monitor.recordEvent("start")
    monitor.fail("Test error")

    // Wait a bit
    await Bun.sleep(100)

    // Should not detect stall because stream failed
    expect(monitor.checkForStall()).toBe(false)
    expect(monitor.getStatus()).toBe("error")

    monitor.dispose()
  })

  test("getTimingInfo tracks time accurately", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "timing-test",
      messageID: "msg-7",
      ...testOptions,
    })

    monitor.recordEvent("start")
    const timing1 = monitor.getTimingInfo()

    await Bun.sleep(100)

    const timing2 = monitor.getTimingInfo()

    // Duration should increase
    expect(timing2.durationMs).toBeGreaterThan(timing1.durationMs)
    expect(timing2.durationMs - timing1.durationMs).toBeGreaterThanOrEqual(90)

    // Time since last event should also increase
    expect(timing2.timeSinceLastEventMs).toBeGreaterThan(timing1.timeSinceLastEventMs)

    monitor.dispose()
  })

  test("events per second calculation", async () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "eps-test",
      messageID: "msg-8",
      ...testOptions,
    })

    // Record 20 events quickly
    for (let i = 0; i < 20; i++) {
      monitor.recordEvent("text-delta")
    }

    await Bun.sleep(100)

    const timing = monitor.getTimingInfo()

    // Should have a high events per second rate
    expect(timing.eventsPerSecond).toBeGreaterThan(50) // 20 events in ~100ms = ~200/s

    monitor.dispose()
  })

  test("stall thresholds are exposed", () => {
    // Verify defaults (without env overrides)
    expect(StreamHealth.thresholds.stallWarningMs).toBe(15_000)
    expect(StreamHealth.thresholds.stallTimeoutMs).toBe(60_000)
  })
})

describe("StreamHealth report generation", () => {
  beforeEach(() => {
    StreamHealth.clear()
  })

  afterEach(() => {
    StreamHealth.clear()
  })

  test("report includes all timing information", () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "report-test",
      messageID: "msg-9",
      ...testOptions,
    })

    monitor.recordEvent("start")
    monitor.recordEvent("text-delta", 150)
    monitor.recordEvent("tool-call")
    monitor.complete()

    const report = monitor.getReport()

    // Verify structure
    expect(report.timing.startedAt).toBeTypeOf("number")
    expect(report.timing.lastEventAt).toBeTypeOf("number")
    expect(report.timing.completedAt).toBeTypeOf("number")
    expect(report.timing.durationMs).toBeTypeOf("number")
    expect(report.timing.timeSinceLastEventMs).toBeTypeOf("number")

    // Verify ordering
    expect(report.timing.lastEventAt).toBeGreaterThanOrEqual(report.timing.startedAt)
    expect(report.timing.completedAt).toBeGreaterThanOrEqual(report.timing.lastEventAt)

    monitor.dispose()
  })

  test("report includes accurate progress counters", () => {
    const monitor = StreamHealth.getOrCreate({
      sessionID: "progress-test",
      messageID: "msg-10",
      ...testOptions,
    })

    // Simulate a realistic stream
    monitor.recordEvent("start")
    monitor.recordEvent("text-delta", 50)
    monitor.recordEvent("text-delta", 75)
    monitor.recordEvent("text-delta", 100)
    monitor.recordEvent("tool-call")
    monitor.recordEvent("tool-result")
    monitor.recordEvent("text-delta", 25)
    monitor.recordEvent("finish")

    const report = monitor.getReport()

    expect(report.progress.eventsReceived).toBe(8)
    expect(report.progress.textDeltaEvents).toBe(4)
    expect(report.progress.toolCallEvents).toBe(2) // tool-call + tool-result
    expect(report.progress.bytesReceived).toBe(250) // 50 + 75 + 100 + 25

    monitor.dispose()
  })
})
