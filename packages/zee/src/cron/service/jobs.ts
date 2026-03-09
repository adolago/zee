// Cron job CRUD operations and state management.

import crypto from "crypto"
import type { CronJob, CronJobCreate, CronJobPatch, CronPayload, CronPayloadPatch } from "../types"
import type { CronServiceState } from "./state"
import { computeNextRunAtMs } from "../schedule"
import {
  normalizeOptionalAgentId,
  normalizeOptionalText,
  normalizePayloadToSystemText,
  normalizeRequiredName,
} from "../normalize"

const STUCK_RUN_MS = 2 * 60 * 60 * 1000

export function assertSupportedJobSpec(job: Pick<CronJob, "sessionTarget" | "payload">) {
  if (job.sessionTarget === "main" && job.payload.kind !== "systemEvent") {
    throw new Error('main cron jobs require payload.kind="systemEvent"')
  }
  if (job.sessionTarget === "isolated" && job.payload.kind !== "agentTurn" && job.payload.kind !== "toolInvoke") {
    throw new Error('isolated cron jobs require payload.kind="agentTurn" or "toolInvoke"')
  }
}

export function findJobOrThrow(state: CronServiceState, id: string): CronJob {
  const job = state.store?.jobs.find((j) => j.id === id)
  if (!job) {
    throw new Error(`unknown cron job id: ${id}`)
  }
  return job
}

export function computeJobNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  if (!job.enabled) {
    return undefined
  }
  if (job.schedule.kind === "at") {
    // One-shot jobs stay due until they successfully finish.
    if (job.state.lastStatus === "ok" && job.state.lastRunAtMs) {
      return undefined
    }
    return job.schedule.atMs
  }
  return computeNextRunAtMs(job.schedule, nowMs)
}

export function recomputeNextRuns(state: CronServiceState) {
  if (!state.store) {
    return
  }
  const now = state.deps.nowMs()
  for (const job of state.store.jobs) {
    if (!job.state) {
      job.state = {}
    }
    if (!job.enabled) {
      job.state.nextRunAtMs = undefined
      job.state.runningAtMs = undefined
      continue
    }
    const runningAt = job.state.runningAtMs
    if (typeof runningAt === "number" && now - runningAt > STUCK_RUN_MS) {
      state.deps.log.warn("cron: clearing stuck running marker", {
        jobId: job.id,
        runningAtMs: runningAt,
      })
      job.state.runningAtMs = undefined
      const prev = state.activeRuns.get(job.id) ?? 0
      if (prev <= 1) {
        state.activeRuns.delete(job.id)
      } else {
        state.activeRuns.set(job.id, prev - 1)
      }
    }
    job.state.nextRunAtMs = computeJobNextRunAtMs(job, now)
  }
}

export function nextWakeAtMs(state: CronServiceState): number | undefined {
  const jobs = state.store?.jobs ?? []
  const enabled = jobs.filter((j) => j.enabled && typeof j.state.nextRunAtMs === "number")
  if (enabled.length === 0) {
    return undefined
  }
  return enabled.reduce(
    (min, j) => Math.min(min, j.state.nextRunAtMs as number),
    enabled[0].state.nextRunAtMs as number,
  )
}

export function createJob(state: CronServiceState, input: CronJobCreate): CronJob {
  const now = state.deps.nowMs()
  const id = crypto.randomUUID()
  const job: CronJob = {
    id,
    agentId: normalizeOptionalAgentId(input.agentId),
    name: normalizeRequiredName(input.name),
    description: normalizeOptionalText(input.description),
    enabled: input.enabled,
    deleteAfterRun: input.deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: input.schedule,
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode,
    payload: input.payload,
    isolation: input.isolation,
    maxConcurrentRuns: input.maxConcurrentRuns,
    throttle: input.throttle,
    state: {
      ...input.state,
    },
  }
  assertSupportedJobSpec(job)
  job.state.nextRunAtMs = computeJobNextRunAtMs(job, now)
  return job
}

