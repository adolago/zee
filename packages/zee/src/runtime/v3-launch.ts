import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { FluxRecorder } from "@/flux"
import { resolveStateDir } from "@/global/dirs"
import { collectV3ReleaseReport, type V3ReleaseReport } from "@/runtime/v3-release"
import { getV3RolloutReport, type V3RolloutReport, type V3RolloutStage } from "@/runtime/v3-rollout"

export const V3_LAUNCH_OWNERS = ["release-manager", "sre-owner", "program-lead"] as const
export type V3LaunchOwner = (typeof V3_LAUNCH_OWNERS)[number]

export const V3_LAUNCH_DECISIONS = ["approve", "block"] as const
export type V3LaunchDecision = (typeof V3_LAUNCH_DECISIONS)[number]

export interface V3LaunchSignoff {
  owner: V3LaunchOwner
  decision: V3LaunchDecision
  actor: string
  note: string
  timestamp: string
}

export interface V3LaunchState {
  schemaVersion: "v3-launch.v1"
  updatedAt: string
  signoffs: V3LaunchSignoff[]
  launchedAt?: string
  launchActor?: string
  launchReason?: string
}

export interface V3LaunchChecklistItem {
  id: string
  label: string
  ok: boolean
  details: string
}

export interface V3LaunchReport {
  reportId: "v3-launch-checklist"
  reportVersion: 1
  generatedAt: string
  state: V3LaunchState
  checklist: V3LaunchChecklistItem[]
  signoffs: V3LaunchSignoff[]
  releaseReady: boolean
  rolloutStage: V3RolloutStage
  readyForLaunch: boolean
  launched: boolean
  goLive: {
    allowed: boolean
    playbook: string[]
  }
  telemetry: {
    kind: "release.v3.launch"
    metrics: {
      checklistCount: number
      checklistFailures: number
      signoffCount: number
      approvedSignoffCount: number
      rolloutStage: V3RolloutStage
      releaseReady: boolean
      launched: boolean
    }
  }
}

function resolveLaunchStateFile(): string {
  return process.env.ZEE_V3_LAUNCH_STATE_FILE?.trim() || path.join(resolveStateDir(), "v3-launch.json")
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
}

function defaultLaunchState(now: Date): V3LaunchState {
  return {
    schemaVersion: "v3-launch.v1",
    updatedAt: now.toISOString(),
    signoffs: [],
  }
}

function readLaunchState(now: Date): V3LaunchState {
  const filePath = resolveLaunchStateFile()
  if (!existsSync(filePath)) {
    return defaultLaunchState(now)
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<V3LaunchState>
    return {
      schemaVersion: "v3-launch.v1",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now.toISOString(),
      signoffs: Array.isArray(parsed.signoffs) ? parsed.signoffs : [],
      launchedAt: typeof parsed.launchedAt === "string" ? parsed.launchedAt : undefined,
      launchActor: typeof parsed.launchActor === "string" ? parsed.launchActor : undefined,
      launchReason: typeof parsed.launchReason === "string" ? parsed.launchReason : undefined,
    }
  } catch {
    return defaultLaunchState(now)
  }
}

function writeLaunchState(state: V3LaunchState): void {
  const filePath = resolveLaunchStateFile()
  ensureParentDir(filePath)
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8")
}

function latestSignoff(signoffs: V3LaunchSignoff[], owner: V3LaunchOwner): V3LaunchSignoff | undefined {
  return signoffs.find((signoff) => signoff.owner === owner)
}

function buildChecklist(state: V3LaunchState, releaseReport: V3ReleaseReport, rolloutReport: V3RolloutReport): V3LaunchChecklistItem[] {
  const ownerChecks = V3_LAUNCH_OWNERS.map((owner) => {
    const signoff = latestSignoff(state.signoffs, owner)
    return {
      id: `signoff.${owner}`,
      label: `${owner} signoff`,
      ok: signoff?.decision === "approve",
      details: signoff ? `${signoff.decision} by ${signoff.actor}` : "missing",
    }
  })

  return [
    {
      id: "release.report",
      label: "Consolidated release report passes",
      ok: releaseReport.readyForRelease,
      details: `failures=${releaseReport.telemetry.metrics.failureCount}`,
    },
    {
      id: "rollout.general",
      label: "Rollout is at general availability stage",
      ok: rolloutReport.state.currentStage === "general",
      details: `stage=${rolloutReport.state.currentStage}`,
    },
    ...ownerChecks,
  ]
}

function buildPlaybook(releaseReport: V3ReleaseReport, rolloutReport: V3RolloutReport): string[] {
  return [
    "1. Confirm `zee v3 release --strict` is still passing immediately before publication.",
    `2. Confirm \`zee v3 rollout status\` reports stage=${rolloutReport.state.currentStage}.`,
    `3. Restart Zee services if rollout changes are still pending: ${rolloutReport.restartCommand}.`,
    "4. Watch release.v3.report, release.v3.rollout, and release.v3.launch telemetry during go-live.",
    "5. Re-run `zee inspect runtime-rollout --no-json` after go-live and keep the rollback plan ready if parity regresses.",
    `6. Track the current release failure count snapshot (${releaseReport.telemetry.metrics.failureCount}) during stabilization.`,
  ]
}

