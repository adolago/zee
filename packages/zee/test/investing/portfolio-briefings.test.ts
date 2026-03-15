import { describe, expect, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import { classifyInvestingConnectorEvents, upsertInvestingEvents } from "../../src/investing/events"
import { tmpdir } from "../fixture/fixture"
import {
  createInvestingPortfolioBriefing,
  getInvestingPortfolioBriefing,
  getInvestingPortfolioBriefingStateFile,
  renderInvestingPortfolioBriefing,
} from "../../../../src/domain/investing/briefings"
import { portfolioBriefingsTool } from "../../../../src/domain/investing/tools"
import { recordInvestingThesisRevision, syncInvestingThesisContext, thesisKeyForSymbol } from "../../../../src/domain/investing/thesis"

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
          articleId: `${symbol.toLowerCase()}-delta`,
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
      signal: symbol === "NVDA" ? "re-rate-up" : "balanced",
      fairValue: symbol === "NVDA" ? 140 : 110,
      currentPrice: symbol === "NVDA" ? 100 : 105,
      upsidePercent: symbol === "NVDA" ? 40 : 5,
    },
  })
  recordInvestingThesisRevision({
    thesisKey,
    symbol,
    changeType: "initialize",
    summary,
    thesis: `${summary} Thesis body for ${symbol}.`,
    conviction: symbol === "NVDA" ? "high" : "medium",
    posture: symbol === "NVDA" ? "bullish" : "neutral",
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
      signal: symbol === "NVDA" ? "re-rate-up" : "balanced",
      fairValue: symbol === "NVDA" ? 140 : 110,
      currentPrice: symbol === "NVDA" ? 100 : 105,
      upsidePercent: symbol === "NVDA" ? 40 : 5,
    },
  })
}

async function withPortfolioBriefingState<T>(fn: () => Promise<T>): Promise<T> {
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

describe("investing portfolio briefings", () => {
  test("builds and persists a daily holdings/watchlist briefing from research outputs", async () => {
    await withPortfolioBriefingState(async () => {
      const recordSpy = spyOn(FluxRecorder, "record")
      seedThesis("NVDA", "NVDA remains a core AI holding.")
      seedThesis("MSFT", "MSFT stays on the watchlist for cloud and AI follow-through.")
      await seedEventDelta("NVDA", "NVDA raises guidance after a strong quarter")
      await seedEventDelta("MSFT", "MSFT raises guidance after a strong quarter")

      const briefing = await createInvestingPortfolioBriefing()

      expect(briefing.kind).toBe("daily-portfolio-brief")
      expect(briefing.coverage.holdingsCount).toBe(1)
      expect(briefing.coverage.watchlistCount).toBe(1)
      expect(briefing.coverage.thesisTrackedCount).toBe(2)
      expect(briefing.coverage.eventDeltaCount).toBe(2)
      expect(briefing.sections.map((section) => section.title)).toEqual(["Overview", "Holdings", "Watchlist"])
      expect(renderInvestingPortfolioBriefing(briefing)).toContain("NVDA [holding]")
      expect(renderInvestingPortfolioBriefing(briefing)).toContain("MSFT [watchlist]")
      expect(getInvestingPortfolioBriefing(briefing.id)?.id).toBe(briefing.id)
      expect(await Bun.file(getInvestingPortfolioBriefingStateFile()).exists()).toBe(true)
      expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.portfolio.briefing")).toBe(true)
    })
  })

  test("tool surface can create, read, and list daily portfolio briefings", async () => {
    await withPortfolioBriefingState(async () => {
      seedThesis("NVDA", "NVDA remains a core AI holding.")
      seedThesis("MSFT", "MSFT stays on the watchlist for cloud and AI follow-through.")
      await seedEventDelta("NVDA", "NVDA raises guidance after a strong quarter")
      await seedEventDelta("MSFT", "MSFT raises guidance after a strong quarter")

      const runtime = await portfolioBriefingsTool.init()
      const ctx = makeToolContext()

      const createResult = await runtime.execute(
        {
          action: "create",
          kind: "daily-portfolio-brief",
        },
        ctx,
      )
      const created = JSON.parse(createResult.output) as { id: string }
      expect(created.id).toBeDefined()

      const readResult = await runtime.execute(
        {
          action: "read",
          briefingId: created.id,
        },
        ctx,
      )
      expect(JSON.parse(readResult.output)).toMatchObject({
        id: created.id,
      })

      const listResult = await runtime.execute(
        {
          action: "list",
          audience: "holding",
          limit: 5,
        },
        ctx,
      )
      const listed = JSON.parse(listResult.output) as {
        count: number
        briefings: Array<{ id: string }>
      }
      expect(listed.count).toBeGreaterThan(0)
      expect(listed.briefings.some((entry) => entry.id === created.id)).toBe(true)
    })
  })
})