export function applyJobPatch(job: CronJob, patch: CronJobPatch) {
  if ("name" in patch) {
    job.name = normalizeRequiredName(patch.name)
  }
  if ("description" in patch) {
    job.description = normalizeOptionalText(patch.description)
  }
  if (typeof patch.enabled === "boolean") {
    job.enabled = patch.enabled
  }
  if (typeof patch.deleteAfterRun === "boolean") {
    job.deleteAfterRun = patch.deleteAfterRun
  }
  if (patch.schedule) {
    job.schedule = patch.schedule
  }
  if (patch.sessionTarget) {
    job.sessionTarget = patch.sessionTarget
  }
  if (patch.wakeMode) {
    job.wakeMode = patch.wakeMode
  }
  if (patch.payload) {
    job.payload = mergeCronPayload(job.payload, patch.payload)
  }
  if (patch.isolation) {
    job.isolation = patch.isolation
  }
  if ("maxConcurrentRuns" in patch) {
    job.maxConcurrentRuns = patch.maxConcurrentRuns
  }
  if ("throttle" in patch) {
    job.throttle = patch.throttle
  }
  if (patch.state) {
    job.state = { ...job.state, ...patch.state }
  }
  if ("agentId" in patch) {
    job.agentId = normalizeOptionalAgentId((patch as { agentId?: unknown }).agentId)
  }
  assertSupportedJobSpec(job)
}

function mergeCronPayload(existing: CronPayload, patch: CronPayloadPatch): CronPayload {
  if (patch.kind !== existing.kind) {
    return buildPayloadFromPatch(patch)
  }

  if (patch.kind === "systemEvent") {
    if (existing.kind !== "systemEvent") {
      return buildPayloadFromPatch(patch)
    }
    const text = typeof patch.text === "string" ? patch.text : existing.text
    return { kind: "systemEvent", text }
  }

  if (patch.kind === "toolInvoke") {
    if (existing.kind !== "toolInvoke") {
      return buildPayloadFromPatch(patch)
    }
    const tool = typeof patch.tool === "string" ? patch.tool : existing.tool
    const args = patch.args !== undefined ? patch.args : existing.args
    return { kind: "toolInvoke", tool, args }
  }

  if (existing.kind !== "agentTurn") {
    return buildPayloadFromPatch(patch)
  }

  const next: Extract<CronPayload, { kind: "agentTurn" }> = { ...existing }
  if (typeof patch.message === "string") next.message = patch.message
  if (typeof patch.model === "string") next.model = patch.model
  if (typeof patch.thinking === "string") next.thinking = patch.thinking
  if (typeof patch.timeoutSeconds === "number") next.timeoutSeconds = patch.timeoutSeconds
  if (typeof patch.deliver === "boolean") next.deliver = patch.deliver
  if (typeof patch.channel === "string") next.channel = patch.channel
  if (typeof patch.to === "string") next.to = patch.to
  if (typeof patch.agent === "string") next.agent = patch.agent
  return next
}

function buildPayloadFromPatch(patch: CronPayloadPatch): CronPayload {
  if (patch.kind === "systemEvent") {
    if (typeof patch.text !== "string" || patch.text.length === 0) {
      throw new Error('cron.update payload.kind="systemEvent" requires text')
    }
    return { kind: "systemEvent", text: patch.text }
  }

  if (patch.kind === "toolInvoke") {
    if (typeof patch.tool !== "string" || patch.tool.trim().length === 0) {
      throw new Error('cron.update payload.kind="toolInvoke" requires tool')
    }
    if (patch.args !== undefined && (!patch.args || typeof patch.args !== "object" || Array.isArray(patch.args))) {
      throw new Error('cron.update payload.kind="toolInvoke" args must be a JSON object')
    }
    return {
      kind: "toolInvoke",
      tool: patch.tool.trim(),
      args: patch.args,
    }
  }

  if (typeof patch.message !== "string" || patch.message.length === 0) {
    throw new Error('cron.update payload.kind="agentTurn" requires message')
  }

  return {
    kind: "agentTurn",
    message: patch.message,
    model: patch.model,
    thinking: patch.thinking,
    timeoutSeconds: patch.timeoutSeconds,
    deliver: patch.deliver,
    channel: patch.channel,
    to: patch.to,
    agent: patch.agent,
  }
}

export function isJobDue(job: CronJob, nowMs: number, opts: { forced: boolean }): boolean {
  if (opts.forced) {
    return true
  }
  return job.enabled && typeof job.state.nextRunAtMs === "number" && nowMs >= job.state.nextRunAtMs
}

export function resolveJobPayloadTextForMain(job: CronJob): string | undefined {
  if (job.payload.kind !== "systemEvent") {
    return undefined
  }
  const text = normalizePayloadToSystemText(job.payload)
  return text.trim() ? text : undefined
}
