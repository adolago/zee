/**
 * Investing Evaluation Datasets And Golden-Set Harness
 *
 * Persists reusable evaluation datasets tied to stable research outputs and
 * runs a repeatable golden-set harness across those outputs without requiring
 * downstream scorers yet.
 */

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { FluxRecorder } from "../../../packages/zee/src/flux"
import { Log } from "../../../packages/zee/src/util/log"
import { getInvestingResearchArtifact, type InvestingResearchArtifact } from "./artifacts"
import { getInvestingPortfolioBriefing, type InvestingPortfolioBriefing } from "./briefings"
import {
  INVESTING_EVAL_SCORE_PROFILE,
  INVESTING_EVAL_THRESHOLDS,
  scoreInvestingEvalCase,
  type InvestingEvalCaseScores,
  type InvestingEvalThresholdProfile,
} from "./eval-scoring"
import {
  buildInvestingEvalRunAlerts,
  buildInvestingEvalRunGate,
  buildInvestingEvalRunRegression,
  type InvestingEvalRunAlert,
  type InvestingEvalRunGate,
  type InvestingEvalRunRegression,
} from "./eval-gates"
import { getInvestingEarningsPacket, type InvestingEarningsPacket } from "./earnings-packets"

const log = Log.create({ service: "investing:evals" })

export const INVESTING_EVAL_SOURCE_KINDS = ["research-artifact", "earnings-packet", "portfolio-briefing"] as const
export type InvestingEvalSourceKind = (typeof INVESTING_EVAL_SOURCE_KINDS)[number]

export const INVESTING_EVAL_RUN_STATUSES = ["pass", "fail", "error"] as const
export type InvestingEvalRunStatus = (typeof INVESTING_EVAL_RUN_STATUSES)[number]

export interface InvestingEvalGoldenSnapshot {
  sourceKind: InvestingEvalSourceKind
  sourceId: string
  capturedAt: string
  title: string
  summary: string
  sectionTitles: string[]
  citationCount: number
  diagnosticCount: number
  updatedAt: string
  metadata: {
    schemaVersion?: string
    status?: string
    workflow?: string
    kind?: string
    symbols: string[]
  }
}

export interface InvestingEvalCaseExpectations {
  requiredSectionTitles: string[]
  minCitationCount: number
  maxDiagnosticCount: number
  freshnessWithinHours?: number
}

export interface InvestingEvalDatasetCase {
  id: string
  label: string
  sourceKind: InvestingEvalSourceKind
  sourceId: string
  golden: InvestingEvalGoldenSnapshot
  expectations: InvestingEvalCaseExpectations
}

export interface InvestingEvalDataset {
  id: string
  schemaVersion: "investing-eval-dataset.v1"
  name: string
  description: string
  owner: string
  createdAt: string
  updatedAt: string
  cases: InvestingEvalDatasetCase[]
  audit: {
    captureCount: number
    lastRunId?: string
    runCount: number
  }
}

export interface InvestingEvalCaseCheck {
  id: string
  label: string
  passed: boolean
  expected: string
  actual: string
}

export interface InvestingEvalCaseResult {
  caseId: string
  label: string
  sourceKind: InvestingEvalSourceKind
  sourceId: string
  status: InvestingEvalRunStatus
  summary: string
  checks: InvestingEvalCaseCheck[]
  live: InvestingEvalGoldenSnapshot | null
  passCount: number
  failCount: number
  scores: InvestingEvalCaseScores
  thresholdBreaches: Array<keyof InvestingEvalCaseScores>
  reasons: {
    factuality: string[]
    consistency: string[]
    timeliness: string[]
  }
}

export interface InvestingEvalRunScores {
  structural: number
  factuality: number | null
  consistency: number | null
  timeliness: number | null
}

export interface InvestingEvalRun {
  id: string
  schemaVersion: "investing-eval-run.v1"
  datasetId: string
  owner: string
  createdAt: string
  status: InvestingEvalRunStatus
  summary: string
  baselineRunId: string | null
  scoreProfile: typeof INVESTING_EVAL_SCORE_PROFILE
  thresholds: InvestingEvalThresholdProfile
  scores: InvestingEvalRunScores
  thresholdBreaches: Array<keyof InvestingEvalRunScores>
  regression: InvestingEvalRunRegression | null
  alerts: InvestingEvalRunAlert[]
  gate: InvestingEvalRunGate
  totals: {
    totalCases: number
    passCount: number
    failCount: number
    errorCount: number
    passRate: number
  }
  results: InvestingEvalCaseResult[]
}

