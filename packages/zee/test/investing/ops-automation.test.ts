import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { FluxRecorder } from "../../src/flux"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import { classifyInvestingConnectorEvents, upsertInvestingEvents } from "../../src/investing/events"
import { tmpdir } from "../fixture/fixture"
import { createInvestingResearchArtifact } from "../../../../src/domain/investing/artifacts"
import {
  createInvestingOpsSchedule,
  getInvestingOpsSchedule,
  listInvestingOpsDeliveryRecords,
  registerInvestingOpsSchedules,
} from "../../../../src/domain/investing/ops-automation"
import {
  getInvestingResearchExecutionStateFile,
  type InvestingResearchExecution,
} from "../../../../src/domain/investing/executor"
import { createInvestingResearchPlan } from "../../../../src/domain/investing/planner"
import { opsAutomationTool } from "../../../../src/domain/investing/tools"
import {
  recordInvestingThesisRevision,
  syncInvestingThesisContext,
  thesisKeyForSymbol,
} from "../../../../src/domain/investing/thesis"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function seedEventDelta(symbol: string, headline: string) {
  const events = classifyInvestingConnectorEvents({
    connector: "news",
    entities: normalizeInvestingConnectorEntities({
      connector: "news",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: [
        {
          symbol,
          articleId: `${symbol.toLowerCase()}-${headline.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          publishedAt: "2026-03-15T09:30:00.000Z",
          title: headline,
          summary: `${headline} for ${symbol}.`,
          sector: "Technology",
        },
      ],
    }),
  })
  await upsertInvestingEvents({ events })
}

function seedThesis(symbol: string, summary: string) {
  const thesisKey = thesisKeyForSymbol(symbol)
  syncInvestingThesisContext({
    thesisKey,
    symbol,
    summary,
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}`,
      runId: `valuation-run-${symbol.toLowerCase()}`,
      signal: "re-rate-up",
      fairValue: 125,
      currentPrice: 100,
      upsidePercent: 25,
    },
  })
  recordInvestingThesisRevision({
    thesisKey,
    symbol,
    changeType: "refresh",
    summary,
    thesis: `${summary} Thesis body for ${symbol}.`,
    conviction: "high",
    posture: "bullish",
    evidence: [
      {
        kind: "research-evidence",
        id: `evidence-${symbol.toLowerCase()}`,
        label: `[E1] Research summary for ${symbol}`,
        link: `evidence:research-${symbol}:E1`,
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
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}`,
      runId: `valuation-run-${symbol.toLowerCase()}`,
      signal: "re-rate-up",
      fairValue: 125,
      currentPrice: 100,
      upsidePercent: 25,
    },
  })
}

function makeExecution(input: {
  id: string
  planId: string
  taskId: string
  workflow: string
  symbol: string
  synthesis: string
}): InvestingResearchExecution {
  return {
    id: input.id,
    planId: input.planId,
    taskId: input.taskId,
    workflow: input.workflow,
    status: "ok",
    startedAt: "2026-03-15T10:00:00.000Z",
    finishedAt: "2026-03-15T10:05:00.000Z",
    synthesis: input.synthesis,
    provenance: null,
    evidence: [
      {
        id: `${input.id}:E1`,
        citation: "E1",
        link: `evidence:${input.id}:E1`,
        toolId: "zee:invest-research",
        sourceLabel: "Research endpoint",
        args: { symbol: input.symbol },
        collectedAt: "2026-03-15T10:01:00.000Z",
        status: "completed",
        summary: `${input.symbol} setup summary`,
        data: { symbol: input.symbol, summary: `${input.symbol} research summary` },
      },
      {
        id: `${input.id}:E2`,
        citation: "E2",
        link: `evidence:${input.id}:E2`,
        toolId: "zee:invest-valuation",
        sourceLabel: "Investing Valuation Kernel",
        args: { symbol: input.symbol },
        collectedAt: "2026-03-15T10:02:00.000Z",
        status: "completed",
        summary: `${input.symbol} valuation snapshot`,
        data: {
          id: `valuation-run-${input.symbol.toLowerCase()}`,
          valuationCaseId: `valuation_case:equity:${input.symbol.toLowerCase()}:base`,
          blendedFairValue: 125,
          currentPrice: 100,
          upsidePercent: 25,
          thesisContext: {
            signal: "re-rate-up",
          },
        },
      },
    ],
  }
}

async function persistExecution(execution: InvestingResearchExecution): Promise<void> {
  const stateFile = getInvestingResearchExecutionStateFile()
  mkdirSync(path.dirname(stateFile), { recursive: true })
  await Bun.write(
    stateFile,
    JSON.stringify({
      version: 1,
      executions: [execution],
    }),
  )
}

async function withOpsState<T>(fn: () => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalStateHome = process.env.XDG_STATE_HOME
  const originalPortfolioFile = process.env.ZEE_INVESTING_PORTFOLIO_FILE
  const originalWatchlistFile = process.env.ZEE_INVESTING_WATCHLIST_FILE
  process.env.XDG_STATE_HOME = dir.path
  process.env.ZEE_INVESTING_PORTFOLIO_FILE = `${dir.path}/portfolio.json`
  process.env.ZEE_INVESTING_WATCHLIST_FILE = `${dir.path}/watchlist.json`

  await Bun.write(
    process.env.ZEE_INVESTING_PORTFOLIO_FILE,
    JSON.stringify({
      positions: [{ symbol: "NVDA", shares: 10, average_cost: 95 }],
    }),
  )
  await Bun.write(
    process.env.ZEE_INVESTING_WATCHLIST_FILE,
    JSON.stringify({
      watchlist: [{ symbol: "MSFT" }],
    }),
  )

  try {
    return await fn()
  } finally {
    if (originalStateHome === undefined) {
      delete process.env.XDG_STATE_HOME
    } else {
      process.env.XDG_STATE_HOME = originalStateHome
    }
    if (originalPortfolioFile === undefined) {
      delete process.env.ZEE_INVESTING_PORTFOLIO_FILE
    } else {
      process.env.ZEE_INVESTING_PORTFOLIO_FILE = originalPortfolioFile
    }
    if (originalWatchlistFile === undefined) {
      delete process.env.ZEE_INVESTING_WATCHLIST_FILE
    } else {
      process.env.ZEE_INVESTING_WATCHLIST_FILE = originalWatchlistFile
    }
  }
}

describe("investing ops automation", () => {
  test("registers unattended schedules and persists a delivery audit trail for daily briefings", async () => {
    await withOpsState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      const schedule = createInvestingOpsSchedule({
        workflow: "daily-portfolio-brief",
        scheduleMinutes: 15,
        format: "markdown",
      })

      const tasks: Array<{ id: string; interval: number; run: () => void | Promise<void> }> = []
      const registrations = registerInvestingOpsSchedules({
        register: (task) => {
          tasks.push(task)
        },
      })

      expect(registrations).toHaveLength(1)
      expect(registrations[0]?.scheduleId).toBe(schedule.id)
      expect(tasks[0]?.interval).toBe(15 * 60 * 1000)

      await tasks[0]?.run()

      const deliveries = listInvestingOpsDeliveryRecords({
        scheduleId: schedule.id,
      })
      expect(deliveries).toHaveLength(1)
      expect(deliveries[0]?.status).toBe("ok")
      expect(deliveries[0]?.artifactKind).toBe("portfolio-briefing")
      expect(deliveries[0]?.content).toContain("Portfolio Briefing:")
      expect(getInvestingOpsSchedule(schedule.id)?.audit.lastStatus).toBe("ok")
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.ops.schedule")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.ops.delivery")).toBe(true)
    })
  })

  test("tool surface can create, update, run, and inspect earnings automation deliveries", async () => {
    await withOpsState(async () => {
      seedThesis("NVDA", "NVDA enters earnings with an improving setup.")
      await seedEventDelta("NVDA", "NVDA raises guidance ahead of earnings")

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      const task = plan.tasks.find((entry) => entry.id === "preview-brief")
      if (!task) throw new Error("preview task should exist")

      const execution = makeExecution({
        id: "research-execution-ops",
        planId: plan.id,
        taskId: task.id,
        workflow: plan.workflow,
        symbol: "NVDA",
        synthesis: "Automated earnings packet delivery should surface the latest setup.",
      })
      const artifact = createInvestingResearchArtifact({
        execution,
        plan,
        task,
      })
      execution.artifactId = artifact.id
      await persistExecution(execution)

      const runtime = await opsAutomationTool.init()
      const ctx = makeToolContext()

      const createResult = await runtime.execute(
        {
          action: "create-schedule",
          workflow: "earnings-preview-packet",
          scheduleMinutes: 30,
          symbol: "NVDA",
          format: "json",
          deliveryTarget: "audit-log",
        },
        ctx,
      )
      const created = JSON.parse(createResult.output) as { id: string }
      expect(created.id).toBeDefined()

      const updateResult = await runtime.execute(
        {
          action: "update-schedule",
          scheduleId: created.id,
          format: "markdown",
        },
        ctx,
      )
      expect(JSON.parse(updateResult.output)).toMatchObject({
        id: created.id,
        format: "markdown",
      })

      const runResult = await runtime.execute(
        {
          action: "run-schedule",
          scheduleId: created.id,
        },
        ctx,
      )
      const delivery = JSON.parse(runResult.output) as { id: string; status: string; content: string }
      expect(delivery.status).toBe("ok")

      const readDeliveryResult = await runtime.execute(
        {
          action: "read-delivery",
          deliveryId: delivery.id,
        },
        ctx,
      )
      expect(JSON.parse(readDeliveryResult.output)).toMatchObject({
        id: delivery.id,
        status: "ok",
      })

      const listDeliveriesResult = await runtime.execute(
        {
          action: "list-deliveries",
          workflow: "earnings-preview-packet",
          symbol: "NVDA",
          limit: 5,
        },
        ctx,
      )
      const listed = JSON.parse(listDeliveriesResult.output) as {
        count: number
        deliveries: Array<{ id: string; content: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.deliveries.some((entry) => entry.id === delivery.id)).toBe(true)
      expect(listed.deliveries[0]?.content ?? "").toContain("Earnings Preview Packet: NVDA")
    })
  })
})
