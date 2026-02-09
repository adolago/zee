// Timer management for cron job execution.

import type { CronJob } from "../types"
import type { CronEvent, CronServiceState, HeartbeatRunResult } from "./state"
import { computeJobNextRunAtMs, nextWakeAtMs, resolveJobPayloadTextForMain } from "./jobs"
import { locked } from "./locked"
import { ensureLoaded, persist } from "./store"
import { contentHash, shouldThrottle, recordSent } from "./throttle"
import { assertCronToolInvokeAllowed } from "../policy"
import { Instance } from "@/project/instance"

const MAX_TIMEOUT_MS = 2 ** 31 - 1

export function armTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer)
  }
  state.timer = null
  if (!state.deps.cronEnabled) {
    return
  }
  const nextAt = nextWakeAtMs(state)
  if (!nextAt) {
    return
  }
  const delay = Math.max(nextAt - state.deps.nowMs(), 0)
  // Avoid TimeoutOverflowWarning when a job is far in the future.
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS)
  state.timer = setTimeout(() => {
    void onTimer(state).catch((err) => {
      state.deps.log.error("cron: timer tick failed", { err: String(err) })
    })
  }, clampedDelay)
  state.timer.unref?.()
}

export async function onTimer(state: CronServiceState) {
  if (state.running) {
    return
  }
  state.running = true
  try {
    await locked(state, async () => {
      await ensureLoaded(state)
      await runDueJobs(state)
      await persist(state)
      armTimer(state)
    })
  } finally {
    state.running = false
  }
}

export async function runDueJobs(state: CronServiceState) {
  if (!state.store) {
    return
  }
  const now = state.deps.nowMs()
  const due = state.store.jobs.filter((j) => {
    if (!j.enabled) {
      return false
    }
    const maxConcurrent = j.maxConcurrentRuns ?? 1
    const active = state.activeRuns.get(j.id) ?? 0
    if (active >= maxConcurrent) {
      return false
    }
    const next = j.state.nextRunAtMs
    return typeof next === "number" && now >= next
  })
  for (const job of due) {
    await executeJob(state, job, now, { forced: false })
  }
}

