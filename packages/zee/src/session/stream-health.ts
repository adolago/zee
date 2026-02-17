import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { StreamEvents } from "./stream-events"
import { SessionStatus } from "./status"
import { getCurrentEmbeddingModel, getCurrentEmbeddingMaxContext } from "../../../../src/memory/stats"

const log = Log.create({ service: "stream.health" })

/**
 * Status handler interface for dependency injection.
 * This allows tests to provide a no-op implementation without mocking Instance.
 *
 * In production, the default handler delegates to SessionStatus.set().
 * In tests, a no-op handler can be provided to avoid Instance dependencies.
 */
export type StatusHandler = (sessionID: string, status: SessionStatus.Info) => void

/**
 * Bus publisher interface for dependency injection.
 * This allows tests to provide a no-op implementation without mocking Instance.
 *
 * In production, the default publisher delegates to Bus.publish().
 * In tests, a no-op publisher can be provided to avoid Instance dependencies.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BusPublisher = (event: any, data: any) => void

/**
 * Default status handler that delegates to SessionStatus.set().
 */
function getDefaultStatusHandler(): StatusHandler {
  return (sessionID, status) => SessionStatus.set(sessionID, status)
}

/**
 * Default bus publisher that delegates to Bus.publish().
 */
function getDefaultBusPublisher(): BusPublisher {
  return (event, data) => Bus.publish(event, data)
}

/**
 * No-op status handler for testing.
 * Use this when you don't have an Instance context.
 */
export const noopStatusHandler: StatusHandler = () => {}

/**
 * No-op bus publisher for testing.
 * Use this when you don't have an Instance context.
 */
export const noopBusPublisher: BusPublisher = () => {}

/**
 * Environment variable configuration for stream health thresholds.
 * These can be overridden via ZEE_STREAM_STALL_WARNING_MS and
 * ZEE_STREAM_STALL_TIMEOUT_MS environment variables.
 */
const DEFAULT_STALL_WARNING_MS = 15_000 // 15s without events = stall warning
const DEFAULT_STALL_TIMEOUT_MS = 60_000 // 60s without events = hard timeout
const DEFAULT_EARLY_STALL_MS = 5_000 // 5s without meaningful content = early warning
const DEFAULT_NO_CONTENT_TIMEOUT_MS = 120_000 // 2 min of reasoning without text/tool = timeout

// Extended timeouts for reasoning/thinking models (e.g., o1, claude-thinking, kimi-k2-thinking)
// These models may take significantly longer before producing any output
const REASONING_STALL_WARNING_MS = 60_000 // 1 min without events = stall warning
const REASONING_STALL_TIMEOUT_MS = 300_000 // 5 min without events = hard timeout
const REASONING_NO_CONTENT_TIMEOUT_MS = 600_000 // 10 min of reasoning without text/tool = timeout

export type StreamStatus = "streaming" | "completed" | "error" | "stalled" | "timeout"

export interface StreamHealthReport {
  sessionID: string
  messageID: string
  status: StreamStatus
  timing: {
    startedAt: number
    lastEventAt: number
    lastMeaningfulEventAt: number
    completedAt?: number
    durationMs: number
    timeSinceLastEventMs: number
    timeSinceMeaningfulEventMs: number
  }
  progress: {
    eventsReceived: number
    textDeltaEvents: number
    toolCallEvents: number
    bytesReceived: number
  }
  lastEventType?: string
  error?: string
  stallWarnings: number
}

/**
 * Options for creating a StreamHealthMonitor.
 */
export interface StreamHealthMonitorOptions {
  sessionID: string
  messageID: string
  /**
   * Active assistant turn id for this stream, used to preserve strict steering metadata.
   */
  activeTurnID?: string
  /**
   * Whether the model is a reasoning/thinking model.
   * If true, longer timeouts are used to accommodate extended thinking periods.
   */
  isReasoningModel?: boolean
  /**
   * Optional status handler for dependency injection.
   * Defaults to SessionStatus.set() which requires Instance context.
   * Pass `noopStatusHandler` for testing without Instance.
   */
  statusHandler?: StatusHandler
  /**
   * Optional bus publisher for dependency injection.
   * Defaults to Bus.publish() which requires Instance context.
   * Pass `noopBusPublisher` for testing without Instance.
   */
  busPublisher?: BusPublisher
}

