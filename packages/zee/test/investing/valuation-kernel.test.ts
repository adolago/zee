import { describe, expect, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import {
  getInvestingValuationKernel,
  getInvestingValuationKernelStateFile,
  runInvestingValuationKernel,
} from "../../../../src/domain/investing/valuation"
import { getInvestingValuationPacket } from "../../../../src/domain/investing/valuation-packet"
import { valuationKernelTool } from "../../../../src/domain/investing/tools"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function withValuationState<T>(fn: () => Promise<T>): Promise<T> {
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

describe("investing valuation kernel", () => {
  test("runs DCF, comps, and scenario analysis into a persisted kernel", async () => {
    await withValuationState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
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
                dcf: {
                  intrinsicValue: 150,
                  currentPrice: 100,
                  upsidePercentage: 50,
                },
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
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const run = await runInvestingValuationKernel({
        symbol: "NVDA",
        peers: ["AMD", "AVGO"],
      })

      expect(run.symbol).toBe("NVDA")
      expect(run.status).toBe("ok")
      expect(run.valuationCaseId).toContain("valuation_case:equity:nvda:")
      expect(run.packetId).toBeDefined()
      expect(run.methods).toHaveLength(3)
      expect(run.blendedFairValue).toBeCloseTo((140 + 150 + 110) / 3, 5)
      expect(run.scenarios.map((scenario) => scenario.name)).toEqual(["bear", "base", "bull"])
      expect(run.scenarios[1]?.fairValue).toBeCloseTo(run.blendedFairValue!, 5)
      expect(run.assumptionProvenance.some((item) => item.name === "discountRate")).toBe(true)
      expect(run.sensitivityTables.map((table) => table.method)).toEqual(["dcf", "comparables", "blended"])
      expect(run.thesisContext.thesisKey).toBe("thesis:nvda")
      expect(getInvestingValuationKernel(run.id)?.id).toBe(run.id)
      expect(getInvestingValuationPacket(run.packetId!)?.runId).toBe(run.id)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.valuation.kernel" && call[0]?.traceID === run.id)).toBe(
        true,
      )
      expect(
        recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.valuation.method" && call[0]?.traceID === run.id),
      ).toHaveLength(3)
      expect(
        recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.valuation.scenario" && call[0]?.traceID === run.id),
      ).toHaveLength(3)
      expect(
        recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.valuation.assumption" && call[0]?.traceID === run.id),
      ).toBe(true)
      expect(
        recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.valuation.sensitivity" && call[0]?.traceID === run.id),
      ).toHaveLength(3)
      expect(await Bun.file(getInvestingValuationKernelStateFile()).exists()).toBe(true)
    })
  })

  test("tool surface can run, read, and list valuation kernels", async () => {
    await withValuationState(async () => {
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
                dcf: { intrinsicValue: 145, currentPrice: 100, upsidePercentage: 45 },
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
                fairValueRange: { low: 95, high: 125 },
                target: { currentPrice: 100 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const runtime = await valuationKernelTool.init()
      const ctx = makeToolContext()
      const runResult = await runtime.execute(
        {
          action: "run",
          symbol: "NVDA",
        },
        ctx,
      )
      const run = JSON.parse(runResult.output) as { id: string; symbol: string }
      expect(run.symbol).toBe("NVDA")

      const readResult = await runtime.execute(
        {
          action: "read",
          runId: run.id,
        },
        ctx,
      )
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: run.id,
      })

      const listResult = await runtime.execute(
        {
          action: "list",
          symbol: "NVDA",
          limit: 5,
        },
        ctx,
      )
      const listed = JSON.parse(listResult.output) as {
        count: number
        runs: Array<{ id: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.runs.some((entry) => entry.id === run.id)).toBe(true)
    })
  })
})
