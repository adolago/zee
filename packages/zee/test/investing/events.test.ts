import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import {
  classifyInvestingConnectorEvents,
  getInvestingEvent,
  getInvestingEventCatalogStatus,
  listInvestingEvents,
  upsertInvestingEvents,
} from "../../src/investing/events"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  mock.restore()
})

describe("investing event intelligence", () => {
  test("classifies earnings entities into structured event records", () => {
    const entities = normalizeInvestingConnectorEntities({
      connector: "earnings",
      symbol: "AAPL",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: {
        symbol: "AAPL",
        quarters: [{ quarter: "Q4 2025", reportDate: "2026-01-28" }],
        epsGrowthYoy: 12,
        epsGrowth3yrCagr: 8,
        avgEpsSurprisePercent: 5,
        beatRate: 0.8,
        consecutiveBeats: 4,
        earningsVolatility: 0.1,
        earningsConsistency: 0.9,
      },
    })

    const events = classifyInvestingConnectorEvents({
      connector: "earnings",
      entities,
      capturedAt: "2026-03-15T10:01:00.000Z",
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      connector: "earnings",
      classification: "earnings_result",
      direction: "positive",
      symbol: "AAPL",
      entityId: "event:earnings:aapl:q4-2025:2026-01-28t00-00-00-000z",
      entityLinks: {
        issuerId: "company:equity:aapl",
        instrumentId: "instrument:equity:aapl",
        audience: "general",
      },
      materiality: {
        score: 0,
        band: "low",
      },
    })
    expect(events[0]?.summary).toContain("avg EPS surprise 5.0%")
  })

  test("classifies news entities with keyword-based topic, direction, and sector hints", () => {
    const entities = normalizeInvestingConnectorEntities({
      connector: "news",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: [
        {
          symbol: "MSFT",
          articleId: "story-1",
          publishedAt: "2026-03-15T09:00:00.000Z",
          title: "Microsoft raises guidance after strong Azure growth",
          summary: "The company raised fiscal guidance after another strong quarter for Azure.",
          sector: "Software",
          url: "https://example.com/msft-guidance",
        },
      ],
    })

    const events = classifyInvestingConnectorEvents({
      connector: "news",
      entities,
      capturedAt: "2026-03-15T10:02:00.000Z",
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      connector: "news",
      classification: "guidance_update",
      direction: "positive",
      symbol: "MSFT",
      sourceUrl: "https://example.com/msft-guidance",
      entityLinks: {
        sectorLabels: ["Software"],
      },
    })
    expect(events[0]?.reasons[0]).toContain("guidance_update")
  })

  test("scores and links events against holdings and watchlist coverage", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-events.json")
    const portfolioFile = path.join(dir.path, "portfolio.json")
    const watchlistFile = path.join(dir.path, "watchlist.json")
    const recordSpy = spyOn(FluxRecorder, "record")

    await fs.writeFile(
      portfolioFile,
      JSON.stringify(
        {
          positions: [{ symbol: "NVDA", shares: 12, averageCost: 450, sector: "Semiconductors" }],
        },
        null,
        2,
      ),
    )
    await fs.writeFile(
      watchlistFile,
      JSON.stringify(
        {
          items: [{ symbol: "MSFT", sector: "Software" }],
        },
        null,
        2,
      ),
    )

    const earningsEntities = normalizeInvestingConnectorEntities({
      connector: "earnings",
      symbol: "NVDA",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: {
        symbol: "NVDA",
        quarters: [{ quarter: "Q1 2026", reportDate: "2026-03-15" }],
        epsGrowthYoy: 18,
        avgEpsSurprisePercent: 7,
        beatRate: 0.9,
        earningsConsistency: 0.95,
      },
    })
    const newsEntities = normalizeInvestingConnectorEntities({
      connector: "news",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: [
        {
          symbol: "MSFT",
          articleId: "story-2",
          publishedAt: "2026-03-15T08:30:00.000Z",
          title: "Microsoft raises guidance after strong Azure growth",
          summary: "The launch expands Microsoft's AI reach and management raised fiscal guidance.",
          sector: "Software",
        },
      ],
    })

    const update = await upsertInvestingEvents({
      stateFile,
      portfolioFile,
      watchlistFile,
      events: [
        ...classifyInvestingConnectorEvents({
          connector: "earnings",
          entities: earningsEntities,
          capturedAt: "2026-03-15T10:03:00.000Z",
        }),
        ...classifyInvestingConnectorEvents({
          connector: "news",
          entities: newsEntities,
          capturedAt: "2026-03-15T10:04:00.000Z",
        }),
      ],
    })

    expect(update.batchCount).toBe(2)
    expect(update.inserted).toBe(2)
    expect(update.totalEvents).toBe(2)
    expect(update.countsByConnector.earnings).toBe(1)
    expect(update.countsByConnector.news).toBe(1)
    expect(update.batchCountsByMaterialityBand.critical).toBe(2)
    expect(update.batchHoldingLinkedCount).toBe(1)
    expect(update.batchWatchlistLinkedCount).toBe(1)
    expect(recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.event.classified")).toHaveLength(2)
    expect(recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.event.scored")).toHaveLength(2)

    const status = await getInvestingEventCatalogStatus(stateFile)
    expect(status.totalEvents).toBe(2)
    expect(status.countsByClassification.earnings_result).toBe(1)
    expect(status.countsByClassification.guidance_update).toBe(1)
    expect(status.countsByMaterialityBand.critical).toBe(2)
    expect(status.holdingLinkedCount).toBe(1)
    expect(status.watchlistLinkedCount).toBe(1)

    const holdingEvents = await listInvestingEvents({
      stateFile,
      holdingOnly: true,
      limit: 5,
    })
    expect(holdingEvents).toHaveLength(1)
    expect(holdingEvents[0]?.symbol).toBe("NVDA")
    expect(holdingEvents[0]?.entityLinks.holdingId).toBe("holding:equity:nvda")
    expect(holdingEvents[0]?.entityLinks.sectorLabels).toContain("Semiconductors")
    expect(holdingEvents[0]?.materiality.band).toBe("critical")

    const watchlistEvents = await listInvestingEvents({
      stateFile,
      watchlistOnly: true,
      materialityBand: "critical",
      limit: 5,
    })
    expect(watchlistEvents).toHaveLength(1)
    expect(watchlistEvents[0]?.symbol).toBe("MSFT")
    expect(watchlistEvents[0]?.entityLinks.watchlistId).toBe("watchlist:equity:msft")
    expect(watchlistEvents[0]?.entityLinks.sectorLabels).toContain("Software")

    const loaded = await getInvestingEvent(holdingEvents[0]!.id, stateFile)
    expect(loaded?.id).toBe(holdingEvents[0]?.id)
    expect(loaded?.materiality.score).toBeGreaterThanOrEqual(90)
  })
})
