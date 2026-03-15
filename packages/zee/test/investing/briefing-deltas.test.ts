import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { buildInvestingEventDeltaBrief, renderInvestingEventDeltaBrief } from "../../src/investing/briefing-deltas"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import { classifyInvestingConnectorEvents, upsertInvestingEvents } from "../../src/investing/events"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  mock.restore()
})

describe("investing briefing deltas", () => {
  test("builds daily and pre-earnings briefing deltas from scored events", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-events.json")
    const portfolioFile = path.join(dir.path, "portfolio.json")
    const watchlistFile = path.join(dir.path, "watchlist.json")
    const recordSpy = spyOn(FluxRecorder, "record")

    await fs.writeFile(
      portfolioFile,
      JSON.stringify(
        {
          positions: [{ symbol: "NVDA", shares: 5, averageCost: 400, sector: "Semiconductors" }],
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

    const events = [
      ...classifyInvestingConnectorEvents({
        connector: "earnings",
        entities: normalizeInvestingConnectorEntities({
          connector: "earnings",
          symbol: "NVDA",
          collectedAt: "2026-03-15T10:00:00.000Z",
          data: {
            symbol: "NVDA",
            quarters: [{ quarter: "Q1 2026", reportDate: "2026-03-15" }],
            avgEpsSurprisePercent: 6,
            beatRate: 0.9,
            earningsConsistency: 0.95,
          },
        }),
      }),
      ...classifyInvestingConnectorEvents({
        connector: "news",
        entities: normalizeInvestingConnectorEntities({
          connector: "news",
          collectedAt: "2026-03-15T10:00:00.000Z",
          data: [
            {
              symbol: "MSFT",
              articleId: "story-3",
              publishedAt: "2026-03-15T09:30:00.000Z",
              title: "Microsoft raises guidance after strong Azure growth",
              summary: "Azure momentum pushed management to raise guidance.",
              sector: "Software",
            },
          ],
        }),
      }),
    ]

    await upsertInvestingEvents({
      events,
      stateFile,
      portfolioFile,
      watchlistFile,
    })

    const daily = await buildInvestingEventDeltaBrief({
      stateFile,
      mode: "daily",
      limit: 5,
    })
    expect(daily.items).toHaveLength(2)
    expect(daily.items[0]?.materialityScore).toBeGreaterThanOrEqual(daily.items[1]?.materialityScore ?? 0)
    expect(renderInvestingEventDeltaBrief(daily)).toContain("Event Deltas:")

    const preview = await buildInvestingEventDeltaBrief({
      stateFile,
      mode: "pre-earnings",
      symbols: ["MSFT"],
      limit: 5,
    })
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      symbol: "MSFT",
      classification: "guidance_update",
      audience: "watchlist",
    })
    expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.event.delta")).toBe(true)
  })
})
