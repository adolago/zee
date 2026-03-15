import type {
  InvestingEvalCaseResult,
  InvestingEvalDataset,
  InvestingEvalRun,
  InvestingEvalRunScores,
  InvestingEvalRunStatus,
} from "./evals"
import type { InvestingEvalCaseScores } from "./eval-scoring"

export const INVESTING_EVAL_ALERT_SEVERITIES = ["error", "warning"] as const
export type InvestingEvalAlertSeverity = (typeof INVESTING_EVAL_ALERT_SEVERITIES)[number]

export const INVESTING_EVAL_REGRESSION_DROP_THRESHOLD = 5 as const

const RUN_SCORE_DIMENSIONS = ["structural", "factuality", "consistency", "timeliness"] as const
const CASE_SCORE_DIMENSIONS = ["structural", "factuality", "consistency", "timeliness"] as const

export interface InvestingEvalScoreDrop<TDimension extends string> {
  dimension: TDimension
  previous: number
  current: number
  delta: number
}

export interface InvestingEvalCaseRegression {
  caseId: string
  label: string
  previousStatus: InvestingEvalRunStatus
  currentStatus: InvestingEvalRunStatus
  newThresholdBreaches: Array<Extract<keyof InvestingEvalCaseScores, string>>
  lostChecks: string[]
  scoreDrops: Array<InvestingEvalScoreDrop<Extract<keyof InvestingEvalCaseScores, string>>>
}

export interface InvestingEvalRunRegression {
  baselineRunId: string
  regressionCount: number
  newThresholdBreaches: Array<Extract<keyof InvestingEvalRunScores, string>>
  scoreDrops: Array<InvestingEvalScoreDrop<Extract<keyof InvestingEvalRunScores, string>>>
  caseRegressions: InvestingEvalCaseRegression[]
}

export interface InvestingEvalRunAlert {
  severity: InvestingEvalAlertSeverity
  code: string
  message: string
  owner: string
  routingKey: string
  runbook: string[]
}

