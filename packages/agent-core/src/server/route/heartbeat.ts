/**
 * Heartbeat API Routes
 *
 * HTTP API for heartbeat status and manual triggering.
 */

import { Hono } from "hono"
import { Log } from "../../util/log"
import type { HeartbeatRunner } from "../../heartbeat/runner"

const log = Log.create({ service: "server:heartbeat" })

// Singleton reference set during daemon initialization
let heartbeatRunner: HeartbeatRunner | null = null

export function setHeartbeatRunner(runner: HeartbeatRunner) {
  heartbeatRunner = runner
}

function requireHeartbeat(): HeartbeatRunner {
  if (!heartbeatRunner) {
    throw new Error("HeartbeatRunner not initialized")
  }
  return heartbeatRunner
}

export const HeartbeatRoute = new Hono()

// POST /heartbeat/run - trigger a heartbeat manually
HeartbeatRoute.post("/heartbeat/run", async (c) => {
  const runner = requireHeartbeat()
  const body = await c.req.json().catch(() => ({}))
  const reason = (body as { reason?: string }).reason ?? "manual"
  const result = await runner.runOnce({ reason })
  return c.json(result)
})

// POST /heartbeat/wake - request immediate heartbeat (coalesced)
HeartbeatRoute.post("/heartbeat/wake", async (c) => {
  const runner = requireHeartbeat()
  const body = await c.req.json().catch(() => ({}))
  const reason = (body as { reason?: string }).reason ?? "wake"
  runner.requestNow({ reason })
  return c.json({ ok: true })
})
