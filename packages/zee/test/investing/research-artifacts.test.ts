import { describe, expect, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import {
  createInvestingResearchPlan,
  updateInvestingResearchTask,
} from "../../../../src/domain/investing/planner"
import { runInvestingResearchExecution } from "../../../../src/domain/investing/executor"
import {
  researchArtifactsTool,
} from "../../../../src/domain/investing/tools"
import { getInvestingResearchArtifact } from "../../../../src/domain/investing/artifacts"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function withArtifactState<T>(fn: () => Promise<T>): Promise<T> {
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

describe("investing research artifacts", () => {
  test("creates a structured artifact for a successful execution", async () => {
    await withArtifactState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
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
              data: { symbol: "NVDA", summary: "Demand remains strong." },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      updateInvestingResearchTask({
        planId: plan.id,
        taskId: "coverage-check",
        status: "completed",
      })

      const execution = await runInvestingResearchExecution({ planId: plan.id })
      expect(execution.artifactId).toBeDefined()

      const artifact = getInvestingResearchArtifact(execution.artifactId!)
      expect(artifact).toBeDefined()
      if (!artifact) throw new Error("artifact should be defined")

      expect(artifact.kind).toBe("source-delta")
      expect(artifact.status).toBe("ready")
      expect(artifact.sections.map((section) => section.title)).toEqual(["Overview", "Synthesis", "Evidence"])
      expect(artifact.citations.map((item) => item.citation)).toEqual(["E1", "E2"])
      expect(artifact.nextActions).toContain("Run the next task: Map consensus and management setup.")
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.research.artifact")).toBe(true)
    })
  })

  test("captures actionable diagnostics for failed runs", async () => {
    await withArtifactState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      globalThis.fetch = (async () => {
        throw new Error("connection refused")
      }) as typeof fetch

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      updateInvestingResearchTask({
        planId: plan.id,
        taskId: "coverage-check",
        status: "completed",
      })

      const execution = await runInvestingResearchExecution({ planId: plan.id })
      const artifact = getInvestingResearchArtifact(execution.artifactId!)

      expect(execution.status).toBe("error")
      expect(artifact).toBeDefined()
      if (!artifact) throw new Error("artifact should be defined")

      expect(artifact.kind).toBe("failure-diagnostic")
      expect(artifact.status).toBe("failed")
      expect(artifact.diagnostics.length).toBeGreaterThanOrEqual(2)
      expect(artifact.sections.some((section) => section.title === "Diagnostics")).toBe(true)
      expect(artifact.diagnostics.some((diagnostic) => diagnostic.command === "zee investing ingest status")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.research.diagnostic")).toBe(true)
    })
  })

  test("tool surface can create, read, and list artifacts", async () => {
    await withArtifactState(async () => {
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
              data: { symbol: "NVDA", headline: "Consensus moving higher" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const plan = createInvestingResearchPlan({
        objective: "Prepare a pre-earnings preview for NVDA",
      })
      updateInvestingResearchTask({
        planId: plan.id,
        taskId: "coverage-check",
        status: "completed",
      })

      const execution = await runInvestingResearchExecution({ planId: plan.id })
      const runtime = await researchArtifactsTool.init()
      const ctx = makeToolContext()

      const createResult = await runtime.execute(
        {
          action: "create",
          executionId: execution.id,
        },
        ctx,
      )
      const artifact = JSON.parse(createResult.output) as { id: string; executionId: string }
      expect(artifact.executionId).toBe(execution.id)

      const readResult = await runtime.execute(
        {
          action: "read",
          artifactId: artifact.id,
        },
        ctx,
      )
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: artifact.id,
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
        artifacts: Array<{ id: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.artifacts.some((entry) => entry.id === artifact.id)).toBe(true)
    })
  })
})
