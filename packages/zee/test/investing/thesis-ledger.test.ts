import { describe, expect, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import {
  getInvestingThesis,
  getInvestingThesisLedgerStatus,
  getInvestingThesisStateFile,
  recordInvestingThesisRevision,
  syncInvestingThesisContext,
  thesisKeyForSymbol,
} from "../../../../src/domain/investing/thesis"
import { createInvestingResearchPlan, updateInvestingResearchTask } from "../../../../src/domain/investing/planner"
import { runInvestingResearchExecution } from "../../../../src/domain/investing/executor"

async function withThesisState<T>(fn: () => Promise<T>): Promise<T> {
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

describe("investing thesis ledger", () => {
  test("syncs valuation context and appends versioned thesis revisions", async () => {
    await withThesisState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      const thesisKey = thesisKeyForSymbol("NVDA")

      const initial = syncInvestingThesisContext({
        thesisKey,
        symbol: "NVDA",
        summary: "Initial valuation sync for NVDA.",
        valuation: {
          valuationCaseId: "valuation_case:equity:nvda:base",
          packetId: "valuation-packet-1",
          runId: "valuation-run-1",
          signal: "re-rate-up",
          fairValue: 140,
          currentPrice: 100,
          upsidePercent: 40,
        },
      })

      expect(initial.currentVersion).toBe(0)
      expect(initial.posture).toBe("bullish")
      expect(initial.valuation?.packetId).toBe("valuation-packet-1")

      recordInvestingThesisRevision({
        thesisKey,
        symbol: "NVDA",
        changeType: "initialize",
        summary: "NVDA thesis remains bullish after refreshed valuation.",
        thesis: "Demand remains strong and valuation still supports upside.",
        conviction: "high",
        posture: "bullish",
        watchpoints: ["Track whether revenue growth sustains the current upside case."],
        valuation: {
          valuationCaseId: "valuation_case:equity:nvda:base",
          packetId: "valuation-packet-1",
          runId: "valuation-run-1",
          signal: "re-rate-up",
          fairValue: 140,
          currentPrice: 100,
          upsidePercent: 40,
        },
        evidence: [
          {
            kind: "research-evidence",
            id: "evidence-1",
            label: "[E1] Research endpoint",
            link: "evidence:execution-1:E1",
            toolId: "zee:invest-research",
          },
          {
            kind: "valuation-packet",
            id: "valuation-packet-1",
            label: "Valuation packet for NVDA",
            link: "valuation-packet:valuation-packet-1",
            toolId: "zee:invest-valuation",
          },
        ],
      })

      const updated = recordInvestingThesisRevision({
        thesisKey,
        symbol: "NVDA",
        changeType: "refresh",
        summary: "NVDA thesis moved back to a neutral stance after estimate volatility.",
        thesis: "The setup is intact, but the margin of safety is narrower than the prior refresh.",
        conviction: "high",
        posture: "neutral",
        watchpoints: ["Monitor estimate volatility before increasing exposure."],
        valuation: {
          valuationCaseId: "valuation_case:equity:nvda:refresh",
          packetId: "valuation-packet-2",
          runId: "valuation-run-2",
          signal: "balanced",
          fairValue: 112,
          currentPrice: 105,
          upsidePercent: 6.7,
        },
        evidence: [
          {
            kind: "research-evidence",
            id: "evidence-2",
            label: "[E1] Analyst estimates",
            link: "evidence:execution-2:E1",
            toolId: "zee:invest-estimates",
          },
        ],
      })

      expect(updated.currentVersion).toBe(2)
      expect(updated.latestRevisionId).toBeDefined()
      expect(updated.conviction).toBe("medium")
      expect(updated.posture).toBe("neutral")
      expect(updated.revisions).toHaveLength(2)
      expect(updated.revisions[0]?.version).toBe(2)
      expect(updated.revisions[1]?.version).toBe(1)
      expect(getInvestingThesis(thesisKey)?.valuation?.valuationCaseId).toBe("valuation_case:equity:nvda:refresh")

      const status = getInvestingThesisLedgerStatus()
      expect(status.totalTheses).toBe(1)
      expect(status.totalRevisions).toBe(2)
      expect(status.countsByConviction.medium).toBe(1)
      expect(await Bun.file(getInvestingThesisStateFile()).exists()).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.thesis.record")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.thesis.revision")).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.thesis.confidence")).toBe(true)
      expect(updated.confidence?.appliedConviction).toBe("medium")
      expect(updated.revisions[0]?.confidence.appliedConviction).toBe("medium")
      expect(updated.revisions[0]?.confidence.reasons.some((reason) => reason.includes("downshifted"))).toBe(true)
    })
  })

  test("rejects thesis revisions that do not carry evidence links", async () => {
    await withThesisState(async () => {
      expect(() =>
        recordInvestingThesisRevision({
          thesisKey: thesisKeyForSymbol("MSFT"),
          symbol: "MSFT",
          changeType: "initialize",
          summary: "MSFT thesis without evidence.",
          thesis: "This should fail because no evidence references were provided.",
        }),
      ).toThrow("Thesis revisions require at least one evidence link.")
    })
  })

  test("records a thesis revision from thesis-refresh execution output", async () => {
    await withThesisState(async () => {
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
              data: { symbol: "NVDA", summary: "AI demand remains strong." },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.endsWith("/api/valuation/NVDA?include_dcf=true")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                symbol: "NVDA",
                fairValue: 140,
                currentPrice: 100,
                upsidePercent: 40,
                assumptions: { revenueGrowth: 0.18 },
              },
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
                assumptions: { discountRate: 0.1, terminalGrowth: 0.03 },
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

      const valuationExecution = await runInvestingResearchExecution({ planId: plan.id })
      expect(valuationExecution.taskId).toBe("valuation-check")

      const thesisExecution = await runInvestingResearchExecution({ planId: plan.id })
      expect(thesisExecution.taskId).toBe("thesis-refresh-brief")
      expect(thesisExecution.synthesis).toContain("Thesis Snapshot:")

      const thesis = getInvestingThesis(thesisKeyForSymbol("NVDA"))
      expect(thesis?.currentVersion).toBe(1)
      expect(thesis?.summary).toContain("NVDA thesis")
      expect(thesis?.valuation?.valuationCaseId).toContain("valuation_case:equity:nvda:")
      expect(thesis?.confidence?.ruleVersion).toBe("thesis-confidence.v1")
      expect(thesis?.revisions[0]?.source.executionId).toBe(thesisExecution.id)
      expect(thesis?.revisions[0]?.source.artifactId).toBe(thesisExecution.artifactId)
      expect(thesis?.revisions[0]?.evidence.some((item) => item.kind === "valuation-packet")).toBe(true)
      expect(thesis?.revisions[0]?.confidence.evidenceCount).toBeGreaterThan(0)
      expect(thesisExecution.synthesis).toContain("confidenceRule=thesis-confidence.v1")
    })
  })
})
