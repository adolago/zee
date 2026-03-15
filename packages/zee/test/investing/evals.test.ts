import { describe, expect, spyOn, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import {
  createInvestingResearchArtifact,
  getInvestingResearchArtifactStateFile,
} from "../../../../src/domain/investing/artifacts"
import { createInvestingPortfolioBriefing } from "../../../../src/domain/investing/briefings"
import { createInvestingEvalDataset, runInvestingEvalDataset } from "../../../../src/domain/investing/evals"
import { evalsTool } from "../../../../src/domain/investing/tools"
import {
  recordInvestingThesisRevision,
  syncInvestingThesisContext,
  thesisKeyForSymbol,
} from "../../../../src/domain/investing/thesis"
import type { InvestingResearchExecution } from "../../../../src/domain/investing/executor"
import type { InvestingResearchPlan, InvestingResearchTask } from "../../../../src/domain/investing/planner"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function withEvalState<T>(fn: (root: string) => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalStateHome = process.env.XDG_STATE_HOME
  const originalPortfolioFile = process.env.ZEE_INVESTING_PORTFOLIO_FILE
  const originalWatchlistFile = process.env.ZEE_INVESTING_WATCHLIST_FILE

  process.env.XDG_STATE_HOME = dir.path
  process.env.ZEE_INVESTING_PORTFOLIO_FILE = path.join(dir.path, "portfolio.json")
  process.env.ZEE_INVESTING_WATCHLIST_FILE = path.join(dir.path, "watchlist.json")

  try {
    return await fn(dir.path)
  } finally {
    if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = originalStateHome

    if (originalPortfolioFile === undefined) delete process.env.ZEE_INVESTING_PORTFOLIO_FILE
    else process.env.ZEE_INVESTING_PORTFOLIO_FILE = originalPortfolioFile

    if (originalWatchlistFile === undefined) delete process.env.ZEE_INVESTING_WATCHLIST_FILE
    else process.env.ZEE_INVESTING_WATCHLIST_FILE = originalWatchlistFile
  }
}

function seedThesis(symbol: string) {
  const thesisKey = thesisKeyForSymbol(symbol)
  syncInvestingThesisContext({
    thesisKey,
    symbol,
    summary: `${symbol} thesis context.`,
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}`,
      runId: `valuation-run-${symbol.toLowerCase()}`,
      signal: "re-rate-up",
      fairValue: 140,
      currentPrice: 100,
      upsidePercent: 40,
    },
  })
  recordInvestingThesisRevision({
    thesisKey,
    symbol,
    changeType: "initialize",
    summary: `${symbol} thesis initialized.`,
    thesis: `${symbol} thesis body.`,
    conviction: "high",
    posture: "bullish",
    watchpoints: [`Track ${symbol} demand`],
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}`,
      runId: `valuation-run-${symbol.toLowerCase()}`,
      signal: "re-rate-up",
      fairValue: 140,
      currentPrice: 100,
      upsidePercent: 40,
    },
    evidence: [
      {
        kind: "research-evidence",
        id: `evidence-${symbol.toLowerCase()}`,
        label: `[E1] Research summary for ${symbol}`,
        link: `evidence:${symbol}:E1`,
        toolId: "zee:invest-research",
      },
      {
        kind: "valuation-packet",
        id: `valuation-packet-${symbol.toLowerCase()}`,
        label: `Valuation packet for ${symbol}`,
        link: `valuation-packet:valuation-packet-${symbol.toLowerCase()}`,
        toolId: "zee:invest-valuation",
      },
    ],
  })
}

function makeResearchArtifact(symbol: string) {
  const timestamp = "2026-03-15T10:00:00.000Z"
  const task: InvestingResearchTask = {
    id: "brief-synthesis",
    phase: "synthesis",
    title: "Write preview brief",
    description: `Synthesize the current preview view for ${symbol}.`,
    toolIds: ["zee:invest-research", "zee:invest-market-data"],
    dependsOn: [],
    deliverable: "Preview synthesis with citations.",
    status: "completed",
  }
  const plan: InvestingResearchPlan = {
    id: `plan-${symbol.toLowerCase()}`,
    objective: `Prepare the preview view for ${symbol}`,
    workflow: "earnings-preview",
    symbols: [symbol],
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    tasks: [task],
  }
  const execution: InvestingResearchExecution = {
    id: `execution-${symbol.toLowerCase()}`,
    planId: plan.id,
    taskId: task.id,
    workflow: plan.workflow,
    status: "ok",
    startedAt: timestamp,
    finishedAt: timestamp,
    synthesis: `${symbol} preview synthesis captures the setup, catalysts, and open questions.`,
    provenance: null,
    evidence: [
      {
        id: `evidence-${symbol.toLowerCase()}-research`,
        citation: "E1",
        link: `evidence:${symbol}:E1`,
        toolId: "zee:invest-research",
        sourceLabel: `${symbol} research endpoint`,
        args: { symbol },
        collectedAt: timestamp,
        status: "completed",
        summary: `${symbol} research summary`,
        data: { symbol, summary: `${symbol} research summary` },
      },
      {
        id: `evidence-${symbol.toLowerCase()}-market`,
        citation: "E2",
        link: `evidence:${symbol}:E2`,
        toolId: "zee:invest-market-data",
        sourceLabel: `${symbol} market data`,
        args: { symbol },
        collectedAt: timestamp,
        status: "completed",
        summary: `${symbol} market snapshot`,
        data: { symbol, price: 100 },
      },
    ],
  }

  return createInvestingResearchArtifact({
    execution,
    plan,
    task,
  })
}