/**
 * StreamHealthMonitor tracks the health and progress of an LLM stream.
 * It provides stall detection, progress tracking, and diagnostic reporting.
 *
 * ## Testing without Instance
 *
 * By default, the monitor calls `SessionStatus.set()` and `Bus.publish()` which
 * require an Instance context. For tests, pass the no-op handlers to avoid this:
 *
 * ```typescript
 * import { StreamHealthMonitor, noopStatusHandler, noopBusPublisher } from "./stream-health"
 *
 * const monitor = new StreamHealthMonitor({
 *   sessionID: "test",
 *   messageID: "msg",
 *   statusHandler: noopStatusHandler,
 *   busPublisher: noopBusPublisher,
 * })
 * ```
 */
export class StreamHealthMonitor {
  private sessionID: string
  private messageID: string
  private activeTurnID?: string
  private streamStartedAt: number
  private lastEventAt: number
  private lastEventType: string = ""
  private completedAt?: number

  // Progress tracking
  private eventsReceived: number = 0
  private textDeltaEvents: number = 0
  private toolCallEvents: number = 0
  private bytesReceived: number = 0
  private charsReceived: number = 0
  private phase: "starting" | "thinking" | "tool_calling" | "generating" = "starting"
  private requestCount: number = 1 // Start at 1 for the initial request

  /**
   * Helper to build streamHealth object with all fields.
   */
  private buildStreamHealth(overrides: {
    isStalled: boolean
    timeSinceLastEventMs: number
    isThinking?: boolean
    timeSinceContentMs?: number
  }): SessionStatus.StreamHealth {
    // Get embedding model info
    const embeddingModel = getCurrentEmbeddingModel()
    const embeddingMaxContext = getCurrentEmbeddingMaxContext()

    return {
      ...overrides,
      eventsReceived: this.eventsReceived,
      stallWarnings: this.stallWarnings,
      phase: this.phase,
      charsReceived: this.charsReceived,
      estimatedTokens: Math.floor(this.charsReceived / 4), // ~4 chars per token
      requestCount: this.requestCount,
      embeddingConfig: embeddingModel
        ? {
            model: embeddingModel,
            maxContext: embeddingMaxContext,
          }
        : undefined,
    }
  }

  // State
  private status: StreamStatus = "streaming"
  private errorMessage?: string
  private stallWarnings: number = 0

  // Tool execution tracking - pause stall detection while tools are running
  private activeTools: number = 0

  // Stall detection
  private stallWarningMs: number
  private stallTimeoutMs: number
  private noContentTimeoutMs: number
  private stallCheckTimer?: ReturnType<typeof setInterval>
  private stallWarningEmitted: boolean = false
  private earlyWarningEmitted: boolean = false
  private noContentWarningEmitted: boolean = false
  private lastMeaningfulEventAt: number
  private thinkingStatusEmitted: boolean = false
  private lastThinkingStatusAt: number = 0

  // Dependency injection
  private statusHandler: StatusHandler
  private busPublisher: BusPublisher

  constructor(input: StreamHealthMonitorOptions) {
    this.sessionID = input.sessionID
    this.messageID = input.messageID
    this.activeTurnID = input.activeTurnID
    this.streamStartedAt = Date.now()
    this.lastEventAt = Date.now()
    this.lastMeaningfulEventAt = Date.now()

    // Use provided handlers or defaults (which require Instance context)
    this.statusHandler = input.statusHandler ?? getDefaultStatusHandler()
    this.busPublisher = input.busPublisher ?? getDefaultBusPublisher()

    // Allow configuration via environment variables
    // Use extended timeouts for reasoning/thinking models
    const isReasoning = input.isReasoningModel ?? false
    this.stallWarningMs =
      Flag.ZEE_STREAM_STALL_WARNING_MS ?? (isReasoning ? REASONING_STALL_WARNING_MS : DEFAULT_STALL_WARNING_MS)
    this.stallTimeoutMs =
      Flag.ZEE_STREAM_STALL_TIMEOUT_MS ?? (isReasoning ? REASONING_STALL_TIMEOUT_MS : DEFAULT_STALL_TIMEOUT_MS)
    this.noContentTimeoutMs =
      Flag.ZEE_STREAM_NO_CONTENT_TIMEOUT_MS ??
      (isReasoning ? REASONING_NO_CONTENT_TIMEOUT_MS : DEFAULT_NO_CONTENT_TIMEOUT_MS)

    if (isReasoning) {
      log.info("using extended timeouts for reasoning model", {
        sessionID: this.sessionID,
        stallWarningMs: this.stallWarningMs,
        stallTimeoutMs: this.stallTimeoutMs,
        noContentTimeoutMs: this.noContentTimeoutMs,
      })
    }

    this.startStallDetection()
  }

