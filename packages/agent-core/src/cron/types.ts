// Cron job scheduling types - ported from OpenClaw, adapted for agent-core.

export type CronSchedule =
  | { kind: "at"; atMs: number }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string }

export type CronSessionTarget = "main" | "isolated"
export type CronWakeMode = "next-heartbeat" | "now"

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn"
      message: string
      /** Optional model override (provider/model or alias). */
      model?: string
      thinking?: string
      timeoutSeconds?: number
      deliver?: boolean
      channel?: string
      to?: string
      /** Persona to run as (zee, stanley, johny). */
      persona?: string
    }

export type CronPayloadPatch =
  | { kind: "systemEvent"; text?: string }
  | {
      kind: "agentTurn"
      message?: string
      model?: string
      thinking?: string
      timeoutSeconds?: number
      deliver?: boolean
      channel?: string
      to?: string
      persona?: string
    }

export type CronIsolation = {
  postToMainPrefix?: string
  /**
   * What to post back into the main session after an isolated run.
   * - summary: small status/summary line (default)
   * - full: the agent's final text output (optionally truncated)
   */
  postToMainMode?: "summary" | "full"
  /** Max chars when postToMainMode="full". Default: 8000. */
  postToMainMaxChars?: number
}

export type CronJobState = {
  nextRunAtMs?: number
  runningAtMs?: number
  lastRunAtMs?: number
  lastStatus?: "ok" | "error" | "skipped"
  lastError?: string
  lastDurationMs?: number
}

export type CronJob = {
  id: string
  agentId?: string
  name: string
  description?: string
  enabled: boolean
  deleteAfterRun?: boolean
  createdAtMs: number
  updatedAtMs: number
  schedule: CronSchedule
  sessionTarget: CronSessionTarget
  wakeMode: CronWakeMode
  payload: CronPayload
  isolation?: CronIsolation
  state: CronJobState
}

export type CronStoreFile = {
  version: 1
  jobs: CronJob[]
}

export type CronJobCreate = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state"> & {
  state?: Partial<CronJobState>
}

export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAtMs" | "state" | "payload">> & {
  payload?: CronPayloadPatch
  state?: Partial<CronJobState>
}
