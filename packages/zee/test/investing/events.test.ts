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
    })
    expect(events[0]?.summary).toContain("avg EPS surprise 5.0%")
  })

  test("classifies news entities with keyword-based topic and direction heuristics", () => {
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
    })
    expect(events[0]?.reasons[0]).toContain("guidance_update")
  })

  test("persists classified events, exposes status, and emits telemetry", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-events.json")
    const recordSpy = spyOn(FluxRecorder, "record")

    const earningsEntities = normalizeInvestingConnectorEntities({
      connector: "earnings",
      symbol: "NVDA",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: {
        symbol: "NVDA",
        quarters: [{ quarter: "Q1 2026", reportDate: "2026-02-20" }],
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
          symbol: "NVDA",
          articleId: "story-2",
          publishedAt: "2026-03-15T08:30:00.000Z",
          title: "Nvidia launches new enterprise AI platform with major cloud partners",
          summary: "The launch expands Nvidia's enterprise AI reach through new partnerships.",
        },
      ],
    })

    const update = await upsertInvestingEvents({
      stateFile,
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
    expect(recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.event.classified")).toHaveLength(2)

    const status = await getInvestingEventCatalogStatus(stateFile)
    expect(status.totalEvents).toBe(2)
    expect(status.countsByClassification.earnings_result).toBe(1)
    expect(status.countsByClassification.product_and_partnership).toBe(1)

    const listed = await listInvestingEvents({
      stateFile,
      symbol: "NVDA",
      limit: 5,
    })
    expect(listed).toHaveLength(2)
    expect(listed[0]?.symbol).toBe("NVDA")

    const loaded = await getInvestingEvent(listed[0]!.id, stateFile)
    expect(loaded?.id).toBe(listed[0]?.id)
  })
})