type EvalState = {
  version: 1
  datasets: InvestingEvalDataset[]
  runs: InvestingEvalRun[]
}

export type CreateInvestingEvalDatasetInput = {
  name: string
  description: string
  owner: string
  cases: Array<{
    label: string
    sourceKind: InvestingEvalSourceKind
    sourceId: string
    expectations?: Partial<InvestingEvalCaseExpectations>
  }>
}

function getEvalStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee")
  return path.join(stateDir, "investing")
}

export function getInvestingEvalStateFile(): string {
  return path.join(getEvalStateDir(), "evals.json")
}

function ensureEvalStateDir(): void {
  mkdirSync(getEvalStateDir(), { recursive: true })
}

function readEvalState(): EvalState {
  const filePath = getInvestingEvalStateFile()
  if (!existsSync(filePath)) {
    return { version: 1, datasets: [], runs: [] }
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<EvalState>
    return {
      version: 1,
      datasets: Array.isArray(parsed.datasets) ? parsed.datasets : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    }
  } catch (error) {
    log.warn("failed to read investing eval state", {
      error: error instanceof Error ? error.message : String(error),
    })
    return { version: 1, datasets: [], runs: [] }
  }
}

function writeEvalState(state: EvalState): void {
  ensureEvalStateDir()
  writeFileSync(getInvestingEvalStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8")
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}

function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function stringList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none"
}

function telemetry(input: {
  kind: "investing.eval.dataset" | "investing.eval.run" | "investing.eval.score" | "investing.eval.gate" | "investing.eval.alert"
  traceID: string
  method: string
  path?: string
  route?: string
  status?: "ok" | "error"
  metadata?: Record<string, unknown>
}): void {
  FluxRecorder.record({
    traceID: input.traceID,
    direction: "internal",
    domain: "investing",
    kind: input.kind,
    status: input.status ?? "ok",
    method: input.method,
    path: input.path,
    route: input.route,
    metadata: input.metadata,
  })
}

function snapshotFromResearchArtifact(artifact: InvestingResearchArtifact): InvestingEvalGoldenSnapshot {
  return {
    sourceKind: "research-artifact",
    sourceId: artifact.id,
    capturedAt: new Date().toISOString(),
    title: artifact.title,
    summary: artifact.summary,
    sectionTitles: artifact.sections.map((section) => section.title),
    citationCount: artifact.citations.length,
    diagnosticCount: artifact.diagnostics.length,
    updatedAt: artifact.updatedAt,
    metadata: {
      schemaVersion: "research-artifact.v1",
      status: artifact.status,
      workflow: artifact.workflow,
      kind: artifact.kind,
      symbols: artifact.symbols,
    },
  }
}

function snapshotFromEarningsPacket(packet: InvestingEarningsPacket): InvestingEvalGoldenSnapshot {
  return {
    sourceKind: "earnings-packet",
    sourceId: packet.id,
    capturedAt: new Date().toISOString(),
    title: packet.title,
    summary: packet.summary,
    sectionTitles: packet.sections.map((section) => section.title),
    citationCount: packet.citations.length,
    diagnosticCount: packet.diagnostics.length,
    updatedAt: packet.updatedAt,
    metadata: {
      schemaVersion: packet.schemaVersion,
      status: packet.status,
      workflow: packet.workflow,
      symbols: [packet.symbol],
    },
  }
}

function snapshotFromPortfolioBriefing(briefing: InvestingPortfolioBriefing): InvestingEvalGoldenSnapshot {
  return {
    sourceKind: "portfolio-briefing",
    sourceId: briefing.id,
    capturedAt: new Date().toISOString(),
    title: briefing.kind,
    summary: briefing.summary,
    sectionTitles: briefing.sections.map((section) => section.title),
    citationCount: 0,
    diagnosticCount: 0,
    updatedAt: briefing.createdAt,
    metadata: {
      schemaVersion: briefing.schemaVersion,
      kind: briefing.kind,
      symbols: unique(briefing.symbols.map((entry) => entry.symbol)),
    },
  }
}