export interface InvestingEvalRunGate {
  ok: boolean
  owner: string
  routingKey: string
  blockedBy: string[]
  strictCommand: string
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function toNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function collectScoreDrops<TDimension extends string>(
  dimensions: readonly TDimension[],
  current: Record<TDimension, number | null | undefined>,
  previous: Record<TDimension, number | null | undefined>,
): Array<InvestingEvalScoreDrop<TDimension>> {
  return dimensions.flatMap((dimension) => {
    const currentValue = toNumber(current[dimension])
    const previousValue = toNumber(previous[dimension])
    if (currentValue == null || previousValue == null || currentValue >= previousValue) {
      return []
    }

    const delta = round(previousValue - currentValue)
    if (delta < INVESTING_EVAL_REGRESSION_DROP_THRESHOLD) {
      return []
    }

    return [
      {
        dimension,
        previous: previousValue,
        current: currentValue,
        delta,
      },
    ]
  })
}

function collectLostChecks(current: InvestingEvalCaseResult, previous: InvestingEvalCaseResult): string[] {
  const previousPassed = new Set(previous.checks.filter((check) => check.passed).map((check) => check.id))
  return current.checks.filter((check) => !check.passed && previousPassed.has(check.id)).map((check) => check.id)
}

export function buildInvestingEvalRunRegression(input: {
  previousRun: InvestingEvalRun | null
  currentRun: Pick<InvestingEvalRun, "id" | "thresholdBreaches" | "scores" | "results">
}): InvestingEvalRunRegression | null {
  if (!input.previousRun) {
    return null
  }

  const previousRun = input.previousRun
  const currentRun = input.currentRun
  const previousResults = new Map(previousRun.results.map((result) => [result.caseId, result]))
  const caseRegressions = currentRun.results.flatMap((result) => {
    const previous = previousResults.get(result.caseId)
    if (!previous) {
      return []
    }

    const newThresholdBreaches = result.thresholdBreaches.filter(
      (dimension) => !previous.thresholdBreaches.includes(dimension),
    )
    const lostChecks = collectLostChecks(result, previous)
    const scoreDrops = collectScoreDrops(CASE_SCORE_DIMENSIONS, result.scores, previous.scores)
    const statusRegressed = previous.status === "pass" && result.status !== "pass"

    if (!statusRegressed && newThresholdBreaches.length === 0 && lostChecks.length === 0 && scoreDrops.length === 0) {
      return []
    }

    return [
      {
        caseId: result.caseId,
        label: result.label,
        previousStatus: previous.status,
        currentStatus: result.status,
        newThresholdBreaches,
        lostChecks,
        scoreDrops,
      },
    ]
  })

  const newThresholdBreaches = currentRun.thresholdBreaches.filter(
    (dimension) => !previousRun.thresholdBreaches.includes(dimension),
  )
  const scoreDrops = collectScoreDrops(RUN_SCORE_DIMENSIONS, currentRun.scores, previousRun.scores)
  const regressionCount = newThresholdBreaches.length + scoreDrops.length + caseRegressions.length

  return {
    baselineRunId: previousRun.id,
    regressionCount,
    newThresholdBreaches,
    scoreDrops,
    caseRegressions,
  }
}

export function buildInvestingEvalRunAlerts(input: {
  dataset: InvestingEvalDataset
  run: Pick<InvestingEvalRun, "id" | "datasetId" | "status" | "thresholdBreaches">
  regression: InvestingEvalRunRegression | null
}): InvestingEvalRunAlert[] {
  const routingKey = `owner:${input.dataset.owner}`
  const alerts: InvestingEvalRunAlert[] = []

  if (input.run.status !== "pass") {
    alerts.push({
      severity: "error",
      code: "investing.eval.run-failed",
      message: `Eval dataset ${input.dataset.name} failed and requires owner review.`,
      owner: input.dataset.owner,
      routingKey,
      runbook: [
        `Inspect zee investing eval run read ${input.run.id} --json for the failing cases.`,
        `Review the owning workflow output for dataset ${input.dataset.id}.`,
        `Re-run zee investing eval run create ${input.dataset.id} --strict after fixing the source output.`,
      ],
    })
  }

  if (input.run.thresholdBreaches.length > 0) {
    alerts.push({
      severity: "error",
      code: "investing.eval.threshold-breach",
      message: `Eval dataset ${input.dataset.name} breached thresholds: ${input.run.thresholdBreaches.join(", ")}.`,
      owner: input.dataset.owner,
      routingKey,
      runbook: [
        `Review the scored dimensions in zee investing eval run read ${input.run.id} --json.`,
        `Compare against the previous baseline with zee investing eval run list --dataset-id ${input.dataset.id}.`,
        `Do not release until the breached dimensions recover above threshold.`,
      ],
    })
  }

  if ((input.regression?.regressionCount ?? 0) > 0) {
    alerts.push({
      severity: "error",
      code: "investing.eval.regression",
      message: `Eval dataset ${input.dataset.name} regressed against baseline ${input.regression?.baselineRunId}.`,
      owner: input.dataset.owner,
      routingKey,
      runbook: [
        `Inspect regression details in zee investing eval run read ${input.run.id} --json.`,
        `Compare against baseline ${input.regression?.baselineRunId}.`,
        `Route follow-up to ${routingKey} before re-running the strict gate.`,
      ],
    })
  }

  return alerts
}

export function buildInvestingEvalRunGate(input: {
  dataset: InvestingEvalDataset
  run: Pick<InvestingEvalRun, "datasetId" | "status" | "thresholdBreaches">
  regression: InvestingEvalRunRegression | null
}): InvestingEvalRunGate {
  const blockedBy: string[] = []
  if (input.run.status !== "pass") {
    blockedBy.push(`run status is ${input.run.status}`)
  }
  if (input.run.thresholdBreaches.length > 0) {
    blockedBy.push(`threshold breaches: ${input.run.thresholdBreaches.join(", ")}`)
  }
  if ((input.regression?.regressionCount ?? 0) > 0) {
    blockedBy.push(`regressions detected against ${input.regression?.baselineRunId}`)
  }

  return {
    ok: blockedBy.length === 0,
    owner: input.dataset.owner,
    routingKey: `owner:${input.dataset.owner}`,
    blockedBy,
    strictCommand: `zee investing eval run create ${input.run.datasetId} --strict`,
  }
}
