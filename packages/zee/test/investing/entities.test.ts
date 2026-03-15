import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import {
  getInvestingEntityCatalogStatus,
  normalizeInvestingConnectorEntities,
  upsertInvestingEntities,
} from "../../src/investing/entities"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  mock.restore()
})

describe("normalizeInvestingConnectorEntities", () => {
  test("creates stable filing, company, and instrument identifiers", () => {
    const entities = normalizeInvestingConnectorEntities({
      connector: "filings",
      symbol: "AAPL",
      collectedAt: "2026-03-15T10:00:00.000Z",
      data: [
        {
          formType: "10-K",
          filedDate: "2026-02-01",
          periodEnd: "2025-12-31",
          description: "Annual report",
          url: "https://example.com/10k",
        },
      ],
    })

    expect(entities.map((entity) => entity.id)).toEqual([
      "company:equity:aapl",
      "instrument:equity:aapl",
      "filing:equity:aapl:10-k:2026-02-01",
    ])

    const filing = entities.find((entity) => entity.kind === "filing")
    expect(filing).toMatchObject({
      title: "AAPL 10-K",
      identifiers: {
        symbol: "AAPL",
        company: "company:equity:aapl",
        instrument: "instrument:equity:aapl",
      },
      lineage: {
        source: "filings",
        sourceType: "sec_filing",
        sourceId: "AAPL:10-K:2026-02-01",
        parentIds: ["company:equity:aapl", "instrument:equity:aapl"],
      },
    })
  })

  test("normalizes unstructured news records into event lineage", () => {
    const entities = normalizeInvestingConnectorEntities({
      connector: "news",
      collectedAt: "2026-03-15T11:00:00.000Z",
      data: {
        articles: [
          {
            id: "story-1",
            symbol: "msft",
            headline: "Microsoft expands cloud capacity",
            publishedAt: "2026-03-14T18:30:00Z",
            url: "https://example.com/story-1",
          },
        ],
      },
    })

    const newsEvent = entities.find((entity) => entity.subtype === "news")
    expect(newsEvent).toMatchObject({
      id: "event:news:msft:story-1",
      title: "Microsoft expands cloud capacity",
      identifiers: {
        symbol: "MSFT",
        company: "company:equity:msft",
        instrument: "instrument:equity:msft",
      },
      lineage: {
        source: "news",
        sourceType: "news",
        sourceId: "story-1",
      },
    })
  })
})

describe("investing entity catalog", () => {
  test("persists catalog updates and emits normalization telemetry", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-entity-catalog.json")
    const recordSpy = spyOn(FluxRecorder, "record")

    const filingBatch = normalizeInvestingConnectorEntities({
      connector: "filings",
      symbol: "NVDA",
      collectedAt: "2026-03-15T09:00:00.000Z",
      data: [
        {
          formType: "8-K",
          filedDate: "2026-03-10",
          periodEnd: "2026-03-10",
          description: "Current report",
        },
      ],
    })

    const first = await upsertInvestingEntities({
      entities: filingBatch,
      stateFile,
    })

    expect(first).toMatchObject({
      batchCount: 3,
      inserted: 3,
      updated: 0,
      totalEntities: 3,
    })
    expect(first.countsByKind.filing).toBe(1)
    expect(first.countsByLineageSource.filings).toBe(3)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.entity.normalized",
      status: "ok",
      metadata: {
        batchCount: 3,
        inserted: 3,
        updated: 0,
      },
    })

    const second = await upsertInvestingEntities({
      entities: normalizeInvestingConnectorEntities({
        connector: "market",
        symbol: "NVDA",
        collectedAt: "2026-03-15T09:30:00.000Z",
        data: {
          symbol: "NVDA",
          price: 900,
          change: 5,
          changePercent: 0.6,
          volume: 123456,
          timestamp: "2026-03-15T09:30:00Z",
        },
      }),
      stateFile,
    })

    expect(second.inserted).toBe(1)
    expect(second.updated).toBe(2)
    expect(second.totalEntities).toBe(4)
    expect(second.countsByKind.event).toBe(1)

    const status = await getInvestingEntityCatalogStatus({ stateFile })
    expect(status.totalEntities).toBe(4)
    expect(status.countsByKind.company).toBe(1)
    expect(status.countsByKind.instrument).toBe(1)
    expect(status.countsByKind.filing).toBe(1)
    expect(status.countsByKind.event).toBe(1)

    const onDisk = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
      entities: Record<string, unknown>
    }
    expect(Object.keys(onDisk.entities).sort()).toEqual([
      "company:equity:nvda",
      "event:market_snapshot:nvda:2026-03-15t09-30-00-000z",
      "filing:equity:nvda:8-k:2026-03-10",
      "instrument:equity:nvda",
    ])
  })
})
