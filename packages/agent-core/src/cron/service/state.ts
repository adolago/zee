// CronService internal state and dependency injection.

import type { CronJob, CronStoreFile } from "../types"

export type CronEvent = {
  jobId: string
  action: "added" | "updated" | "removed" | "started" | "finished"
  runAtMs?: number
  durationMs?: number
  status?: "ok" | "error" | "skipped"
  error?: string
  summary?: string
  nextRunAtMs?: number
}

export type CronLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void
  info: (msg: string, meta?: Record<string, unknown>) => void
  warn: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, meta?: Record<string, unknown>) => void
}

export type HeartbeatRunResult = {
  status: "ran" | "skipped" | "error"
  reason?: string
}

export type CronServiceDeps = {
  nowMs?: () => number
  log: CronLogger
  storePath: string
  cronEnabled: boolean
  enqueueSystemEvent: (text: string, opts?: { agentId?: string }) => void
  requestHeartbeatNow: (opts?: { reason?: string }) => void
  runHeartbeatOnce?: (opts?: { reason?: string }) => Promise<HeartbeatRunResult>
  runIsolatedAgentJob: (params: {
    job: CronJob
    message: string
  }) => Promise<{
    status: "ok" | "error" | "skipped"
    summary?: string
    outputText?: string
    error?: string
  }>
  onEvent?: (evt: CronEvent) => void
}

export type CronServiceDepsInternal = Omit<CronServiceDeps, "nowMs"> & {
  nowMs: () => number
}

export type CronServiceState = {
  deps: CronServiceDepsInternal
  store: CronStoreFile | null
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  op: Promise<unknown>
  warnedDisabled: boolean
}

export function createCronServiceState(deps: CronServiceDeps): CronServiceState {
  return {
    deps: { ...deps, nowMs: deps.nowMs ?? (() => Date.now()) },
    store: null,
    timer: null,
    running: false,
    op: Promise.resolve(),
    warnedDisabled: false,
  }
}