  private emitBusyStatus(streamHealth: SessionStatus.StreamHealth): void {
    this.statusHandler(this.sessionID, {
      type: "busy",
      activeTurnID: this.activeTurnID,
      streamHealth,
    })
  }

  /**
   * Record that an event was received from the stream.
   * @param type - Event type
   * @param bytes - Optional byte count
   * @param chars - Optional character count for activity tracking
   */
  recordEvent(type: string, bytes?: number, chars?: number): void {
    this.lastEventAt = Date.now()
    this.lastEventType = type
    this.eventsReceived++

    if (bytes) {
      this.bytesReceived += bytes
    }
    if (chars) {
      this.charsReceived += chars
    }

    // Track specific event types for more detailed metrics
    // Also track meaningful content for extended thinking timeout detection
    const isReasoningEvent = type.startsWith("reasoning")
    const isMeaningfulContent =
      type === "text-delta" || type === "tool-call" || type === "tool-result" || isReasoningEvent
    if (type === "text-delta") {
      this.textDeltaEvents++
      this.phase = "generating"
    } else if (type === "tool-call" || type === "tool-result" || type === "tool-input-start") {
      this.toolCallEvents++
      this.phase = "tool_calling"
    } else if (isReasoningEvent) {
      // Only set to "thinking" if we haven't started generating or tool calling yet
      // Extended thinking models can have reasoning events interleaved with tools
      if (this.phase === "starting" || this.phase === "thinking") {
        this.phase = "thinking"
      }
    }

    // Update last meaningful event time when we receive actual content
    if (isMeaningfulContent) {
      this.lastMeaningfulEventAt = Date.now()
      this.noContentWarningEmitted = false
      this.thinkingStatusEmitted = false
    }

    // Emit early thinking status as soon as reasoning begins (before any content)
    if (isReasoningEvent && this.textDeltaEvents === 0 && this.toolCallEvents === 0) {
      const now = Date.now()
      if (!this.thinkingStatusEmitted || now - this.lastThinkingStatusAt >= 1000) {
        this.thinkingStatusEmitted = true
        this.lastThinkingStatusAt = now
        this.emitBusyStatus(
          this.buildStreamHealth({
            isStalled: false,
            isThinking: true,
            timeSinceLastEventMs: 0,
            timeSinceContentMs: now - this.lastMeaningfulEventAt,
          }),
        )
      }
    }

    // Reset stall warning state when we receive events
    // If we were stalled, immediately update status to clear the warning
    if (this.stallWarningEmitted) {
      this.emitBusyStatus(
        this.buildStreamHealth({
          isStalled: false,
          timeSinceLastEventMs: 0,
        }),
      )
    }
    this.stallWarningEmitted = false
  }