export function captureInvestingEvalSnapshot(input: {
  sourceKind: InvestingEvalSourceKind
  sourceId: string
}): InvestingEvalGoldenSnapshot | null {
  switch (input.sourceKind) {
    case "research-artifact": {
      const artifact = getInvestingResearchArtifact(input.sourceId)
      return artifact ? snapshotFromResearchArtifact(artifact) : null
    }
    case "earnings-packet": {
      const packet = getInvestingEarningsPacket(input.sourceId)
      return packet ? snapshotFromEarningsPacket(packet) : null
    }
    case "portfolio-briefing": {
      const briefing = getInvestingPortfolioBriefing(input.sourceId)
      return briefing ? snapshotFromPortfolioBriefing(briefing) : null
    }
  }
}

function materializeEvalCase(input: CreateInvestingEvalDatasetInput["cases"][number]): InvestingEvalDatasetCase {
  const golden = captureInvestingEvalSnapshot({
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
  })
  if (!golden) {
    throw new Error(`Eval source not found: ${input.sourceKind}:${input.sourceId}`)
  }

  return {
    id: `eval-case-${randomUUID().slice(0, 12)}`,
    label: input.label,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    golden,
    expectations: {
      requiredSectionTitles: input.expectations?.requiredSectionTitles ?? golden.sectionTitles,
      minCitationCount: input.expectations?.minCitationCount ?? golden.citationCount,
      maxDiagnosticCount: input.expectations?.maxDiagnosticCount ?? golden.diagnosticCount,
      freshnessWithinHours: input.expectations?.freshnessWithinHours,
    },
  }
}

