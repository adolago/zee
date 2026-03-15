import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { FluxRecorder } from "../../src/flux"
import { tmpdir } from "../fixture/fixture"
import { thesisTool } from "../../../../src/domain/investing/tools"
import {
  buildInvestingThesisPortfolioRollup,
  diffInvestingThesisHistory,
  getInvestingThesisHistory,
  queryInvestingTheses,
} from "../../../../src/domain/investing/thesis-queries"
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

async function withThesisQueryState<T>(fn: (root: string) => Promise<T>): Promise<T> {
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

function seedThesis(symbol: string, input?: { bullish?: boolean; includeRefresh?: boolean }) {
  const thesisKey = thesisKeyForSymbol(symbol)
  const bullish = input?.bullish ?? true
  syncInvestingThesisContext({
    thesisKey,
    symbol,
    summary: `${symbol} base thesis context.`,
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}-base`,
      runId: `valuation-run-${symbol.toLowerCase()}-base`,
      signal: bullish ? "re-rate-up" : "balanced",
      fairValue: bullish ? 150 : 110,
      currentPrice: 100,
      upsidePercent: bullish ? 50 : 10,
    },
  })

  recordInvestingThesisRevision({
    thesisKey,
    symbol,
    changeType: "initialize",
    summary: `${symbol} thesis initialized.`,
    thesis: `${symbol} initial thesis body.`,
    conviction: bullish ? "high" : "medium",
    posture: bullish ? "bullish" : "neutral",
    watchpoints: [`Track ${symbol} demand`, `Track ${symbol} valuation`],
    valuation: {
      valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:base`,
      packetId: `valuation-packet-${symbol.toLowerCase()}-base`,
      runId: `valuation-run-${symbol.toLowerCase()}-base`,
      signal: bullish ? "re-rate-up" : "balanced",
      fairValue: bullish ? 150 : 110,
      currentPrice: 100,
      upsidePercent: bullish ? 50 : 10,
    },
    evidence: [
      {
        kind: "research-evidence",
        id: `evidence-${symbol.toLowerCase()}-research`,
        label: `[E1] Research summary for ${symbol}`,
        link: `evidence:${symbol}:E1`,
        toolId: "zee:invest-research",
      },
      {
        kind: "valuation-packet",
        id: `valuation-packet-${symbol.toLowerCase()}-base`,
        label: `Valuation packet for ${symbol}`,
        link: `valuation-packet:valuation-packet-${symbol.toLowerCase()}-base`,
        toolId: "zee:invest-valuation",
      },
    ],
  })

  if (input?.includeRefresh !== false) {
    recordInvestingThesisRevision({
      thesisKey,
      symbol,
      changeType: "refresh",
      summary: `${symbol} thesis refreshed after estimate revisions.`,
      thesis: `${symbol} refreshed thesis body with tighter setup.`,
      conviction: "high",
      posture: "neutral",
      watchpoints: [`Watch ${symbol} estimate revisions`, `Monitor ${symbol} event deltas`],
      valuation: {
        valuationCaseId: `valuation_case:equity:${symbol.toLowerCase()}:refresh`,
        packetId: `valuation-packet-${symbol.toLowerCase()}-refresh`,
        runId: `valuation-run-${symbol.toLowerCase()}-refresh`,
        signal: "balanced",
        fairValue: 112,
        currentPrice: 104,
        upsidePercent: 7.7,
      },
      evidence: [
        {
          kind: "research-evidence",
          id: `evidence-${symbol.toLowerCase()}-estimates`,
          label: `[E2] Estimate revision for ${symbol}`,
          link: `evidence:${symbol}:E2`,
          toolId: "zee:invest-estimates",
        },
      ],
    })
  }
}

describe("investing thesis queries", () => {
  test("exposes thesis history, diffs, and filtered queries", async () => {
    await withThesisQueryState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      seedThesis("NVDA")
      seedThesis("MSFT", { bullish: false, includeRefresh: false })

      const theses = queryInvestingTheses({ conviction: "medium" })
      expect(theses).toHaveLength(2)

      const history = getInvestingThesisHistory({ thesis: "NVDA", limit: 5 })
      expect(history?.revisionCount).toBe(2)
      expect(history?.revisions[0]?.version).toBe(2)

      const diff = diffInvestingThesisHistory({ thesis: "thesis:nvda" })
      expect(diff?.fromRevision.version).toBe(1)
      expect(diff?.toRevision.version).toBe(2)
      expect(diff?.changedFields).toContain("conviction")
      expect(diff?.changedFields).toContain("watchpoints")
      expect(diff?.changes.evidence.added[0]?.toolId).toBe("zee:invest-estimates")

      const tool = await thesisTool.init?.({} as never)
      const result = await tool?.execute(
        {
          action: "diff",
          thesis: "NVDA",
        },
        makeToolContext() as never,
      )
      const payload = JSON.parse(result?.output ?? "{}")
      expect(payload.symbol).toBe("NVDA")
      expect(payload.changedFields).toContain("valuation")

      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.thesis.query")).toBe(true)
    })
  })

  test("builds portfolio thesis rollups and surfaces missing coverage", async () => {
    await withThesisQueryState(async (root) => {
      const recordSpy = spyOn(FluxRecorder, "record")
      mkdirSync(root, { recursive: true })
      writeFileSync(
        path.join(root, "portfolio.json"),
        JSON.stringify(
          {
            positions: [
              { symbol: "NVDA", shares: 10, averageCost: 90 },
              { symbol: "MSFT", shares: 5, averageCost: 300 },
            ],
          },
          null,
          2,
        ),
      )
      writeFileSync(
        path.join(root, "watchlist.json"),
        JSON.stringify(
          {
            symbols: ["AAPL"],
          },
          null,
          2,
        ),
      )

      seedThesis("NVDA")
      seedThesis("MSFT", { bullish: false, includeRefresh: false })

      const rollup = buildInvestingThesisPortfolioRollup()
      expect(rollup.coverage.holdingsCount).toBe(2)
      expect(rollup.coverage.watchlistCount).toBe(1)
      expect(rollup.coverage.thesisTrackedCount).toBe(2)
      expect(rollup.coverage.missingThesisCount).toBe(1)
      expect(rollup.entries.find((entry) => entry.symbol === "AAPL")?.thesis).toBeNull()
      expect(rollup.entries.find((entry) => entry.symbol === "NVDA")?.thesis?.currentVersion).toBe(2)

      const tool = await thesisTool.init?.({} as never)
      const result = await tool?.execute(
        {
          action: "portfolio-rollup",
          audience: "all",
          limit: 20,
        },
        makeToolContext() as never,
      )
      const payload = JSON.parse(result?.output ?? "{}")
      expect(payload.coverage.missingThesisCount).toBe(1)
      expect(payload.countsByPosture.neutral).toBe(2)

      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.thesis.rollup")).toBe(true)
    })
  })
})
