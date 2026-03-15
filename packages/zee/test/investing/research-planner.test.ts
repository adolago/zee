import { describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import {
  createInvestingResearchPlan,
  getInvestingResearchPlan,
  getInvestingResearchPlanStateFile,
  listInvestingResearchPlans,
  updateInvestingResearchTask,
} from "../../../../src/domain/investing/planner"
import { researchPlannerTool } from "../../../../src/domain/investing/tools"
import { registerInvestingTools } from "../../../../src/mcp/domain/index"
import { getToolRegistry, resetToolRegistry } from "../../../../src/mcp/registry"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function withPlannerState<T>(fn: () => Promise<T>): Promise<T> {
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
    resetToolRegistry()
  }
}

describe("investing research planner", () => {
  test("creates and persists a repeatable earnings preview plan with telemetry", async () => {
    await withPlannerState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })

      expect(plan.workflow).toBe("earnings-preview")
      expect(plan.symbols).toEqual(["NVDA"])
      expect(plan.status).toBe("active")
      expect(plan.tasks[0]?.status).toBe("in_progress")
      expect(plan.tasks[0]?.id).toBe("coverage-check")
      expect(getInvestingResearchPlan(plan.id)?.id).toBe(plan.id)

      const persisted = JSON.parse(await fs.readFile(getInvestingResearchPlanStateFile(), "utf8")) as {
        plans: Array<{ id: string }>
      }
      expect(persisted.plans[0]?.id).toBe(plan.id)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.research.plan")).toBe(true)
    })
  })

  test("updates task state and auto-advances the next dependency-ready step", async () => {
    await withPlannerState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      const plan = createInvestingResearchPlan({
        objective: "Refresh the thesis on AAPL",
      })

      const updated = updateInvestingResearchTask({
        planId: plan.id,
        taskId: "coverage-check",
        status: "completed",
        note: "Coverage confirmed and session opened",
      })

      expect(updated.tasks.find((task) => task.id === "coverage-check")?.status).toBe("completed")
      expect(updated.tasks.find((task) => task.id === "source-refresh")?.status).toBe("in_progress")
      expect(updated.status).toBe("active")
      expect(updated.tasks.find((task) => task.id === "coverage-check")?.note).toBe(
        "Coverage confirmed and session opened",
      )
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.research.plan.task")).toBe(true)
    })
  })

  test("tool surface can create, read, and list persisted plans", async () => {
    await withPlannerState(async () => {
      const runtime = await researchPlannerTool.init()
      const ctx = makeToolContext()

      const created = await runtime.execute(
        {
          action: "create",
          objective: "Compare MSFT and GOOGL",
          symbols: ["msft", "googl"],
        },
        ctx,
      )
      const createdPlan = JSON.parse(created.output) as { id: string; workflow: string; symbols: string[] }

      expect(createdPlan.workflow).toBe("peer-compare")
      expect(createdPlan.symbols).toEqual(["MSFT", "GOOGL"])

      const loaded = await runtime.execute(
        {
          action: "read",
          planId: createdPlan.id,
        },
        ctx,
      )
      expect(JSON.parse(loaded.output)).toMatchObject({
        id: createdPlan.id,
      })

      const listed = await runtime.execute(
        {
          action: "list",
          limit: 5,
        },
        ctx,
      )
      const listedPayload = JSON.parse(listed.output) as {
        count: number
        plans: Array<{ id: string }>
      }
      expect(listedPayload.count).toBeGreaterThan(0)
      expect(listedPayload.plans.some((plan) => plan.id === createdPlan.id)).toBe(true)

      expect(listInvestingResearchPlans({ limit: 5 }).some((plan) => plan.id === createdPlan.id)).toBe(true)
    })
  })

  test("MCP domain registration exposes the full investing planner tool set", async () => {
    await withPlannerState(async () => {
      registerInvestingTools()
      const registry = getToolRegistry()

      expect(registry.has("zee:invest-market-data")).toBe(true)
      expect(registry.has("zee:invest-scratchpad")).toBe(true)
      expect(registry.has("zee:invest-valuation")).toBe(true)
      expect(registry.has("zee:invest-planner")).toBe(true)
      expect(registry.has("zee:invest-executor")).toBe(true)
      expect(registry.has("zee:invest-artifacts")).toBe(true)
    })
  })
})
