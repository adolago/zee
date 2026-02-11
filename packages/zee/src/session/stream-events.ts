import { BusEvent } from "@/bus/bus-event"
import z from "zod"

/**
 * Stream diagnostic events for observability.
 * These events are published when stream health issues are detected.
 */
export namespace StreamEvents {
  /**
   * Schema for the stream health report.
   */
  export const StreamHealthReport = z.object({
    sessionID: z.string(),
    messageID: z.string(),
    status: z.enum(["streaming", "completed", "error", "stalled", "timeout"]),
    timing: z.object({
      startedAt: z.number(),
      lastEventAt: z.number(),
      completedAt: z.number().optional(),
      durationMs: z.number(),
      timeSinceLastEventMs: z.number(),
    }),
    progress: z.object({
      eventsReceived: z.number(),
      textDeltaEvents: z.number(),
      toolCallEvents: z.number(),
      bytesReceived: z.number(),
    }),
    lastEventType: z.string().optional(),
    error: z.string().optional(),
    stallWarnings: z.number(),
  })
  export type StreamHealthReport = z.infer<typeof StreamHealthReport>

  /**
   * Emitted when a stream stall is detected (no events received within threshold).
   */
  export const StallWarning = BusEvent.define(
    "stream.stall.warning",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      elapsed: z.number(),
      eventsReceived: z.number(),
      lastEventType: z.string().optional(),
    }),
  )

  /**
   * Emitted when a stream completes successfully.
   */
  export const Completed = BusEvent.define(
    "stream.completed",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      report: StreamHealthReport,
    }),
  )

  /**
   * Emitted when a stream fails with an error.
   */
  export const Failed = BusEvent.define(
    "stream.failed",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      report: StreamHealthReport,
      error: z.string(),
    }),
  )

  /**
   * Emitted periodically to report stream health status.
   * Can be used by the TUI to update the status bar.
   */
  export const HealthUpdate = BusEvent.define(
    "stream.health.update",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      durationMs: z.number(),
      eventsReceived: z.number(),
      eventsPerSecond: z.number(),
      timeSinceLastEventMs: z.number(),
      isStalled: z.boolean(),
    }),
  )

  /**
   * Emitted when a stream timeout is detected (no events received within hard timeout threshold).
   * Subscribers should abort the stream to prevent indefinite hangs.
   */
  export const Timeout = BusEvent.define(
    "stream.timeout",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      elapsed: z.number(),
      eventsReceived: z.number(),
      lastEventType: z.string().optional(),
    }),
  )
}
