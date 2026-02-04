/**
 * Cron API Routes
 *
 * HTTP API for managing scheduled cron jobs.
 */

import { Hono } from "hono"
import { z } from "zod"
import { Log } from "../../util/log"
import type { CronService } from "../../cron/service"

const log = Log.create({ service: "server:cron" })

// Singleton reference set during daemon initialization
let cronService: CronService | null = null

export function setCronService(service: CronService) {
  cronService = service
}

function requireCron(): CronService {
  if (!cronService) {
    throw new Error("CronService not initialized")
  }
  return cronService
}

const CronScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), atMs: z.number() }),
  z.object({ kind: z.literal("every"), everyMs: z.number(), anchorMs: z.number().optional() }),
  z.object({ kind: z.literal("cron"), expr: z.string(), tz: z.string().optional() }),
])

const CronPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("systemEvent"), text: z.string() }),
  z.object({
    kind: z.literal("agentTurn"),
    message: z.string(),
    model: z.string().optional(),
    thinking: z.string().optional(),
    timeoutSeconds: z.number().optional(),
    deliver: z.boolean().optional(),
    channel: z.string().optional(),
    to: z.string().optional(),
    persona: z.string().optional(),
  }),
  z.object({
    kind: z.literal("toolInvoke"),
    tool: z.string(),
    args: z.object({}).passthrough().optional(),
  }),
])

const CronJobCreateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  deleteAfterRun: z.boolean().optional(),
  schedule: CronScheduleSchema,
  sessionTarget: z.enum(["main", "isolated"]),
  wakeMode: z.enum(["next-heartbeat", "now"]),
  payload: CronPayloadSchema,
  isolation: z
    .object({
      postToMainPrefix: z.string().optional(),
      postToMainMode: z.enum(["summary", "full"]).optional(),
      postToMainMaxChars: z.number().optional(),
    })
    .optional(),
  agentId: z.string().optional(),
})

export const CronRoute = new Hono()

// GET /cron/status
CronRoute.get("/cron/status", async (c) => {
  const cron = requireCron()
  const status = await cron.status()
  return c.json(status)
})

// GET /cron/jobs
CronRoute.get("/cron/jobs", async (c) => {
  const cron = requireCron()
  const includeDisabled = c.req.query("includeDisabled") === "true"
  const jobs = await cron.list({ includeDisabled })
  return c.json(jobs)
})

// POST /cron/jobs
CronRoute.post("/cron/jobs", async (c) => {
  const cron = requireCron()
  const body = await c.req.json()
  const parsed = CronJobCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "invalid input", issues: parsed.error.issues }, 400)
  }
  try {
    const job = await cron.add(parsed.data as any)
    return c.json(job, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

// PATCH /cron/jobs/:id
CronRoute.patch("/cron/jobs/:id", async (c) => {
  const cron = requireCron()
  const id = c.req.param("id")
  const body = await c.req.json()
  try {
    const job = await cron.update(id, body)
    return c.json(job)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

// DELETE /cron/jobs/:id
CronRoute.delete("/cron/jobs/:id", async (c) => {
  const cron = requireCron()
  const id = c.req.param("id")
  try {
    const result = await cron.remove(id)
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

// POST /cron/jobs/:id/run
CronRoute.post("/cron/jobs/:id/run", async (c) => {
  const cron = requireCron()
  const id = c.req.param("id")
  const body = await c.req.json().catch(() => ({}))
  const mode = (body as { mode?: string }).mode === "force" ? "force" : "due"
  try {
    const result = await cron.run(id, mode)
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

// POST /cron/wake
CronRoute.post("/cron/wake", async (c) => {
  const cron = requireCron()
  const body = await c.req.json()
  const { mode, text } = body as { mode?: string; text?: string }
  if (!text) {
    return c.json({ error: "text is required" }, 400)
  }
  const result = cron.wake({
    mode: mode === "now" ? "now" : "next-heartbeat",
    text,
  })
  return c.json(result)
})
