// HeartbeatRunner - periodic heartbeat execution with delivery.

import fs from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import { isHeartbeatContentEffectivelyEmpty, resolveHeartbeatPrompt } from "./heartbeat"
import { isHeartbeatAck, stripHeartbeatAck } from "./tokens"
import { type HeartbeatConfig, isWithinActiveHours, resolveHeartbeatConfig } from "./config"
import { deliverHeartbeatResult, type DeliveryTarget } from "./delivery"

const log = Log.create({ service: "heartbeat" })

export type HeartbeatRunResult = {
  status: "ran" | "skipped" | "error"
  reason?: string
}

export type HeartbeatRunnerDeps = {
  /** Base URL for the agent-core server. */
  serverUrl: string
  /** Working directory to find HEARTBEAT.md in. */
  directory: string
  /** Raw heartbeat config from zee.json. */
  config?: {
    enabled?: boolean
    every?: string
    prompt?: string
    model?: string
    activeHours?: { start: string; end: string; timezone?: string }
  }
  /** Default messaging delivery target. */
  deliveryChannel?: string
  deliveryTo?: string
}

export class HeartbeatRunner {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly config: HeartbeatConfig
  private readonly deps: HeartbeatRunnerDeps

  constructor(deps: HeartbeatRunnerDeps) {
    this.deps = deps
    this.config = resolveHeartbeatConfig(deps.config)
  }

  start() {
    if (!this.config.enabled) {
      log.info("heartbeat: disabled")
      return
    }
    log.info("heartbeat: started", {
      everyMs: this.config.everyMs,
      activeHours: this.config.activeHours ?? "always",
    })
    this.arm()
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
  }

  /**
   * Request an immediate heartbeat run.
   * Coalesces multiple requests within 250ms.
   */
  requestNow(opts?: { reason?: string }) {
    if (this.wakeTimer) {
      return // already scheduled
    }
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      void this.runOnce(opts).catch((err) => {
        log.error("heartbeat: wake run failed", { error: String(err) })
      })
    }, 250)
  }

  /**
   * Run a single heartbeat cycle. Returns the result.
   */
  async runOnce(opts?: { reason?: string }): Promise<HeartbeatRunResult> {
    if (this.running) {
      return { status: "skipped", reason: "requests-in-flight" }
    }

    if (!this.config.enabled) {
      return { status: "skipped", reason: "disabled" }
    }

    if (!isWithinActiveHours(this.config)) {
      return { status: "skipped", reason: "outside-active-hours" }
    }

    this.running = true
    try {
      return await this.execute(opts?.reason)
    } finally {
      this.running = false
    }
  }

  private arm() {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      void this.tick()
    }, this.config.everyMs)
    this.timer.unref?.()
  }

  private async tick() {
    try {
      await this.runOnce({ reason: "interval" })
    } catch (err) {
      log.error("heartbeat: tick failed", { error: String(err) })
    }
    // Re-arm for next cycle
    this.arm()
  }

  private async execute(reason?: string): Promise<HeartbeatRunResult> {
    log.info("heartbeat: running", { reason })

    // Read HEARTBEAT.md
    const heartbeatPath = path.join(this.deps.directory, "HEARTBEAT.md")
    let heartbeatContent: string | null = null
    try {
      heartbeatContent = await fs.readFile(heartbeatPath, "utf-8")
    } catch {
      // File doesn't exist - that's fine, let the agent decide
    }

    // Skip if effectively empty
    if (heartbeatContent !== null && isHeartbeatContentEffectivelyEmpty(heartbeatContent)) {
      log.info("heartbeat: HEARTBEAT.md is effectively empty, skipping")
      return { status: "skipped", reason: "effectively-empty" }
    }

    // Run the agent
    const prompt = resolveHeartbeatPrompt(this.config.prompt)
    try {
      const res = await fetch(`${this.deps.serverUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `heartbeat:${reason ?? "manual"}`,
        }),
      })

      if (!res.ok) {
        return { status: "error", reason: `session create failed: ${res.status}` }
      }

      const session = (await res.json()) as { id: string }

      const msgRes = await fetch(`${this.deps.serverUrl}/session/${session.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: prompt,
          model: this.config.model,
        }),
      })

      if (!msgRes.ok) {
        return { status: "error", reason: `message send failed: ${msgRes.status}` }
      }

      const result = (await msgRes.json()) as { content?: string }
      const responseText = result.content ?? ""

      // Check for HEARTBEAT_OK
      if (isHeartbeatAck(responseText)) {
        log.info("heartbeat: nothing to report (HEARTBEAT_OK)")
        return { status: "ran", reason: "ack" }
      }

      // Strip any ack tokens from the response
      const cleanText = stripHeartbeatAck(responseText)

      // Deliver to TUI + messaging
      const target: DeliveryTarget = {
        serverUrl: this.deps.serverUrl,
        channel: this.deps.deliveryChannel,
        to: this.deps.deliveryTo,
      }
      await deliverHeartbeatResult(cleanText, target)

      log.info("heartbeat: delivered", { chars: cleanText.length })
      return { status: "ran" }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("heartbeat: agent execution failed", { error: message })
      return { status: "error", reason: message }
    }
  }
}
