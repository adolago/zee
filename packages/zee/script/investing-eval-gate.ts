import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInvestingResearchArtifact } from "../../../src/domain/investing/artifacts"
import { createInvestingPortfolioBriefing } from "../../../src/domain/investing/briefings"
import { createInvestingEvalDataset } from "../../../src/domain/investing/evals"
import {
  recordInvestingThesisRevision,
  syncInvestingThesisContext,
  thesisKeyForSymbol,
} from "../../../src/domain/investing/thesis"
import type { InvestingResearchExecution } from "../../../src/domain/investing/executor"
import type { InvestingResearchPlan, InvestingResearchTask } from "../../../src/domain/investing/planner"

function seedThesis(symbol: string): void {
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

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "zee-investing-eval-gate-"))
  const originalStateHome = process.env.XDG_STATE_HOME
  const originalPortfolioFile = process.env.ZEE_INVESTING_PORTFOLIO_FILE
  const originalWatchlistFile = process.env.ZEE_INVESTING_WATCHLIST_FILE
  const packageRoot = path.resolve(import.meta.dir, "..")

  process.env.XDG_STATE_HOME = tempRoot
  process.env.ZEE_INVESTING_PORTFOLIO_FILE = path.join(tempRoot, "portfolio.json")
  process.env.ZEE_INVESTING_WATCHLIST_FILE = path.join(tempRoot, "watchlist.json")

  try {
    writeFileSync(
      process.env.ZEE_INVESTING_PORTFOLIO_FILE,
      JSON.stringify({ positions: [{ symbol: "NVDA", shares: 10, averageCost: 90 }] }, null, 2),
    )
    writeFileSync(process.env.ZEE_INVESTING_WATCHLIST_FILE, JSON.stringify({ symbols: ["AAPL"] }, null, 2))

    seedThesis("NVDA")
    const artifact = makeResearchArtifact("NVDA")
    const briefing = await createInvestingPortfolioBriefing()
    const dataset = createInvestingEvalDataset({
      name: "ci-investing-eval-gate",
      description: "Fixture-backed eval gate for CI and local release checks.",
      owner: "release-quality-owner",
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

    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "src/index.ts",
        "investing",
        "eval",
        "run",
        "create",
        dataset.id,
        "--strict",
        "--json",
      ],
      cwd: packageRoot,
      env: {
        ...process.env,
        XDG_STATE_HOME: tempRoot,
        ZEE_INVESTING_PORTFOLIO_FILE: process.env.ZEE_INVESTING_PORTFOLIO_FILE!,
        ZEE_INVESTING_WATCHLIST_FILE: process.env.ZEE_INVESTING_WATCHLIST_FILE!,
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = result.stdout.toString().trim()
    const stderr = result.stderr.toString().trim()
    if (result.exitCode !== 0) {
      if (stdout) console.error(stdout)
      if (stderr) console.error(stderr)
      throw new Error(`Strict investing eval gate failed with exit code ${result.exitCode}.`)
    }

    const jsonStart = stdout.indexOf("{")
    const payload = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout
    const run = JSON.parse(payload) as {
      id: string
      owner: string
      gate: { ok: boolean; routingKey: string }
      alerts: unknown[]
      thresholdBreaches: unknown[]
      scores: Record<string, unknown>
    }

    if (!run.gate?.ok) {
      throw new Error("Fixture investing eval gate reported a blocked run.")
    }
    if (run.owner !== "release-quality-owner") {
      throw new Error(`Unexpected owner on fixture eval gate: ${run.owner}`)
    }
    if (run.gate.routingKey !== "owner:release-quality-owner") {
      throw new Error(`Unexpected routing key on fixture eval gate: ${run.gate.routingKey}`)
    }
    if (run.alerts.length > 0 || run.thresholdBreaches.length > 0) {
      throw new Error("Fixture investing eval gate emitted unexpected alerts or threshold breaches.")
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          datasetId: dataset.id,
          runId: run.id,
          owner: run.owner,
          gate: run.gate,
          scores: run.scores,
        },
        null,
        2,
      ),
    )
  } finally {
    if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = originalStateHome

    if (originalPortfolioFile === undefined) delete process.env.ZEE_INVESTING_PORTFOLIO_FILE
    else process.env.ZEE_INVESTING_PORTFOLIO_FILE = originalPortfolioFile

    if (originalWatchlistFile === undefined) delete process.env.ZEE_INVESTING_WATCHLIST_FILE
    else process.env.ZEE_INVESTING_WATCHLIST_FILE = originalWatchlistFile

    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
