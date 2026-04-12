import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { resolveConfigDir, resolveStateDir } from "@/global/dirs"
import { collectV3ReleaseReport, type V3ReleaseReport } from "@/runtime/v3-release"
import type { RuntimeContractSurface } from "./opencode-contract"

export const V3_ROLLOUT_STAGES = ["paused", "canary", "internal", "broad", "general"] as const
export type V3RolloutStage = (typeof V3_ROLLOUT_STAGES)[number]

type V3RolloutHistoryAction = "apply" | "rollback"

export interface V3RolloutStageSpec {
  stage: V3RolloutStage
  description: string
  enabledSurfaces: RuntimeContractSurface[]
  forcedLegacySurfaces: RuntimeContractSurface[]
  allowLegacyFallback: boolean
  exitCriteria: string[]
}

export interface V3RolloutHistoryEntry {
  action: V3RolloutHistoryAction
  stage: V3RolloutStage
  actor: string
  reason: string
  timestamp: string
  releaseReady: boolean
}

export interface V3RolloutState {
  schemaVersion: "v3-rollout.v1"
  currentStage: V3RolloutStage
  stageSpec: V3RolloutStageSpec
  updatedAt: string
  daemonEnvFile: string
  restartRequired: boolean
  history: V3RolloutHistoryEntry[]
}

export interface V3RolloutReport {
  reportId: "v3-rollout-plan"
  reportVersion: 1
  generatedAt: string
  state: V3RolloutState
  releaseReady: boolean
  releaseFailureCount: number
  nextRecommendedStage: V3RolloutStage | null
  restartCommand: string
  managedEnv: Record<string, string>
  runtimeParityReady: boolean
  metrics: {
    historyCount: number
    stage: V3RolloutStage
    forcedLegacyCount: number
    allowLegacyFallback: boolean
    releaseReady: boolean
    releaseFailureCount: number
    restartRequired: boolean
  }
}

const MANAGED_KEYS = [
  "ZEE_RUNTIME_OPENCODE_SURFACES",
  "ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES",
  "ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK",
] as const

const STAGE_ORDER: V3RolloutStage[] = ["paused", "canary", "internal", "broad", "general"]

const STAGE_SPECS: Record<V3RolloutStage, V3RolloutStageSpec> = {
  paused: {
    stage: "paused",
    description: "All tracked surfaces are pinned to legacy while rollout is paused or rolled back.",
    enabledSurfaces: ["cli", "orchestration", "gateway"],
    forcedLegacySurfaces: ["cli", "orchestration", "gateway"],
    allowLegacyFallback: true,
    exitCriteria: ["Release report is green again.", "Rollback incident is documented and acknowledged."],
  },
  canary: {
    stage: "canary",
    description: "CLI is primary; orchestration and gateway remain pinned to legacy.",
    enabledSurfaces: ["cli", "orchestration", "gateway"],
    forcedLegacySurfaces: ["orchestration", "gateway"],
    allowLegacyFallback: true,
    exitCriteria: ["CLI parity remains clean.", "Operator can complete the release report in strict mode."],
  },
  internal: {
    stage: "internal",
    description: "CLI and orchestration are primary; gateway remains pinned to legacy.",
    enabledSurfaces: ["cli", "orchestration", "gateway"],
    forcedLegacySurfaces: ["gateway"],
    allowLegacyFallback: true,
    exitCriteria: ["Daemon/orchestration traffic remains clean.", "Gateway is the only remaining forced-legacy surface."],
  },
  broad: {
    stage: "broad",
    description: "All tracked surfaces are primary, but legacy fallback stays enabled during broad rollout.",
    enabledSurfaces: ["cli", "orchestration", "gateway"],
    forcedLegacySurfaces: [],
    allowLegacyFallback: true,
    exitCriteria: ["All tracked surfaces stay primary.", "No parity breaches appear in the trailing rollout window."],
  },
  general: {
    stage: "general",
    description: "All tracked surfaces are primary and legacy fallback is disabled for GA.",
    enabledSurfaces: ["cli", "orchestration", "gateway"],
    forcedLegacySurfaces: [],
    allowLegacyFallback: false,
    exitCriteria: ["Broad rollout remained stable.", "Legacy fallback can be disabled without new breaches."],
  },
}

function resolveRolloutStateFile(): string {
  return process.env.ZEE_V3_ROLLOUT_STATE_FILE?.trim() || path.join(resolveStateDir(), "v3-rollout.json")
}

