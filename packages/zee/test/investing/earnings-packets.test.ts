import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { FluxRecorder } from "../../src/flux"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import { classifyInvestingConnectorEvents, upsertInvestingEvents } from "../../src/investing/events"
import { tmpdir } from "../fixture/fixture"
import { createInvestingResearchArtifact } from "../../../../src/domain/investing/artifacts"
import {
  createInvestingEarningsPacket,
  getInvestingEarningsPacket,
  getInvestingEarningsPacketStateFile,
} from "../../../../src/domain/investing/earnings-packets"
import {
  getInvestingResearchExecutionStateFile,
  type InvestingResearchExecution,
} from "../../../../src/domain/investing/executor"
import { createInvestingResearchPlan } from "../../../../src/domain/investing/planner"
import { earningsPacketTool } from "../../../../src/domain/investing/tools"
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

function seedThesis(symbol: string, summary: string, signal: "balanced" | "re-rate-up", upsidePercent: number) {
  const thesisKey = thesisKeyForSymbol(symbol)
  syncInvestingThesisContext({
    thesisKey,
    symbol,
    summary,
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}-${signal}`,
      runId: `valuation-run-${symbol.toLowerCase()}-${signal}`,
      signal,
      fairValue: 100 + upsidePercent,
      currentPrice: 100,
      upsidePercent,
    },
  })
  recordInvestingThesisRevision({
    thesisKey,
    symbol,
    changeType: "refresh",
    summary,
    thesis: `${summary} Thesis body for ${symbol}.`,
    conviction: signal === "re-rate-up" ? "high" : "medium",
    posture: signal === "re-rate-up" ? "bullish" : "neutral",
    evidence: [
      {
        kind: "research-evidence",
        id: `evidence-${symbol.toLowerCase()}-${signal}`,
        label: `[E1] Research summary for ${symbol}`,
        link: `evidence:research-${symbol}:E1`,
        toolId: "zee:invest-research",
      },
      {
        kind: "valuation-packet",
        id: `valuation-packet-${symbol.toLowerCase()}-${signal}`,
        label: `Valuation packet for ${symbol}`,
        link: `valuation-packet:valuation-packet-${symbol.toLowerCase()}-${signal}`,
        toolId: "zee:invest-valuation",
      },
    ],
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}-${signal}`,
      runId: `valuation-run-${symbol.toLowerCase()}-${signal}`,
      signal,
      fairValue: 100 + upsidePercent,
      currentPrice: 100,
      upsidePercent,
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

async function withEarningsPacketState<T>(fn: () => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalStateHome = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = dir.path
  try {
    return await fn()
  } finally {
    if (originalStateHome === undefined) {
      delete process.env.XDG_STATE_HOME
    } else {
      process.env.XDG_STATE_HOME = originalStateHome
    }
  }
}

describe("investing earnings packets", () => {
  test("creates preview and review packets with catalyst, risk, and valuation-change context", async () => {
    await withEarningsPacketState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")

      seedThesis("NVDA", "NVDA enters earnings with a balanced setup.", "balanced", 10)
      await seedEventDelta("NVDA", "NVDA raises guidance ahead of earnings")

      const previewPlan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      const previewTask = previewPlan.tasks.find((task) => task.id === "preview-brief")
      if (!previewTask) throw new Error("preview task should exist")
      const previewExecution = makeExecution({
        id: "research-execution-preview",
        planId: previewPlan.id,
        taskId: previewTask.id,
        workflow: previewPlan.workflow,
        symbol: "NVDA",
        synthesis: "Preview packet captures the setup, catalysts, and open questions for the call.",
      })
      const previewArtifact = createInvestingResearchArtifact({
        execution: previewExecution,
        plan: previewPlan,
        task: previewTask,
      })
      previewExecution.artifactId = previewArtifact.id

      const previewPacket = await createInvestingEarningsPacket({
        execution: previewExecution,
        plan: previewPlan,
        task: previewTask,
      })

      expect(previewPacket.workflow).toBe("earnings-preview")
      expect(previewPacket.catalysts.length).toBeGreaterThan(0)
      expect(previewPacket.risks.length).toBeGreaterThan(0)
      expect(previewPacket.sections.map((section) => section.title)).toEqual([
        "Overview",
        "Synthesis",
        "Catalysts",
        "Risks",
        "Valuation Change",
        "Evidence",
      ])

      seedThesis("NVDA", "NVDA exits earnings with a cleaner upside setup.", "re-rate-up", 25)
      await seedEventDelta("NVDA", "NVDA posts a strong quarter and lifts guidance")

      const reviewPlan = createInvestingResearchPlan({
        objective: "Prepare a post earnings review for NVDA",
      })
      const reviewTask = reviewPlan.tasks.find((task) => task.id === "review-brief")
      if (!reviewTask) throw new Error("review task should exist")
      const reviewExecution = makeExecution({
        id: "research-execution-review",
        planId: reviewPlan.id,
        taskId: reviewTask.id,
        workflow: reviewPlan.workflow,
        symbol: "NVDA",
        synthesis: "Review packet captures the realized result, valuation change, and follow-up work.",
      })
      const reviewArtifact = createInvestingResearchArtifact({
        execution: reviewExecution,
        plan: reviewPlan,
        task: reviewTask,
      })
      reviewExecution.artifactId = reviewArtifact.id

      const reviewPacket = await createInvestingEarningsPacket({
        execution: reviewExecution,
        plan: reviewPlan,
        task: reviewTask,
      })

      expect(reviewPacket.workflow).toBe("earnings-review")
      expect(reviewPacket.valuation.previousPacketId).toBe(previewPacket.id)
      expect(reviewPacket.valuation.upsidePercentDelta).toBe(15)
      expect(reviewPacket.valuation.narrative).toContain("re-rate-up")
      expect(getInvestingEarningsPacket(reviewPacket.id)?.id).toBe(reviewPacket.id)
      expect(await Bun.file(getInvestingEarningsPacketStateFile()).exists()).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.earnings.packet")).toBe(true)
    })
  })

  test("tool surface can create, read, list, and export earnings packets", async () => {
    await withEarningsPacketState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")

      seedThesis("NVDA", "NVDA enters earnings with an improving setup.", "re-rate-up", 25)
      await seedEventDelta("NVDA", "NVDA raises guidance ahead of earnings")

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      const task = plan.tasks.find((entry) => entry.id === "preview-brief")
      if (!task) throw new Error("preview task should exist")

      const execution = makeExecution({
        id: "research-execution-tool",
        planId: plan.id,
        taskId: task.id,
        workflow: plan.workflow,
        symbol: "NVDA",
        synthesis: "Tool packet captures the setup for delivery.",
      })
      const artifact = createInvestingResearchArtifact({
        execution,
        plan,
        task,
      })
      execution.artifactId = artifact.id
      await persistExecution(execution)

      const runtime = await earningsPacketTool.init()
      const ctx = makeToolContext()

      const createResult = await runtime.execute(
        {
          action: "create",
          executionId: execution.id,
        },
        ctx,
      )
      const created = JSON.parse(createResult.output) as { id: string; executionId: string }
      expect(created.executionId).toBe(execution.id)

      const readResult = await runtime.execute(
        {
          action: "read",
          packetId: created.id,
        },
        ctx,
      )
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: created.id,
      })

      const listResult = await runtime.execute(
        {
          action: "list",
          symbol: "NVDA",
          workflow: "earnings-preview",
          limit: 5,
        },
        ctx,
      )
      const listed = JSON.parse(listResult.output) as {
        count: number
        packets: Array<{ id: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.packets.some((entry) => entry.id === created.id)).toBe(true)

      const exportResult = await runtime.execute(
        {
          action: "export",
          packetId: created.id,
          format: "markdown",
        },
        ctx,
      )
      expect(exportResult.output).toContain("# Earnings Preview Packet: NVDA")
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.earnings.packet.export")).toBe(true)
    })
  })
})