function buildLaunchReport(input: {
  now: Date
  state: V3LaunchState
  releaseReport: V3ReleaseReport
  rolloutReport: V3RolloutReport
}): V3LaunchReport {
  const checklist = buildChecklist(input.state, input.releaseReport, input.rolloutReport)
  const checklistFailures = checklist.filter((item) => !item.ok).length
  const approvedSignoffCount = input.state.signoffs.filter((signoff) => signoff.decision === "approve").length
  const launched = typeof input.state.launchedAt === "string"

  return {
    reportId: "v3-launch-checklist",
    reportVersion: 1,
    generatedAt: input.now.toISOString(),
    state: input.state,
    checklist,
    signoffs: input.state.signoffs,
    releaseReady: input.releaseReport.readyForRelease,
    rolloutStage: input.rolloutReport.state.currentStage,
    readyForLaunch: checklistFailures === 0,
    launched,
    goLive: {
      allowed: checklistFailures === 0,
      playbook: buildPlaybook(input.releaseReport, input.rolloutReport),
    },
    telemetry: {
      kind: "release.v3.launch",
      metrics: {
        checklistCount: checklist.length,
        checklistFailures,
        signoffCount: input.state.signoffs.length,
        approvedSignoffCount,
        rolloutStage: input.rolloutReport.state.currentStage,
        releaseReady: input.releaseReport.readyForRelease,
        launched,
      },
    },
  }
}

function emitV3LaunchTelemetry(method: "status" | "signoff" | "go-live", report: V3LaunchReport): void {
  FluxRecorder.record({
    traceID: crypto.randomUUID(),
    direction: "internal",
    domain: "runtime",
    kind: report.telemetry.kind,
    status: report.readyForLaunch || report.launched ? "ok" : "error",
    method: method.toUpperCase(),
    path: report.rolloutStage,
    route: "v3.launch",
    metadata: {
      checklistCount: report.telemetry.metrics.checklistCount,
      checklistFailures: report.telemetry.metrics.checklistFailures,
      signoffCount: report.telemetry.metrics.signoffCount,
      approvedSignoffCount: report.telemetry.metrics.approvedSignoffCount,
      rolloutStage: report.rolloutStage,
      releaseReady: report.releaseReady,
      launched: report.launched,
    },
  })
}

export function summarizeV3LaunchReport(report: V3LaunchReport): string {
  const lines = [
    `v3 launch checklist v${report.reportVersion}`,
    `- ready=${report.readyForLaunch ? "yes" : "no"} launched=${report.launched ? "yes" : "no"} release=${report.releaseReady ? "ready" : "blocked"} rollout=${report.rolloutStage}`,
  ]

  for (const item of report.checklist) {
    lines.push(`- ${item.ok ? "ok" : "fail"} ${item.id}: ${item.details}`)
  }

  for (const signoff of report.signoffs) {
    lines.push(`- signoff ${signoff.owner}: ${signoff.decision} by ${signoff.actor}`)
  }

  lines.push(`- telemetry: ${report.telemetry.kind}`)
  return lines.join("\n")
}

export async function getV3LaunchReport(options: {
  emitTelemetry?: boolean
  now?: Date
  releaseReport?: V3ReleaseReport
  rolloutReport?: V3RolloutReport
} = {}): Promise<V3LaunchReport> {
  const now = options.now ?? new Date()
  const state = readLaunchState(now)
  const releaseReport = options.releaseReport ?? (await collectV3ReleaseReport())
  const rolloutReport = options.rolloutReport ?? (await getV3RolloutReport())
  const report = buildLaunchReport({
    now,
    state,
    releaseReport,
    rolloutReport,
  })

  if (options.emitTelemetry) {
    emitV3LaunchTelemetry("status", report)
  }

  return report
}

export async function recordV3LaunchSignoff(input: {
  owner: V3LaunchOwner
  actor: string
  decision?: V3LaunchDecision
  note: string
  now?: Date
  releaseReport?: V3ReleaseReport
  rolloutReport?: V3RolloutReport
}): Promise<V3LaunchReport> {
  const now = input.now ?? new Date()
  const state = readLaunchState(now)
  const signoff: V3LaunchSignoff = {
    owner: input.owner,
    actor: input.actor,
    decision: input.decision ?? "approve",
    note: input.note,
    timestamp: now.toISOString(),
  }
  const nextState: V3LaunchState = {
    ...state,
    updatedAt: now.toISOString(),
    signoffs: [signoff, ...state.signoffs.filter((entry) => entry.owner !== input.owner)],
  }
  writeLaunchState(nextState)

  const report = buildLaunchReport({
    now,
    state: nextState,
    releaseReport: input.releaseReport ?? (await collectV3ReleaseReport()),
    rolloutReport: input.rolloutReport ?? (await getV3RolloutReport()),
  })
  emitV3LaunchTelemetry("signoff", report)
  return report
}

export async function goLiveV3Launch(input: {
  actor: string
  reason: string
  now?: Date
  releaseReport?: V3ReleaseReport
  rolloutReport?: V3RolloutReport
}): Promise<V3LaunchReport> {
  const now = input.now ?? new Date()
  const state = readLaunchState(now)
  if (state.launchedAt) {
    throw new Error(`V3 launch already recorded at ${state.launchedAt}.`)
  }

  const releaseReport = input.releaseReport ?? (await collectV3ReleaseReport())
  const rolloutReport = input.rolloutReport ?? (await getV3RolloutReport())
  const preflight = buildLaunchReport({
    now,
    state,
    releaseReport,
    rolloutReport,
  })
  if (!preflight.readyForLaunch) {
    throw new Error("V3 launch checklist is incomplete.")
  }

  const nextState: V3LaunchState = {
    ...state,
    updatedAt: now.toISOString(),
    launchedAt: now.toISOString(),
    launchActor: input.actor,
    launchReason: input.reason,
  }
  writeLaunchState(nextState)

  const report = buildLaunchReport({
    now,
    state: nextState,
    releaseReport,
    rolloutReport,
  })
  emitV3LaunchTelemetry("go-live", report)
  return report
}