function resolveRolloutEnvFile(): string {
  return process.env.ZEE_V3_ROLLOUT_ENV_FILE?.trim() || path.join(resolveConfigDir(), "daemon.env")
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
}

function currentManagedEnv(spec: V3RolloutStageSpec): Record<string, string> {
  return {
    ZEE_RUNTIME_OPENCODE_SURFACES: spec.enabledSurfaces.join(","),
    ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES: spec.forcedLegacySurfaces.join(","),
    ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK: String(spec.allowLegacyFallback),
  }
}

function parseEnvKey(line: string): string | null {
  let normalized = line.trim()
  if (!normalized || normalized.startsWith("#")) return null
  if (normalized.startsWith("export ")) {
    normalized = normalized.slice("export ".length).trim()
  }
  const eqIndex = normalized.indexOf("=")
  if (eqIndex <= 0) return null
  return normalized.slice(0, eqIndex).trim() || null
}

function writeManagedDaemonEnv(filePath: string, spec: V3RolloutStageSpec): Record<string, string> {
  ensureParentDir(filePath)
  const existingLines = existsSync(filePath) ? readFileSync(filePath, "utf-8").split(/\r?\n/) : []
  const preserved = existingLines.filter((line) => {
    const key = parseEnvKey(line)
    return !key || !MANAGED_KEYS.includes(key as (typeof MANAGED_KEYS)[number])
  })
  const managedEnv = currentManagedEnv(spec)
  const managedLines = [
    "# Managed by zee v3 rollout",
    `export ZEE_RUNTIME_OPENCODE_SURFACES=${managedEnv.ZEE_RUNTIME_OPENCODE_SURFACES}`,
    `export ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES=${managedEnv.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES}`,
    `export ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK=${managedEnv.ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK}`,
  ]
  const body = [...preserved.filter((line, index, lines) => !(index === lines.length - 1 && line.trim() === ""))]
  if (body.length > 0) body.push("")
  body.push(...managedLines)
  writeFileSync(filePath, body.join("\n") + "\n", "utf-8")
  return managedEnv
}

function defaultState(now: Date, envFile: string): V3RolloutState {
  return {
    schemaVersion: "v3-rollout.v1",
    currentStage: "paused",
    stageSpec: STAGE_SPECS.paused,
    updatedAt: now.toISOString(),
    daemonEnvFile: envFile,
    restartRequired: false,
    history: [],
  }
}

function readRolloutState(now: Date, envFile: string): V3RolloutState {
  const filePath = resolveRolloutStateFile()
  if (!existsSync(filePath)) {
    return defaultState(now, envFile)
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<V3RolloutState>
    const currentStage = STAGE_SPECS[parsed.currentStage as V3RolloutStage] ? (parsed.currentStage as V3RolloutStage) : "paused"
    return {
      schemaVersion: "v3-rollout.v1",
      currentStage,
      stageSpec: STAGE_SPECS[currentStage],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now.toISOString(),
      daemonEnvFile: typeof parsed.daemonEnvFile === "string" && parsed.daemonEnvFile ? parsed.daemonEnvFile : envFile,
      restartRequired: parsed.restartRequired === true,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    }
  } catch {
    return defaultState(now, envFile)
  }
}

function writeRolloutState(state: V3RolloutState): void {
  const filePath = resolveRolloutStateFile()
  ensureParentDir(filePath)
  writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8")
}

function nextStage(stage: V3RolloutStage): V3RolloutStage | null {
  const index = STAGE_ORDER.indexOf(stage)
  return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null
}

function assertForwardTransition(current: V3RolloutStage, target: V3RolloutStage): void {
  if (target === "paused") return
  const currentIndex = STAGE_ORDER.indexOf(current)
  const targetIndex = STAGE_ORDER.indexOf(target)
  if (targetIndex === currentIndex) return
  if (targetIndex !== currentIndex + 1) {
    throw new Error(`Rollout stages must advance one step at a time (${current} -> ${nextStage(current) ?? "done"}).`)
  }
}