export async function executeJob(
  state: CronServiceState,
  job: CronJob,
  nowMs: number,
  opts: { forced: boolean },
) {
  const startedAt = state.deps.nowMs()
  job.state.runningAtMs = startedAt
  job.state.lastError = undefined
  state.activeRuns.set(job.id, (state.activeRuns.get(job.id) ?? 0) + 1)
  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt })

  let deleted = false

  const finish = async (
    status: "ok" | "error" | "skipped" | "throttled",
    err?: string,
    summary?: string,
    outputText?: string,
  ) => {
    const endedAt = state.deps.nowMs()
    job.state.runningAtMs = undefined
    job.state.lastRunAtMs = startedAt
    job.state.lastStatus = status
    job.state.lastDurationMs = Math.max(0, endedAt - startedAt)
    job.state.lastError = err

    const prev = state.activeRuns.get(job.id) ?? 1
    if (prev <= 1) {
      state.activeRuns.delete(job.id)
    } else {
      state.activeRuns.set(job.id, prev - 1)
    }

    const shouldDelete =
      job.schedule.kind === "at" && status === "ok" && job.deleteAfterRun === true

    if (!shouldDelete) {
      if (job.schedule.kind === "at" && status === "ok") {
        // One-shot job completed successfully; disable it.
        job.enabled = false
        job.state.nextRunAtMs = undefined
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, endedAt)
      } else {
        job.state.nextRunAtMs = undefined
      }
    }

    emit(state, {
      jobId: job.id,
      action: "finished",
      status,
      error: err,
      summary,
      runAtMs: startedAt,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
    })

    if (shouldDelete && state.store) {
      state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id)
      deleted = true
      emit(state, { jobId: job.id, action: "removed" })
    }

    if (job.sessionTarget === "isolated" && status !== "throttled") {
      const prefix = job.isolation?.postToMainPrefix?.trim() || "Cron"
      const modeRaw = job.isolation?.postToMainMode
      const mode =
        modeRaw ?? (job.payload.kind === "toolInvoke" ? ("none" as const) : ("summary" as const))

      if (mode === "none") {
        return
      }

      let body = (summary ?? err ?? status).trim()
      if (mode === "full") {
        const maxCharsRaw = job.isolation?.postToMainMaxChars
        const maxChars = Number.isFinite(maxCharsRaw) ? Math.max(0, maxCharsRaw as number) : 8000
        const fullText = (outputText ?? "").trim()
        if (fullText) {
          body = fullText.length > maxChars ? `${fullText.slice(0, maxChars)}…` : fullText
        }
      }

      const statusPrefix = status === "ok" ? prefix : `${prefix} (${status})`
      state.deps.enqueueSystemEvent(`${statusPrefix}: ${body}`, {
        agentId: job.agentId,
      })
      if (job.wakeMode === "now") {
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}:post` })
      }
    }
  }

  try {
    if (job.sessionTarget === "main") {
      const text = resolveJobPayloadTextForMain(job)
      if (!text) {
        const kind = job.payload.kind
        await finish(
          "skipped",
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
        )
        return
      }
      state.deps.enqueueSystemEvent(text, { agentId: job.agentId })
      if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
        const reason = `cron:${job.id}`
        const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
        const maxWaitMs = 2 * 60_000
        const waitStartedAt = state.deps.nowMs()

        let heartbeatResult: HeartbeatRunResult
        for (;;) {
          heartbeatResult = await state.deps.runHeartbeatOnce({ reason })
          if (
            heartbeatResult.status !== "skipped" ||
            heartbeatResult.reason !== "requests-in-flight"
          ) {
            break
          }
          if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
            heartbeatResult = {
              status: "skipped",
              reason: "timeout waiting for main lane to become idle",
            }
            break
          }
          await delay(250)
        }

        if (heartbeatResult.status === "ran") {
          await finish("ok", undefined, text)
        } else if (heartbeatResult.status === "skipped") {
          await finish("skipped", heartbeatResult.reason, text)
        } else {
          await finish("error", heartbeatResult.reason, text)
        }
      } else {
        // wakeMode is "next-heartbeat" or runHeartbeatOnce not available
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` })
        await finish("ok", undefined, text)
      }
      return
    }

    if (job.payload.kind === "toolInvoke") {
      const tool = job.payload.tool.trim()
      if (!tool) {
        await finish("error", 'payload.kind="toolInvoke" requires non-empty tool')
        return
      }

      try {
        await assertCronToolInvokeAllowed(tool)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await finish("error", message)
        return
      }

      const argsRaw = job.payload.args ?? {}
      if (!argsRaw || typeof argsRaw !== "object" || Array.isArray(argsRaw)) {
        await finish("error", 'payload.kind="toolInvoke" args must be a JSON object')
        return
      }

      const res = await Instance.provide({
        directory: state.deps.directory,
        fn: async () => {
          const { ToolRegistry } = await import("../../tool/registry")
          const toolInfo = await ToolRegistry.get(tool)
          if (!toolInfo) {
            return { ok: false as const, error: `tool not found: ${tool}` }
          }
          const init = await toolInfo.init()
          const validatedArgs = init.parameters.parse(argsRaw)
          const ctx = {
            sessionID: `cron:${job.id}`,
            messageID: `cron:${job.id}`,
            agent: "cron",
            abort: new AbortController().signal,
            directory: Instance.directory,
            worktree: Instance.worktree,
            messages: [],
            metadata: () => {},
            async ask(req: { permission: string }) {
              throw new Error(
                `cron toolInvoke cannot request permissions (permission: ${req.permission})`,
              )
            },
          } as any
          const result = await init.execute(validatedArgs, ctx)
          return { ok: true as const, outputText: result.output, title: result.title }
        },
      })

      if (!res.ok) {
        await finish("error", res.error)
        return
      }

      await finish("ok", undefined, res.title || `toolInvoke:${tool}`, res.outputText)
      return
    }

    if (job.payload.kind !== "agentTurn") {
      await finish("skipped", "isolated job requires payload.kind=agentTurn or toolInvoke")
      return
    }

    const res = await state.deps.runIsolatedAgentJob({
      job,
      message: job.payload.message,
    })
    if (res.status === "ok") {
      // Check throttle before delivering the result.
      const outputForHash = res.outputText ?? res.summary ?? ""
      const hash = contentHash(outputForHash)
      const throttleReason = shouldThrottle(job.id, hash, state.deps.nowMs(), job.throttle)
      if (throttleReason) {
        state.deps.log.debug("cron: throttled notification", {
          jobId: job.id,
          reason: throttleReason,
        })
        await finish("throttled", throttleReason, res.summary, res.outputText)
      } else {
        recordSent(job.id, hash, state.deps.nowMs())
        await finish("ok", undefined, res.summary, res.outputText)
      }
    } else if (res.status === "skipped") {
      await finish("skipped", undefined, res.summary, res.outputText)
    } else {
      await finish("error", res.error ?? "cron job failed", res.summary, res.outputText)
    }
  } catch (err) {
    await finish("error", String(err))
  } finally {
    job.updatedAtMs = nowMs
    if (!opts.forced && job.enabled && !deleted) {
      // Keep nextRunAtMs in sync in case the schedule advanced during a long run.
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, state.deps.nowMs())
    }
  }
}

export function wake(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  const text = opts.text.trim()
  if (!text) {
    return { ok: false } as const
  }
  state.deps.enqueueSystemEvent(text)
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" })
  }
  return { ok: true } as const
}

export function stopTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer)
  }
  state.timer = null
}

export function emit(state: CronServiceState, evt: CronEvent) {
  try {
    state.deps.onEvent?.(evt)
  } catch {
    /* ignore */
  }
}
