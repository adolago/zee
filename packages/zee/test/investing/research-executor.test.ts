import { describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import { FluxRecorder } from "../../src/flux"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import { classifyInvestingConnectorEvents, upsertInvestingEvents } from "../../src/investing/events"
import { tmpdir } from "../fixture/fixture"
import {
  createInvestingResearchPlan,
  getInvestingResearchPlan,
  updateInvestingResearchTask,
} from "../../../../src/domain/investing/planner"
import {
  getInvestingResearchExecution,
  getInvestingResearchExecutionStateFile,
  runInvestingResearchExecution,
} from "../../../../src/domain/investing/executor"
import { getInvestingResearchArtifact } from "../../../../src/domain/investing/artifacts"
import { researchExecutorTool } from "../../../../src/domain/investing/tools"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function seedEventDelta(symbol: string) {
  const events = classifyInvestingConnectorEvents({
    connector: "news",
    entities: normalizeInvestingConnectorEntities({
      connector: "news",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: [
        {
          symbol,
          articleId: `${symbol.toLowerCase()}-guidance`,
          publishedAt: "2026-03-15T09:30:00.000Z",
          title: `${symbol} raises guidance after a strong quarter`,
          summary: `Management raised guidance for ${symbol} after a strong quarter.`,
          sector: "Technology",
        },
      ],
    }),
  })
  await upsertInvestingEvents({ events })
}

async function withExecutorState<T>(fn: () => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalStateHome = process.env.XDG_STATE_HOME
  const originalFetch = globalThis.fetch
  process.env.XDG_STATE_HOME = dir.path
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
    if (originalStateHome === undefined) {
      delete process.env.XDG_STATE_HOME
    } else {
      process.env.XDG_STATE_HOME = originalStateHome
    }
  }
}

describe("investing research executor", () => {
  test("runs a multi-source task, persists evidence links, and advances the planner", async () => {
    await withExecutorState(async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/accounting/NVDA/filings")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [{ form: "10-K", filedAt: "2026-02-20" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.endsWith("/api/research/NVDA")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { symbol: "NVDA", summary: "Demand for AI infrastructure remains strong." },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const recordSpy = spyOn(FluxRecorder, "record")
      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      await seedEventDelta("NVDA")
      updateInvestingResearchTask({
        planId: plan.id,
        taskId: "coverage-check",
        status: "completed",
      })

      const execution = await runInvestingResearchExecution({ planId: plan.id })

      expect(execution.taskId).toBe("source-refresh")
      expect(execution.status).toBe("ok")
      expect(execution.evidence).toHaveLength(2)
      expect(execution.evidence[0]?.citation).toBe("E1")
      expect(execution.evidence[1]?.citation).toBe("E2")
      expect(execution.synthesis).toContain("[E1]")
      expect(execution.synthesis).toContain("[E2]")
      expect(execution.synthesis).toContain("Event Deltas:")
      expect(execution.synthesis).toContain("NVDA")
      expect(execution.synthesis).toContain("Source Used:")
      expect(execution.synthesis).toContain("Primary source: zee:invest-research")
      expect(execution.artifactId).toBeDefined()
      expect(getInvestingResearchArtifact(execution.artifactId!)?.executionId).toBe(execution.id)
      expect(getInvestingResearchExecution(execution.id)?.id).toBe(execution.id)

      const persisted = JSON.parse(await fs.readFile(getInvestingResearchExecutionStateFile(), "utf8")) as {
        executions: Array<{ id: string }>
      }
      expect(persisted.executions[0]?.id).toBe(execution.id)

      const updatedPlan = getInvestingResearchPlan(plan.id)
      expect(updatedPlan?.tasks.find((task) => task.id === "source-refresh")?.status).toBe("completed")
      expect(updatedPlan?.tasks.find((task) => task.id === "expectation-map")?.status).toBe("in_progress")

      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.research.execution")).toBe(true)
      expect(recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.research.evidence").length).toBeGreaterThanOrEqual(2)
    })
  })

  test("tool surface can run, read, and list executions", async () => {
    await withExecutorState(async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/accounting/NVDA/filings")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [{ form: "10-Q", filedAt: "2026-03-01" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.endsWith("/api/research/NVDA")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { symbol: "NVDA", headline: "Consensus nudging higher" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      await seedEventDelta("NVDA")
      updateInvestingResearchTask({
        planId: plan.id,
        taskId: "coverage-check",
        status: "completed",
      })

      const runtime = await researchExecutorTool.init()
      const ctx = makeToolContext()
      const runResult = await runtime.execute(
        {
          action: "run",
          planId: plan.id,
          taskId: "source-refresh",
        },
        ctx,
      )
      const execution = JSON.parse(runResult.output) as { id: string; taskId: string }
      expect(execution.taskId).toBe("source-refresh")

      const readResult = await runtime.execute(
        {
          action: "read",
          executionId: execution.id,
        },
        ctx,
      )
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: execution.id,
      })

      const listResult = await runtime.execute(
        {
          action: "list",
          planId: plan.id,
          limit: 5,
        },
        ctx,
      )
      const listed = JSON.parse(listResult.output) as {
        count: number
        executions: Array<{ id: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.executions.some((entry) => entry.id === execution.id)).toBe(true)
    })
  })

  test("can execute valuation-aware workflow steps with the valuation kernel", async () => {
    await withExecutorState(async () => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/valuation/NVDA?include_dcf=true")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { symbol: "NVDA", fairValue: 140, currentPrice: 100, upsidePercent: 40 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.endsWith("/api/research/NVDA/dcf")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                symbol: "NVDA",
                dcf: { intrinsicValue: 150, currentPrice: 100, upsidePercentage: 50 },
                assumptions: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.includes("/api/peers/NVDA")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                fairValueRange: { low: 90, high: 130 },
                target: { currentPrice: 100 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.endsWith("/api/market/NVDA")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { symbol: "NVDA", price: 100, marketCap: 1_000_000_000 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.endsWith("/api/valuation/NVDA")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { symbol: "NVDA", fairValue: 140, currentPrice: 100, upsidePercent: 40 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const plan = createInvestingResearchPlan({
        objective: "Refresh the thesis on NVDA",
      })
      updateInvestingResearchTask({ planId: plan.id, taskId: "coverage-check", status: "completed" })
      updateInvestingResearchTask({ planId: plan.id, taskId: "source-refresh", status: "completed" })
      updateInvestingResearchTask({ planId: plan.id, taskId: "thesis-delta", status: "completed" })

      const execution = await runInvestingResearchExecution({ planId: plan.id })

      expect(execution.taskId).toBe("valuation-check")
      expect(execution.evidence.some((item) => item.toolId === "zee:invest-valuation")).toBe(true)
      const valuationEvidence = execution.evidence.find((item) => item.toolId === "zee:invest-valuation")
      expect(valuationEvidence?.status).toBe("completed")
      expect((valuationEvidence?.data as { blendedFairValue?: number } | undefined)?.blendedFairValue).toBeCloseTo(
        (140 + 150 + 110) / 3,
        5,
      )
    })
  })
})