function buildRolloutReport(input: {
  now: Date
  state: V3RolloutState
  releaseReport: V3ReleaseReport
  managedEnv: Record<string, string>
}): V3RolloutReport {
  return {
    reportId: "v3-rollout-plan",
    reportVersion: 1,
    generatedAt: input.now.toISOString(),
    state: input.state,
    releaseReady: input.releaseReport.readyForRelease,
    releaseFailureCount: input.releaseReport.metrics.failureCount,
    nextRecommendedStage: input.releaseReport.readyForRelease ? nextStage(input.state.currentStage) : null,
    restartCommand: "systemctl --user restart zee",
    managedEnv: input.managedEnv,
    runtimeParityReady: input.releaseReport.runtimeRollout.parity.releaseReady,
    metrics: {
      historyCount: input.state.history.length,
      stage: input.state.currentStage,
      forcedLegacyCount: input.state.stageSpec.forcedLegacySurfaces.length,
      allowLegacyFallback: input.state.stageSpec.allowLegacyFallback,
      releaseReady: input.releaseReport.readyForRelease,
      releaseFailureCount: input.releaseReport.metrics.failureCount,
      restartRequired: input.state.restartRequired,
    },
  }
}

export function summarizeV3RolloutReport(report: V3RolloutReport): string {
  const lines = [
    `v3 rollout plan v${report.reportVersion}`,
    `- stage=${report.state.currentStage} release=${report.releaseReady ? "ready" : "blocked"} runtimeParity=${report.runtimeParityReady ? "ready" : "blocked"} restartRequired=${report.state.restartRequired ? "yes" : "no"}`,
    `- next=${report.nextRecommendedStage ?? "none"} restart=${report.restartCommand}`,
    `- env: ZEE_RUNTIME_OPENCODE_SURFACES=${report.managedEnv.ZEE_RUNTIME_OPENCODE_SURFACES}`,
    `- env: ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES=${report.managedEnv.ZEE_RUNTIME_OPENCODE_FORCE_LEGACY_SURFACES || "none"}`,
    `- env: ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK=${report.managedEnv.ZEE_RUNTIME_OPENCODE_ALLOW_LEGACY_FALLBACK}`,
  ]

  for (const criterion of report.state.stageSpec.exitCriteria) {
    lines.push(`- exit: ${criterion}`)
  }

  return lines.join("\n")
}

export async function getV3RolloutReport(options: { now?: Date } = {}): Promise<V3RolloutReport> {
  const now = options.now ?? new Date()
  const envFile = resolveRolloutEnvFile()
  const state = readRolloutState(now, envFile)
  const releaseReport = await collectV3ReleaseReport()
  const managedEnv = currentManagedEnv(state.stageSpec)
  const report = buildRolloutReport({
    now,
    state,
    releaseReport,
    managedEnv,
  })

  return report
}

export async function applyV3RolloutStage(input: {
  stage: V3RolloutStage
  actor: string
  reason: string
  now?: Date
  releaseReport?: V3ReleaseReport
}): Promise<V3RolloutReport> {
  const now = input.now ?? new Date()
  const envFile = resolveRolloutEnvFile()
  const currentState = readRolloutState(now, envFile)
  const releaseReport = input.releaseReport ?? (await collectV3ReleaseReport())

  if (input.stage !== "paused") {
    if (!releaseReport.readyForRelease) {
      throw new Error("V3 release report is blocked; rollout cannot advance.")
    }
    assertForwardTransition(currentState.currentStage, input.stage)
  }

  const action: V3RolloutHistoryAction = input.stage === "paused" ? "rollback" : "apply"
  const stageSpec = STAGE_SPECS[input.stage]
  const managedEnv = writeManagedDaemonEnv(envFile, stageSpec)
  const state: V3RolloutState = {
    schemaVersion: "v3-rollout.v1",
    currentStage: input.stage,
    stageSpec,
    updatedAt: now.toISOString(),
    daemonEnvFile: envFile,
    restartRequired: true,
    history: [
      {
        action,
        stage: input.stage,
        actor: input.actor,
        reason: input.reason,
        timestamp: now.toISOString(),
        releaseReady: releaseReport.readyForRelease,
      },
      ...currentState.history,
    ].slice(0, 50),
  }
  writeRolloutState(state)

  const report = buildRolloutReport({
    now,
    state,
    releaseReport,
    managedEnv,
  })
  void action
  return report
}

export async function rollbackV3Rollout(input: {
  actor: string
  reason: string
  now?: Date
  releaseReport?: V3ReleaseReport
}): Promise<V3RolloutReport> {
  return applyV3RolloutStage({
    stage: "paused",
    actor: input.actor,
    reason: input.reason,
    now: input.now,
    releaseReport: input.releaseReport,
  })
}
