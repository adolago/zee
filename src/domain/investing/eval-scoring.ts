/**
 * Investing Evaluation Scorers
 *
 * Deterministic factuality, consistency, and timeliness scorers layered on top
 * of the golden-set harness results from investing eval datasets.
 */

import type { InvestingEvalCaseResult, InvestingEvalDatasetCase, InvestingEvalSourceKind } from "./evals"

export const INVESTING_EVAL_SCORE_PROFILE = "research-leads.v1" as const

export interface InvestingEvalThresholdProfile {
  profile: typeof INVESTING_EVAL_SCORE_PROFILE
  structural: number
  factuality: number
  consistency: number
  timeliness: number
}

export interface InvestingEvalCaseScores {
  structural: number
  factuality: number
  consistency: number
  timeliness: number
}

export interface InvestingEvalCaseScoring {
  scores: InvestingEvalCaseScores
  thresholdBreaches: Array<keyof InvestingEvalCaseScores>
  reasons: {
    factuality: string[]
    consistency: string[]
    timeliness: string[]
  }
}

export const INVESTING_EVAL_THRESHOLDS: InvestingEvalThresholdProfile = {
  profile: INVESTING_EVAL_SCORE_PROFILE,
  structural: 100,
  factuality: 85,
  consistency: 85,
  timeliness: 80,
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, round(value)))
}

function defaultTimelinessWindowForSourceKind(sourceKind: InvestingEvalSourceKind): number {
  switch (sourceKind) {
    case "portfolio-briefing":
      return 24
    case "earnings-packet":
      return 48
    case "research-artifact":
    default:
      return 72
  }
}

function checkPassed(result: InvestingEvalCaseResult, checkId: string): boolean {
  return result.checks.find((check) => check.id === checkId)?.passed ?? false
}

export function scoreInvestingEvalCase(input: {
  evalCase: InvestingEvalDatasetCase
  result: InvestingEvalCaseResult
}): InvestingEvalCaseScoring {
  const structural =
    input.result.checks.length > 0 ? clampPercent((input.result.passCount / input.result.checks.length) * 100) : 0

  if (!input.result.live) {
    return {
      scores: {
        structural,
        factuality: 0,
        consistency: 0,
        timeliness: 0,
      },
      thresholdBreaches: ["structural", "factuality", "consistency", "timeliness"],
      reasons: {
        factuality: ["Live source could not be loaded, so factuality is 0."],
        consistency: ["Live source could not be loaded, so consistency is 0."],
        timeliness: ["Live source could not be loaded, so timeliness is 0."],
      },
    }
  }

  const live = input.result.live
  const citationTarget = input.evalCase.expectations.minCitationCount
  const citationCoverage = citationTarget > 0 ? Math.min(live.citationCount / citationTarget, 1) : 1
  const diagnosticBudget = Math.max(1, input.evalCase.expectations.maxDiagnosticCount + 1)
  const diagnosticHealth = Math.max(
    0,
    1 - Math.max(0, live.diagnosticCount - input.evalCase.expectations.maxDiagnosticCount) / diagnosticBudget,
  )
  const summaryMatch = checkPassed(input.result, "summary-match") ? 1 : 0.45
  const statusMatch = checkPassed(input.result, "status-match") ? 1 : 0.6
  const factuality = clampPercent(
    (citationCoverage * 0.45 + diagnosticHealth * 0.25 + summaryMatch * 0.2 + statusMatch * 0.1) * 100,
  )

  const sectionMatch = checkPassed(input.result, "section-titles") ? 1 : 0.4
  const symbolMatch = checkPassed(input.result, "symbols-match") ? 1 : 0.5
  const workflowMatch = input.result.checks.some((check) => check.id === "workflow-match")
    ? checkPassed(input.result, "workflow-match")
      ? 1
      : 0.5
    : 1
  const consistency = clampPercent(
    (summaryMatch * 0.35 + sectionMatch * 0.35 + symbolMatch * 0.15 + workflowMatch * 0.15) * 100,
  )

  const timelinessWindow =
    input.evalCase.expectations.freshnessWithinHours ?? defaultTimelinessWindowForSourceKind(input.evalCase.sourceKind)
  const ageHours = (Date.now() - Date.parse(live.updatedAt)) / (60 * 60 * 1000)
  const timelinessRatio = timelinessWindow > 0 ? ageHours / timelinessWindow : 0
  const timeliness = clampPercent(
    timelinessRatio <= 1 ? 100 : timelinessRatio <= 3 ? 100 - (timelinessRatio - 1) * 50 : 0,
  )

  const scores: InvestingEvalCaseScores = {
    structural,
    factuality,
    consistency,
    timeliness,
  }
  const thresholdBreaches = (Object.keys(scores) as Array<keyof InvestingEvalCaseScores>).filter(
    (dimension) => scores[dimension] < INVESTING_EVAL_THRESHOLDS[dimension],
  )

  return {
    scores,
    thresholdBreaches,
    reasons: {
      factuality: [
        citationTarget > 0
          ? `Citation coverage ${live.citationCount}/${citationTarget} contributed ${(citationCoverage * 45).toFixed(1)} points.`
          : "Citation coverage was not required for this case and contributed 45.0 points.",
        `Diagnostic health contributed ${(diagnosticHealth * 25).toFixed(1)} points with ${live.diagnosticCount} diagnostic(s).`,
        `Summary and status alignment contributed ${((summaryMatch * 0.2 + statusMatch * 0.1) * 100).toFixed(1)} points.`,
      ],
      consistency: [
        `Summary alignment contributed ${(summaryMatch * 35).toFixed(1)} points.`,
        `Section-title alignment contributed ${(sectionMatch * 35).toFixed(1)} points.`,
        `Symbol/workflow coverage contributed ${((symbolMatch * 0.15 + workflowMatch * 0.15) * 100).toFixed(1)} points.`,
      ],
      timeliness: [`Age ${round(ageHours)}h was scored against a ${timelinessWindow}h freshness window.`],
    },
  }
}