function persistDataset(state: EvalState, dataset: InvestingEvalDataset): InvestingEvalDataset {
  dataset.updatedAt = new Date().toISOString()
  state.datasets = [dataset, ...state.datasets.filter((entry) => entry.id !== dataset.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )
  writeEvalState(state)
  return dataset
}

function checkEvalCase(dataset: InvestingEvalDataset, evalCase: InvestingEvalDatasetCase): InvestingEvalCaseResult {
  const live = captureInvestingEvalSnapshot({
    sourceKind: evalCase.sourceKind,
    sourceId: evalCase.sourceId,
  })

  if (!live) {
    return {
      caseId: evalCase.id,
      label: evalCase.label,
      sourceKind: evalCase.sourceKind,
      sourceId: evalCase.sourceId,
      status: "error",
      summary: `${evalCase.label} could not load live source ${evalCase.sourceKind}:${evalCase.sourceId}.`,
      live: null,
      checks: [
        {
          id: "source-available",
          label: "live source available",
          passed: false,
          expected: `${evalCase.sourceKind}:${evalCase.sourceId}`,
          actual: "missing",
        },
      ],
      passCount: 0,
      failCount: 1,
      scores: {
        structural: 0,
        factuality: 0,
        consistency: 0,
        timeliness: 0,
      },
      thresholdBreaches: ["structural", "factuality", "consistency", "timeliness"],
      reasons: {
        factuality: ["Live source could not be loaded."],
        consistency: ["Live source could not be loaded."],
        timeliness: ["Live source could not be loaded."],
      },
    }
  }

  const checks: InvestingEvalCaseCheck[] = [
    {
      id: "summary-match",
      label: "summary matches golden snapshot",
      passed: live.summary === evalCase.golden.summary,
      expected: evalCase.golden.summary,
      actual: live.summary,
    },
    {
      id: "section-titles",
      label: "section titles match expected set",
      passed: equalStringArrays(live.sectionTitles, evalCase.expectations.requiredSectionTitles),
      expected: stringList(evalCase.expectations.requiredSectionTitles),
      actual: stringList(live.sectionTitles),
    },
    {
      id: "citation-count",
      label: "citation count meets minimum",
      passed: live.citationCount >= evalCase.expectations.minCitationCount,
      expected: `>= ${evalCase.expectations.minCitationCount}`,
      actual: String(live.citationCount),
    },
    {
      id: "diagnostic-count",
      label: "diagnostic count stays within budget",
      passed: live.diagnosticCount <= evalCase.expectations.maxDiagnosticCount,
      expected: `<= ${evalCase.expectations.maxDiagnosticCount}`,
      actual: String(live.diagnosticCount),
    },
    {
      id: "status-match",
      label: "status matches golden snapshot",
      passed: live.metadata.status === evalCase.golden.metadata.status,
      expected: evalCase.golden.metadata.status ?? "n/a",
      actual: live.metadata.status ?? "n/a",
    },
    {
      id: "symbols-match",
      label: "symbol coverage matches golden snapshot",
      passed: equalStringArrays(live.metadata.symbols, evalCase.golden.metadata.symbols),
      expected: stringList(evalCase.golden.metadata.symbols),
      actual: stringList(live.metadata.symbols),
    },
  ]

  if (evalCase.golden.metadata.workflow || live.metadata.workflow) {
    checks.push({
      id: "workflow-match",
      label: "workflow matches golden snapshot",
      passed: live.metadata.workflow === evalCase.golden.metadata.workflow,
      expected: evalCase.golden.metadata.workflow ?? "n/a",
      actual: live.metadata.workflow ?? "n/a",
    })
  }

  if (evalCase.expectations.freshnessWithinHours != null) {
    const ageMs = Date.now() - Date.parse(live.updatedAt)
    const ageHours = ageMs / (60 * 60 * 1000)
    checks.push({
      id: "freshness-window",
      label: "source falls within freshness window",
      passed: ageHours <= evalCase.expectations.freshnessWithinHours,
      expected: `<= ${evalCase.expectations.freshnessWithinHours}h`,
      actual: `${round(ageHours, 2)}h`,
    })
  }

  const failCount = checks.filter((check) => !check.passed).length
  const passCount = checks.length - failCount
  const scoring = scoreInvestingEvalCase({
    evalCase,
    result: {
      caseId: evalCase.id,
      label: evalCase.label,
      sourceKind: evalCase.sourceKind,
      sourceId: evalCase.sourceId,
      status: failCount === 0 ? "pass" : "fail",
      summary: "",
      checks,
      live,
      passCount,
      failCount,
      scores: {
        structural: 0,
        factuality: 0,
        consistency: 0,
        timeliness: 0,
      },
      thresholdBreaches: [],
      reasons: {
        factuality: [],
        consistency: [],
        timeliness: [],
      },
    },
  })

  return {
    caseId: evalCase.id,
    label: evalCase.label,
    sourceKind: evalCase.sourceKind,
    sourceId: evalCase.sourceId,
    status: failCount === 0 ? "pass" : "fail",
    summary:
      failCount === 0
        ? `${evalCase.label} matched the golden snapshot for dataset ${dataset.name}.`
        : `${evalCase.label} drifted from the golden snapshot for dataset ${dataset.name}.`,
    checks,
    live,
    passCount,
    failCount,
    scores: scoring.scores,
    thresholdBreaches: scoring.thresholdBreaches,
    reasons: scoring.reasons,
  }
}

export function createInvestingEvalDataset(input: CreateInvestingEvalDatasetInput): InvestingEvalDataset {
  if (input.cases.length === 0) {
    throw new Error("Eval datasets require at least one case.")
  }

  const state = readEvalState()
  const createdAt = new Date().toISOString()
  const dataset: InvestingEvalDataset = {
    id: `investing-eval-dataset-${randomUUID().slice(0, 12)}`,
    schemaVersion: "investing-eval-dataset.v1",
    name: input.name.trim(),
    description: input.description.trim(),
    owner: input.owner.trim(),
    createdAt,
    updatedAt: createdAt,
    cases: input.cases.map((evalCase) => materializeEvalCase(evalCase)),
    audit: {
      captureCount: input.cases.length,
      runCount: 0,
    },
  }

  persistDataset(state, dataset)
  telemetry({
    kind: "investing.eval.dataset",
    traceID: dataset.id,
    method: "create",
    path: dataset.name,
    route: dataset.id,
    metadata: {
      owner: dataset.owner,
      caseCount: dataset.cases.length,
      captureCount: dataset.audit.captureCount,
    },
  })

  return dataset
}

export function getInvestingEvalDataset(datasetId: string): InvestingEvalDataset | null {
  const state = readEvalState()
  const dataset = state.datasets.find((entry) => entry.id === datasetId) ?? null
  telemetry({
    kind: "investing.eval.dataset",
    traceID: datasetId,
    method: "read",
    path: dataset?.name,
    route: datasetId,
    metadata: { found: Boolean(dataset) },
  })
  return dataset
}

export function listInvestingEvalDatasets(options?: { owner?: string; limit?: number }): InvestingEvalDataset[] {
  const datasets = readEvalState()
    .datasets.filter((dataset) => (options?.owner ? dataset.owner === options.owner : true))
    .slice(0, options?.limit ?? 20)

  telemetry({
    kind: "investing.eval.dataset",
    traceID: options?.owner ? `eval-datasets:${options.owner}` : "eval-datasets:list",
    method: "list",
    path: options?.owner,
    route: "investing:eval:datasets",
    metadata: { owner: options?.owner, count: datasets.length, limit: options?.limit ?? 20 },
  })

  return datasets
}

export function runInvestingEvalDataset(input: { datasetId: string }): InvestingEvalRun {
  const state = readEvalState()
  const dataset = state.datasets.find((entry) => entry.id === input.datasetId)
  if (!dataset) {
    throw new Error(`Eval dataset not found: ${input.datasetId}`)
  }

  const results = dataset.cases.map((evalCase) => checkEvalCase(dataset, evalCase))
  const previousRun = state.runs.find((entry) => entry.datasetId === dataset.id) ?? null
  const passCount = results.filter((result) => result.status === "pass").length
  const failCount = results.filter((result) => result.status === "fail").length
  const errorCount = results.filter((result) => result.status === "error").length
  const totalCases = results.length
  const passRate = totalCases > 0 ? round((passCount / totalCases) * 100) : 0
  const averageScore = (dimension: keyof InvestingEvalCaseScores): number =>
    totalCases > 0 ? round(results.reduce((sum, result) => sum + result.scores[dimension], 0) / totalCases) : 0

  const scores: InvestingEvalRunScores = {
    structural: passRate,
    factuality: averageScore("factuality"),
    consistency: averageScore("consistency"),
    timeliness: averageScore("timeliness"),
  }
  const status: InvestingEvalRunStatus = errorCount > 0 ? "error" : failCount > 0 ? "fail" : "pass"
  const thresholdBreaches = (Object.keys(scores) as Array<keyof InvestingEvalRunScores>).filter(
    (dimension) => (scores[dimension] ?? 0) < INVESTING_EVAL_THRESHOLDS[dimension],
  )
  const runCore: Pick<
    InvestingEvalRun,
    | "id"
    | "schemaVersion"
    | "datasetId"
    | "owner"
    | "createdAt"
    | "status"
    | "baselineRunId"
    | "scoreProfile"
    | "thresholds"
    | "scores"
    | "thresholdBreaches"
    | "results"
  > = {
    id: `investing-eval-run-${randomUUID().slice(0, 12)}`,
    schemaVersion: "investing-eval-run.v1",
    datasetId: dataset.id,
    owner: dataset.owner,
    createdAt: new Date().toISOString(),
    status,
    baselineRunId: previousRun?.id ?? null,
    scoreProfile: INVESTING_EVAL_SCORE_PROFILE,
    thresholds: INVESTING_EVAL_THRESHOLDS,
    scores,
    thresholdBreaches,
    results,
  }
  const regression = buildInvestingEvalRunRegression({
    previousRun,
    currentRun: runCore,
  })
  const alerts = buildInvestingEvalRunAlerts({
    dataset,
    run: runCore,
    regression,
  })
  const gate = buildInvestingEvalRunGate({
    dataset,
    run: runCore,
    regression,
  })
  const regressionCount = regression?.regressionCount ?? 0
  const run: InvestingEvalRun = {
    ...runCore,
    summary: `Eval dataset ${dataset.name} finished with ${passCount}/${totalCases} passing case(s), ${failCount} failing case(s), and ${errorCount} error case(s). Threshold breaches: ${thresholdBreaches.join(", ") || "none"}. Regressions: ${regressionCount}. Alerts routed: ${alerts.length}.`,
    regression,
    alerts,
    gate,
    totals: {
      totalCases,
      passCount,
      failCount,
      errorCount,
      passRate,
    },
  }

  dataset.audit.lastRunId = run.id
  dataset.audit.runCount += 1
  persistDataset(state, dataset)
  state.runs = [run, ...state.runs.filter((entry) => entry.id !== run.id)].slice(0, 500)
  writeEvalState(state)

  telemetry({
    kind: "investing.eval.run",
    traceID: run.id,
    method: "execute",
    path: dataset.name,
    route: dataset.id,
    status: run.status === "error" ? "error" : "ok",
    metadata: {
      datasetId: dataset.id,
      owner: run.owner,
      totalCases,
      passCount,
      failCount,
      errorCount,
      baselineRunId: run.baselineRunId,
      structural: run.scores.structural,
      factuality: run.scores.factuality,
      consistency: run.scores.consistency,
      timeliness: run.scores.timeliness,
      thresholdBreaches: run.thresholdBreaches,
      regressionCount,
      alertCount: run.alerts.length,
      gateOk: run.gate.ok,
      routingKey: run.gate.routingKey,
    },
  })

  for (const result of results) {
    telemetry({
      kind: "investing.eval.score",
      traceID: `${run.id}:${result.caseId}`,
      method: "case",
      path: result.sourceId,
      route: dataset.id,
      status: result.thresholdBreaches.length > 0 ? "error" : "ok",
      metadata: {
        caseId: result.caseId,
        owner: run.owner,
        sourceKind: result.sourceKind,
        structural: result.scores.structural,
        factuality: result.scores.factuality,
        consistency: result.scores.consistency,
        timeliness: result.scores.timeliness,
        thresholdBreaches: result.thresholdBreaches,
      },
    })
  }

  telemetry({
    kind: "investing.eval.score",
    traceID: run.id,
    method: "aggregate",
    path: dataset.name,
    route: dataset.id,
    status: run.thresholdBreaches.length > 0 ? "error" : "ok",
    metadata: {
      owner: run.owner,
      scoreProfile: run.scoreProfile,
      structural: run.scores.structural,
      factuality: run.scores.factuality,
      consistency: run.scores.consistency,
      timeliness: run.scores.timeliness,
      thresholdBreaches: run.thresholdBreaches,
    },
  })

  telemetry({
    kind: "investing.eval.gate",
    traceID: run.id,
    method: "evaluate",
    path: dataset.name,
    route: dataset.id,
    status: run.gate.ok ? "ok" : "error",
    metadata: {
      owner: run.owner,
      routingKey: run.gate.routingKey,
      baselineRunId: run.baselineRunId,
      blockedBy: run.gate.blockedBy,
      regressionCount,
      alertCount: run.alerts.length,
      strictCommand: run.gate.strictCommand,
    },
  })

  for (const alert of run.alerts) {
    telemetry({
      kind: "investing.eval.alert",
      traceID: `${run.id}:${alert.code}`,
      method: "route",
      path: alert.routingKey,
      route: dataset.id,
      status: alert.severity === "error" ? "error" : "ok",
      metadata: {
        owner: alert.owner,
        code: alert.code,
        message: alert.message,
        runbookSteps: alert.runbook.length,
      },
    })
  }

  return run
}

export function getInvestingEvalRun(runId: string): InvestingEvalRun | null {
  const state = readEvalState()
  return state.runs.find((entry) => entry.id === runId) ?? null
}

export function listInvestingEvalRuns(options?: {
  datasetId?: string
  status?: InvestingEvalRunStatus
  limit?: number
}): InvestingEvalRun[] {
  return readEvalState()
    .runs.filter((run) => (options?.datasetId ? run.datasetId === options.datasetId : true))
    .filter((run) => (options?.status ? run.status === options.status : true))
    .slice(0, options?.limit ?? 20)
}