describe("investing eval harness", () => {
  test("captures a golden-set dataset and runs the harness across persisted outputs", async () => {
    await withEvalState(async (root) => {
      const recordSpy = spyOn(FluxRecorder, "record")
      writeFileSync(
        path.join(root, "portfolio.json"),
        JSON.stringify({ positions: [{ symbol: "NVDA", shares: 10, averageCost: 90 }] }, null, 2),
      )
      writeFileSync(path.join(root, "watchlist.json"), JSON.stringify({ symbols: ["AAPL"] }, null, 2))

      seedThesis("NVDA")
      const artifact = makeResearchArtifact("NVDA")
      const briefing = await createInvestingPortfolioBriefing()

      const dataset = createInvestingEvalDataset({
        name: "daily-research-goldens",
        description: "Golden-set coverage for daily research outputs.",
        owner: "research-qa",
        cases: [
          {
            label: "NVDA preview artifact",
            sourceKind: "research-artifact",
            sourceId: artifact.id,
            expectations: { freshnessWithinHours: 48 },
          },
          {
            label: "Daily portfolio briefing",
            sourceKind: "portfolio-briefing",
            sourceId: briefing.id,
          },
        ],
      })
      expect(dataset.cases).toHaveLength(2)
      expect(dataset.audit.captureCount).toBe(2)
      expect(dataset.cases[0]?.golden.sectionTitles).toContain("Synthesis")

      const run = runInvestingEvalDataset({ datasetId: dataset.id })
      expect(run.status).toBe("pass")
      expect(run.owner).toBe("research-qa")
      expect(run.totals.passCount).toBe(2)
      expect(run.scores.structural).toBe(100)
      expect(run.scores.factuality).toBeGreaterThanOrEqual(85)
      expect(run.scores.consistency).toBeGreaterThanOrEqual(85)
      expect(run.scores.timeliness).toBeGreaterThanOrEqual(80)
      expect(run.thresholdBreaches).toEqual([])
      expect(run.baselineRunId).toBeNull()
      expect(run.regression).toBeNull()
      expect(run.alerts).toEqual([])
      expect(run.gate.ok).toBe(true)
      expect(run.gate.routingKey).toBe("owner:research-qa")

      const tool = await evalsTool.init()
      const result = await tool.execute(
        {
          action: "list-runs",
          datasetId: dataset.id,
          limit: 10,
        },
        makeToolContext() as never,
      )
      const payload = JSON.parse(result.output)
      expect(payload.count).toBe(1)
      expect(payload.runs[0].status).toBe("pass")

      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.eval.dataset")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.eval.run")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.eval.score")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.eval.gate")).toBe(true)
    })
  })

  test("flags drift when a golden-set source changes after capture", async () => {
    await withEvalState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      const artifact = makeResearchArtifact("NVDA")
      const dataset = createInvestingEvalDataset({
        name: "artifact-drift",
        description: "Detect summary drift in the research artifact golden set.",
        owner: "research-qa",
        cases: [
          {
            label: "NVDA preview artifact",
            sourceKind: "research-artifact",
            sourceId: artifact.id,
          },
        ],
      })
      const baselineRun = runInvestingEvalDataset({ datasetId: dataset.id })
      expect(baselineRun.gate.ok).toBe(true)

      const state = JSON.parse(readFileSync(getInvestingResearchArtifactStateFile(), "utf8")) as {
        version: number
        artifacts: Array<Record<string, unknown>>
      }
      state.artifacts[0] = {
        ...state.artifacts[0],
        summary: "Mutated summary that should fail the golden snapshot comparison.",
      }
      writeFileSync(getInvestingResearchArtifactStateFile(), JSON.stringify(state, null, 2) + "\n", "utf8")

      const tool = await evalsTool.init()
      const result = await tool.execute(
        {
          action: "run-dataset",
          datasetId: dataset.id,
        },
        makeToolContext() as never,
      )
      const payload = JSON.parse(result.output)
      expect(payload.status).toBe("fail")
      expect(payload.owner).toBe("research-qa")
      expect(payload.baselineRunId).toBe(baselineRun.id)
      expect(payload.results[0].checks.find((check: { id: string }) => check.id === "summary-match")?.passed).toBe(
        false,
      )
      expect(payload.scores.structural).toBe(0)
      expect(payload.scores.consistency).toBeLessThan(85)
      expect(payload.thresholdBreaches).toContain("structural")
      expect(payload.regression.regressionCount).toBeGreaterThan(0)
      expect(payload.regression.caseRegressions[0].lostChecks).toContain("summary-match")
      expect(payload.alerts.some((alert: { code: string }) => alert.code === "investing.eval.regression")).toBe(true)
      expect(payload.alerts.some((alert: { routingKey: string }) => alert.routingKey === "owner:research-qa")).toBe(
        true,
      )
      expect(payload.gate.ok).toBe(false)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.eval.alert")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.eval.gate")).toBe(true)
    })
  })
})
