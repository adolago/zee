import { describe, expect, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import { runInvestingValuationKernel } from "../../../../src/domain/investing/valuation"
import {
  getInvestingValuationPacket,
  getInvestingValuationPacketStateFile,
} from "../../../../src/domain/investing/valuation-packet"
import { valuationPacketTool } from "../../../../src/domain/investing/tools"

function makeToolContext() {
  return {
    sessionId: "session-1",
    messageId: "message-1",
    agent: "zee",
    abort: new AbortController().signal,
    metadata: () => {},
  }
}

async function withPacketState<T>(fn: () => Promise<T>): Promise<T> {
  await using dir = await tmpdir()
  const originalStateHome = process.env.XDG_STATE_HOME
  const originalPortfolioFile = process.env.ZEE_INVESTING_PORTFOLIO_FILE
  const originalFetch = globalThis.fetch
  process.env.XDG_STATE_HOME = dir.path
  process.env.ZEE_INVESTING_PORTFOLIO_FILE = `${dir.path}/portfolio.json`
  await Bun.write(
    process.env.ZEE_INVESTING_PORTFOLIO_FILE,
    JSON.stringify({
      positions: [{ symbol: "NVDA", shares: 10, average_cost: 95 }],
    }),
  )

  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
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
  }
}

describe("investing valuation packets", () => {
  test("auto-generates a standardized valuation packet from a kernel run", async () => {
    await withPacketState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
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

      const run = await runInvestingValuationKernel({ symbol: "NVDA" })
      const packet = getInvestingValuationPacket(run.packetId!)

      expect(packet).toBeDefined()
      if (!packet) throw new Error("packet should be defined")

      expect(packet.schemaVersion).toBe("valuation-packet.v1")
      expect(packet.portfolioContext.positionStatus).toBe("holding")
      expect(packet.operationsContext.consumer).toBe("portfolio-ops")
      expect(packet.audit.exportCount).toBe(0)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.valuation.packet")).toBe(true)
      expect(await Bun.file(getInvestingValuationPacketStateFile()).exists()).toBe(true)
    })
  })

  test("tool surface can read, list, and export valuation packets", async () => {
    await withPacketState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
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
                fairValueRange: { low: 95, high: 125 },
                target: { currentPrice: 100 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        throw new Error(`Unexpected URL ${url}`)
      }) as typeof fetch

      const run = await runInvestingValuationKernel({ symbol: "NVDA" })
      const runtime = await valuationPacketTool.init()
      const ctx = makeToolContext()

      const readResult = await runtime.execute(
        {
          action: "read",
          packetId: run.packetId!,
        },
        ctx,
      )
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: run.packetId,
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
        packets: Array<{ id: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.packets.some((entry) => entry.id === run.packetId)).toBe(true)

      const exportResult = await runtime.execute(
        {
          action: "export",
          packetId: run.packetId!,
          format: "markdown",
        },
        ctx,
      )
      expect(exportResult.output).toContain("# Valuation Packet: NVDA")
      expect(exportResult.output).toContain("Audit key:")
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.valuation.packet.export")).toBe(true)

      const packet = getInvestingValuationPacket(run.packetId!)
      expect(packet?.audit.exportCount).toBe(1)
    })
  })
})
