export const RELIABILITY_REPORT_VERSION = "1"

export type ReliabilityProfile = "alpha" | "diag"

export type ReliabilityStageStatus = "pass" | "fail" | "skip"

export interface ReliabilityRunOptions {
  profile: ReliabilityProfile
  artifactDir?: string
  failFast?: boolean
  json?: boolean
  longSoakDurationMs?: number
}

export interface ReliabilityCommandResult {
  command: string[]
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface ReliabilityCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  expectedExitCodes?: number[]
  stream?: boolean
}

export interface ReliabilitySnapshotArtifact {
  name: string
  path: string
  command: string[]
  exitCode: number
}

export interface ReliabilityStageContext {
  options: ReliabilityRunOptions
  repoRoot: string
  packageRoot: string
  artifactDir: string
  stageArtifactDir: string
  profile: ReliabilityProfile
  runtimeEnv: NodeJS.ProcessEnv
  daemonPortBase: number
  gatewayPortBase: number
  distBinaryPath: string
  stageIndex: number
}

export interface ReliabilityStage<TContext extends ReliabilityStageContext = ReliabilityStageContext> {
  id: string
  name: string
  description: string
  required: boolean
  timeoutMs: number
  run: (ctx: TContext) => Promise<ReliabilityStageRunOutput>
}

export interface ReliabilityStageRunOutput {
  summary: string
  details?: string[]
  artifacts?: ReliabilitySnapshotArtifact[]
  metrics?: Record<string, number | string | boolean | null>
}

export interface ReliabilityStageReport {
  id: string
  name: string
  description: string
  required: boolean
  startedAt: string
  completedAt: string
  durationMs: number
  status: ReliabilityStageStatus
  summary: string
  details: string[]
  artifacts: ReliabilitySnapshotArtifact[]
  metrics: Record<string, number | string | boolean | null>
  error?: string
}

export interface ReliabilitySummary {
  total: number
  passed: number
  failed: number
  skipped: number
}

export interface ReliabilityReportV1 {
  version: typeof RELIABILITY_REPORT_VERSION
  generatedAt: string
  profile: ReliabilityProfile
  repoRoot: string
  artifactDir: string
  platform: NodeJS.Platform
  summary: ReliabilitySummary
  stages: ReliabilityStageReport[]
  assumptions: string[]
}