  /**
   * Check if the stream has stalled (no events within threshold).
   * Returns true if stalled.
   */
  checkForStall(): boolean {
    if (this.status !== "streaming") {
      return false
    }

    // Skip stall detection while tools are actively running
    if (this.activeTools > 0) {
      return false
    }

    const elapsed = Date.now() - this.lastEventAt

    // Check for hard timeout (no events at all)
    if (elapsed >= this.stallTimeoutMs) {
      this.status = "timeout"
      log.warn("stream timeout detected", {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsedMs: elapsed,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      // Emit timeout event so processor can abort the stream
      this.busPublisher(StreamEvents.Timeout, {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsed,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      return true
    }

    // Check for extended thinking without content timeout
    // This catches cases where reasoning events keep arriving but no actual output is produced
    // Common with extended thinking models (GPT-5.2 xhigh, kimi-k2-thinking, etc.)
    const elapsedSinceMeaningful = Date.now() - this.lastMeaningfulEventAt
    const isExtendedThinking = this.eventsReceived > 10 && elapsed < this.stallWarningMs // Getting events but no content
    if (isExtendedThinking && elapsedSinceMeaningful >= this.noContentTimeoutMs) {
      this.status = "timeout"
      log.warn("extended thinking timeout - no meaningful content", {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsedSinceMeaningfulMs: elapsedSinceMeaningful,
        totalEvents: this.eventsReceived,
        textEvents: this.textDeltaEvents,
        toolEvents: this.toolCallEvents,
        lastEventType: this.lastEventType,
      })

      this.busPublisher(StreamEvents.Timeout, {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsed: elapsedSinceMeaningful,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      return true
    }

    // Emit warning for extended thinking (reasoning without content) after 60s
    if (isExtendedThinking && elapsedSinceMeaningful >= this.stallTimeoutMs && !this.noContentWarningEmitted) {
      this.noContentWarningEmitted = true
      log.warn("extended thinking detected - reasoning without output", {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsedSinceMeaningfulMs: elapsedSinceMeaningful,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      this.emitBusyStatus(
        this.buildStreamHealth({
          isStalled: false,
          isThinking: true,
          timeSinceLastEventMs: elapsed,
          timeSinceContentMs: elapsedSinceMeaningful,
        }),
      )
    }

    // Check for early warning (no meaningful content after 5s)
    const elapsedSinceStart = Date.now() - this.streamStartedAt
    const hasNoContent = this.textDeltaEvents === 0 && this.toolCallEvents === 0
    if (elapsedSinceStart >= DEFAULT_EARLY_STALL_MS && hasNoContent && !this.earlyWarningEmitted) {
      this.earlyWarningEmitted = true
      log.warn("stream slow start detected - no content received", {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsedSinceStartMs: elapsedSinceStart,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      // Update session status with early warning
      this.emitBusyStatus(
        this.buildStreamHealth({
          isStalled: false,
          timeSinceLastEventMs: elapsed,
        }),
      )
    }

    // Check for stall warning
    if (elapsed >= this.stallWarningMs && !this.stallWarningEmitted) {
      this.stallWarnings++
      this.stallWarningEmitted = true

      log.warn("stream stall detected", {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsedMs: elapsed,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      this.busPublisher(StreamEvents.StallWarning, {
        sessionID: this.sessionID,
        messageID: this.messageID,
        elapsed,
        eventsReceived: this.eventsReceived,
        lastEventType: this.lastEventType,
      })

      // Update session status with stream health warning
      this.emitBusyStatus(
        this.buildStreamHealth({
          isStalled: true,
          timeSinceLastEventMs: elapsed,
        }),
      )

      return true
    }

    // Update session status with healthy stream info on every stall check (every 2s)
    // This ensures UI has fresh eventsReceived count for activity indicator
    if (this.eventsReceived > 0 && !this.stallWarningEmitted) {
      this.emitBusyStatus(
        this.buildStreamHealth({
          isStalled: false,
          timeSinceLastEventMs: elapsed,
        }),
      )
    }

    return false
  }

  /**
   * Mark the stream as completed successfully.
   */
  complete(): void {
    this.status = "completed"
    this.completedAt = Date.now()
    this.stopStallDetection()

    const report = this.getReport()

    // Detect suspicious completions (empty or near-empty responses)
    const isSuspicious =
      report.progress.eventsReceived < 5 || // Very few events
      (report.progress.textDeltaEvents === 0 && report.progress.toolCallEvents === 0) // No content

    if (isSuspicious) {
      log.warn("stream completed with suspicious metrics", {
        sessionID: this.sessionID,
        durationMs: report.timing.durationMs,
        eventsReceived: report.progress.eventsReceived,
        textDeltaEvents: report.progress.textDeltaEvents,
        toolCallEvents: report.progress.toolCallEvents,
      })
    } else {
      log.info("stream completed", {
        sessionID: this.sessionID,
        durationMs: report.timing.durationMs,
        eventsReceived: report.progress.eventsReceived,
      })
    }

    this.busPublisher(StreamEvents.Completed, {
      sessionID: this.sessionID,
      messageID: this.messageID,
      report,
    })
  }

  /**
   * Mark the stream as failed with an error.
   */
  fail(error: Error | string): void {
    this.status = "error"
    this.errorMessage = error instanceof Error ? error.message : error
    this.completedAt = Date.now()
    this.stopStallDetection()

    const report = this.getReport()
    log.error("stream failed", {
      sessionID: this.sessionID,
      error: this.errorMessage,
      durationMs: report.timing.durationMs,
      eventsReceived: report.progress.eventsReceived,
    })

    this.busPublisher(StreamEvents.Failed, {
      sessionID: this.sessionID,
      messageID: this.messageID,
      report,
      error: this.errorMessage,
    })
  }

  /**
   * Get the current stream health report.
   */
  getReport(): StreamHealthReport {
    const now = Date.now()
    const completedAt = this.completedAt ?? now
    const durationMs = completedAt - this.streamStartedAt
    const timeSinceLastEventMs = now - this.lastEventAt
    const timeSinceMeaningfulEventMs = now - this.lastMeaningfulEventAt

    return {
      sessionID: this.sessionID,
      messageID: this.messageID,
      status: this.status,
      timing: {
        startedAt: this.streamStartedAt,
        lastEventAt: this.lastEventAt,
        lastMeaningfulEventAt: this.lastMeaningfulEventAt,
        completedAt: this.completedAt,
        durationMs,
        timeSinceLastEventMs,
        timeSinceMeaningfulEventMs,
      },
      progress: {
        eventsReceived: this.eventsReceived,
        textDeltaEvents: this.textDeltaEvents,
        toolCallEvents: this.toolCallEvents,
        bytesReceived: this.bytesReceived,
      },
      lastEventType: this.lastEventType || undefined,
      error: this.errorMessage,
      stallWarnings: this.stallWarnings,
    }
  }

  /**
   * Get current timing information for status display.
   */
  getTimingInfo(): { durationMs: number; timeSinceLastEventMs: number; eventsPerSecond: number } {
    const now = Date.now()
    const durationMs = now - this.streamStartedAt
    const timeSinceLastEventMs = now - this.lastEventAt
    const eventsPerSecond = durationMs > 0 ? (this.eventsReceived / durationMs) * 1000 : 0

    return {
      durationMs,
      timeSinceLastEventMs,
      eventsPerSecond,
    }
  }

  /**
   * Check if the stream is currently stalled (warning threshold exceeded).
   */
  isStalled(): boolean {
    if (this.status !== "streaming") {
      return false
    }
    return Date.now() - this.lastEventAt >= this.stallWarningMs
  }

  /**
   * Mark that a tool has started executing.
   * Stall detection is paused while tools are running.
   */
  toolStarted(): void {
    this.activeTools++
    // Reset last event time so we do not accumulate stall time during tool execution
    this.lastEventAt = Date.now()
  }

  /**
   * Mark that a tool has finished executing.
   * Stall detection resumes when all tools complete.
   */
  toolCompleted(): void {
    this.activeTools = Math.max(0, this.activeTools - 1)
    // Reset last event time after tool completion
    this.lastEventAt = Date.now()
  }

  /**
   * Check if tools are currently running.
   */
  hasActiveTools(): boolean {
    return this.activeTools > 0
  }

  /**
   * Get the current status.
   */
  getStatus(): StreamStatus {
    return this.status
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.stopStallDetection()
  }

  private startStallDetection(): void {
    // Check for stalls every 2 seconds
    this.stallCheckTimer = setInterval(() => {
      this.checkForStall()
    }, 2000)
  }

  private stopStallDetection(): void {
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer)
      this.stallCheckTimer = undefined
    }
  }
}

/**
 * Instance state for tracking active stream health monitors per session.
 */
const activeMonitors = new Map<string, StreamHealthMonitor>()

export namespace StreamHealth {
  /**
   * Get or create a health monitor for a session.
   *
   * @param input.statusHandler - Optional status handler for dependency injection.
   *   Pass `noopStatusHandler` for testing without Instance context.
   */
  export function getOrCreate(input: StreamHealthMonitorOptions): StreamHealthMonitor {
    const key = `${input.sessionID}:${input.messageID}`
    let monitor = activeMonitors.get(key)
    if (!monitor) {
      monitor = new StreamHealthMonitor(input)
      activeMonitors.set(key, monitor)
    }
    return monitor
  }

  /**
   * Get an existing health monitor for a session.
   */
  export function get(sessionID: string, messageID: string): StreamHealthMonitor | undefined {
    return activeMonitors.get(`${sessionID}:${messageID}`)
  }

  /**
   * Get the most recent active monitor for a session (by any message).
   */
  export function getActive(sessionID: string): StreamHealthMonitor | undefined {
    for (const [key, monitor] of activeMonitors) {
      if (key.startsWith(`${sessionID}:`) && monitor.getStatus() === "streaming") {
        return monitor
      }
    }
    return undefined
  }

  /**
   * Remove a health monitor.
   */
  export function remove(sessionID: string, messageID: string): void {
    const key = `${sessionID}:${messageID}`
    const monitor = activeMonitors.get(key)
    if (monitor) {
      monitor.dispose()
      activeMonitors.delete(key)
    }
  }

  /**
   * Clear all monitors and reset internal state.
   */
  export function clear(): void {
    for (const monitor of activeMonitors.values()) {
      monitor.dispose()
    }
    activeMonitors.clear()
  }

  /**
   * Configuration thresholds.
   */
  export const thresholds = {
    get stallWarningMs() {
      return Flag.ZEE_STREAM_STALL_WARNING_MS ?? DEFAULT_STALL_WARNING_MS
    },
    get stallTimeoutMs() {
      return Flag.ZEE_STREAM_STALL_TIMEOUT_MS ?? DEFAULT_STALL_TIMEOUT_MS
    },
  }
}
