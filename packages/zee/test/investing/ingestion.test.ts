import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { normalizeInvestingConnectorEntities } from "../../src/investing/entities"
import { getInvestingEventCatalogStatus } from "../../src/investing/events"
import {
  executeInvestingConnectorRun,
  executeInvestingConnectorRunWithRetry,
  getInvestingIngestionStatus,
  registerInvestingIngestionSchedules,
  resolveInvestingIngestionConfig,
  runInvestingConnectorBackfill,
} from "../../src/investing/ingestion"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  mock.restore()
})

describe("resolveInvestingIngestionConfig", () => {
  test("applies coverage defaults and connector overrides", () => {
    const config = resolveInvestingIngestionConfig({
      investing: {
        ingestion: {
          coverageSymbols: ["AAPL", "MSFT"],
          connectors: {
            earnings: {
              quarters: 12,
            },
            market: {
              enabled: false,
              scheduleMinutes: 15,
              symbols: ["NVDA"],
            },
            transcripts: {
              endpointPath: "/api/transcripts/custom",
              lookbackDays: 14,
            },
          },
        },
      },
    })

    expect(config.enabled).toBe(true)
    expect(config.coverageSymbols).toEqual(["AAPL", "MSFT"])
    expect(config.connectors.filings).toMatchObject({
      enabled: true,
      scheduleMinutes: 24 * 60,
      retryAttempts: 3,
      freshnessSloMinutes: 2 * 24 * 60,
      symbols: ["AAPL", "MSFT"],
    })
    expect(config.connectors.earnings).toMatchObject({
      enabled: true,
      scheduleMinutes: 12 * 60,
      retryAttempts: 3,
      freshnessSloMinutes: 24 * 60,
      symbols: ["AAPL", "MSFT"],
      quarters: 12,
      backfillMaxQuarters: 16,
    })
    expect(config.connectors.market).toMatchObject({
      enabled: false,
      scheduleMinutes: 15,
      retryAttempts: 4,
      freshnessSloMinutes: 2 * 60,
      symbols: ["NVDA"],
    })
    expect(config.connectors.transcripts).toMatchObject({
      enabled: true,
      scheduleMinutes: 6 * 60,
      retryAttempts: 4,
      freshnessSloMinutes: 12 * 60,
      endpointPath: "/api/transcripts/custom",
      lookbackDays: 14,
      backfillMaxLookbackDays: 30,
    })
    expect(config.connectors.news.endpointPath).toBe("/api/news/recent")
  })
})

describe("executeInvestingConnectorRun", () => {
  test("persists successful runs and emits telemetry", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-ingestion.json")
    const entityStateFile = path.join(dir.path, "investing-entities.json")
    const eventStateFile = path.join(dir.path, "investing-events.json")
    const portfolioFile = path.join(dir.path, "portfolio.json")
    const watchlistFile = path.join(dir.path, "watchlist.json")
    const recordSpy = spyOn(FluxRecorder, "record")
    const startedAt = 1_700_000_000_000

    await fs.writeFile(
      portfolioFile,
      JSON.stringify(
        {
          positions: [{ symbol: "AAPL", shares: 8, averageCost: 180, sector: "Technology" }],
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

    const result = await executeInvestingConnectorRun({
      connector: "earnings",
      client: {} as any,
      config: {
        enabled: true,
        scheduleMinutes: 30,
        retryAttempts: 3,
        retryDelayMs: 500,
        freshnessSloMinutes: 120,
        symbols: ["AAPL"],
        quarters: 8,
        backfillMaxQuarters: 16,
      },
      stateFile,
      entityStateFile,
      portfolioFile,
      watchlistFile,
      now: startedAt,
      executor: async () => ({
        itemCount: 4,
        requestCount: 1,
        details: ["AAPL"],
        entities: normalizeInvestingConnectorEntities({
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
        }),
      }),
      eventStateFile,
    })

    expect(result).toMatchObject({
      connector: "earnings",
      lastStatus: "ok",
      itemCount: 4,
      requestCount: 1,
      coverageSymbols: ["AAPL"],
      retryAttempts: 3,
      freshnessSloMinutes: 120,
      freshnessStatus: "fresh",
      normalizedEntityCount: 3,
      normalizedKinds: ["company", "event", "instrument"],
      details: ["AAPL"],
    })
    expect(result.lastStartedAt).toBe(startedAt)
    expect(result.lastFinishedAt).toBeGreaterThanOrEqual(startedAt)
    expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.entity.normalized")).toBe(true)
    expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.event.classified")).toBe(true)
    expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.event.scored")).toBe(true)
    expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.ingestion.run")).toBe(true)
    expect(recordSpy.mock.calls.find((call) => call[0]?.kind === "investing.entity.normalized")?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.entity.normalized",
      status: "ok",
      metadata: {
        batchCount: 3,
        inserted: 3,
      },
    })
    expect(recordSpy.mock.calls.find((call) => call[0]?.kind === "investing.ingestion.run")?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.ingestion.run",
      status: "ok",
      path: "earnings",
      metadata: {
        connector: "earnings",
        itemCount: 4,
        requestCount: 1,
        normalizedEntityCount: 3,
        classifiedEventCount: 1,
        holdingLinkedCount: 1,
        watchlistLinkedCount: 0,
        freshnessStatus: "fresh",
      },
    })

    const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
      connectors: Record<string, unknown>
    }
    expect(state.connectors.earnings).toMatchObject({
      connector: "earnings",
      lastStatus: "ok",
      itemCount: 4,
      requestCount: 1,
      freshnessStatus: "fresh",
      normalizedEntityCount: 3,
      coverageSymbols: ["AAPL"],
    })

    const eventStatus = await getInvestingEventCatalogStatus(eventStateFile)
    expect(eventStatus.totalEvents).toBe(1)
    expect(eventStatus.countsByConnector.earnings).toBe(1)
    expect(eventStatus.countsByMaterialityBand.critical).toBe(1)
    expect(eventStatus.holdingLinkedCount).toBe(1)
  })

  test("persists failed runs and emits error telemetry", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-ingestion.json")
    const recordSpy = spyOn(FluxRecorder, "record")

    let thrown: unknown
    try {
      await executeInvestingConnectorRun({
        connector: "news",
        client: {} as any,
        config: {
          enabled: true,
          scheduleMinutes: 5,
          retryAttempts: 4,
          retryDelayMs: 500,
          freshnessSloMinutes: 30,
          symbols: [],
          endpointPath: "/api/news/recent",
          lookbackDays: 3,
          backfillMaxLookbackDays: 30,
        },
        stateFile,
        now: 1_700_000_100_000,
        executor: async () => {
          throw new Error("news endpoint unavailable")
        },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe("news endpoint unavailable")
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.ingestion.run",
      status: "error",
      path: "news",
      error: {
        message: "news endpoint unavailable",
      },
    })

    const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
      connectors: Record<string, unknown>
    }
    expect(state.connectors.news).toMatchObject({
      connector: "news",
      lastStatus: "error",
      freshnessStatus: "stale",
      itemCount: 0,
      requestCount: 0,
      normalizedEntityCount: 0,
      error: "news endpoint unavailable",
    })
  })
})

describe("getInvestingIngestionStatus", () => {
  test("merges persisted connector state with configured schedules", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-ingestion.json")
    await fs.writeFile(
      stateFile,
      JSON.stringify(
        {
          version: 1,
          connectors: {
            filings: {
              connector: "filings",
              enabled: true,
              scheduleMinutes: 999,
              retryAttempts: 3,
              freshnessSloMinutes: 120,
              coverageSymbols: ["OLD"],
              lastStartedAt: 10,
              lastFinishedAt: 20,
              lastDurationMs: 10,
              lastStatus: "ok",
              freshnessStatus: "fresh",
              itemCount: 7,
              requestCount: 2,
              normalizedEntityCount: 5,
              normalizedKinds: ["company", "filing", "instrument"],
              details: ["OLD"],
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    )

    const status = await getInvestingIngestionStatus({
      stateFile,
      config: {
        investing: {
          ingestion: {
            coverageSymbols: ["AAPL", "MSFT"],
            connectors: {
              filings: {
                scheduleMinutes: 120,
              },
              market: {
                enabled: false,
              },
            },
          },
        },
      },
    })

    const filings = status.connectors.find((connector) => connector.connector === "filings")
    const market = status.connectors.find((connector) => connector.connector === "market")

    expect(status.enabled).toBe(true)
    expect(filings).toMatchObject({
      connector: "filings",
      scheduledTaskId: "investing.ingestion.filings",
      scheduleMinutes: 120,
      retryAttempts: 3,
      freshnessSloMinutes: 2 * 24 * 60,
      freshnessStatus: "stale",
      coverageSymbols: ["AAPL", "MSFT"],
      lastStatus: "ok",
      itemCount: 7,
      requestCount: 2,
      normalizedEntityCount: 5,
    })
    expect(market).toMatchObject({
      connector: "market",
      scheduledTaskId: "investing.ingestion.market",
      enabled: false,
      freshnessStatus: "disabled",
      lastStartedAt: 0,
      lastFinishedAt: 0,
      itemCount: 0,
      requestCount: 0,
      normalizedEntityCount: 0,
    })
  })
})

describe("registerInvestingIngestionSchedules", () => {
  test("registers enabled connectors and records schedule telemetry", () => {
    const registered: Array<{
      id: string
      interval: number
      scope?: "instance" | "global"
      run: () => void | Promise<void>
    }> = []
    const recordSpy = spyOn(FluxRecorder, "record")

    const registrations = registerInvestingIngestionSchedules({
      config: resolveInvestingIngestionConfig({
        investing: {
          ingestion: {
            coverageSymbols: ["AAPL"],
            connectors: {
              macro: {
                enabled: false,
              },
              news: {
                scheduleMinutes: 5,
              },
            },
          },
        },
      }),
      register: (task) => {
        registered.push(task)
      },
      runConnector: async () => {},
    })

    expect(registrations.map((entry) => entry.connector)).toEqual([
      "filings",
      "earnings",
      "transcripts",
      "market",
      "news",
    ])
    expect(registered.map((task) => task.id)).toEqual([
      "investing.ingestion.filings",
      "investing.ingestion.earnings",
      "investing.ingestion.transcripts",
      "investing.ingestion.market",
      "investing.ingestion.news",
      "investing.ingestion.freshness.monitor",
    ])
    expect(registered.map((task) => task.scope)).toEqual(["global", "global", "global", "global", "global", "global"])
    expect(registered.find((task) => task.id === "investing.ingestion.news")?.interval).toBe(5 * 60 * 1000)
    expect(registered.find((task) => task.id === "investing.ingestion.freshness.monitor")?.interval).toBe(60 * 60 * 1000)
    expect(recordSpy).toHaveBeenCalledTimes(5)
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.ingestion.schedule",
      status: "ok",
    })
  })
})

describe("executeInvestingConnectorRunWithRetry", () => {
  test("retries transient connector failures before succeeding", async () => {
    const recordSpy = spyOn(FluxRecorder, "record")
    let attempts = 0

    const result = await executeInvestingConnectorRunWithRetry({
      connector: "market",
      client: {} as any,
      config: {
        enabled: true,
        scheduleMinutes: 60,
        retryAttempts: 3,
        retryDelayMs: 1,
        freshnessSloMinutes: 120,
        symbols: ["NVDA"],
      },
      executor: async () => {
        attempts += 1
        if (attempts < 3) throw new Error("network request failed")
        return {
          itemCount: 1,
          requestCount: 1,
          details: ["NVDA"],
        }
      },
      sleep: async () => {},
    })

    expect(result.lastStatus).toBe("ok")
    expect(attempts).toBe(3)
    expect(recordSpy.mock.calls.filter((call) => call[0]?.kind === "investing.ingestion.retry")).toHaveLength(2)
  })
})

describe("runInvestingConnectorBackfill", () => {
  test("applies validated backfill overrides and persists the operation record", async () => {
    await using dir = await tmpdir()
    const operationsFile = path.join(dir.path, "investing-backfills.json")
    const recordSpy = spyOn(FluxRecorder, "record")
    let seenConfig: Record<string, unknown> | undefined

    const result = await runInvestingConnectorBackfill({
      connector: "news",
      operationsFile,
      lookbackDays: 14,
      config: {
        investing: {
          ingestion: {
            connectors: {
              news: {
                lookbackDays: 3,
                backfillMaxLookbackDays: 30,
              },
            },
          },
        },
      },
      runConnector: async ({ config }) => {
        seenConfig = config
        return {
          connector: "news",
          enabled: true,
          scheduleMinutes: 120,
          retryAttempts: 4,
          freshnessSloMinutes: 240,
          coverageSymbols: [],
          endpointPath: "/api/news/recent",
          lastStartedAt: 1,
          lastFinishedAt: 2,
          lastDurationMs: 1,
          lastStatus: "ok",
          freshnessStatus: "fresh",
          itemCount: 6,
          requestCount: 1,
          normalizedEntityCount: 4,
          normalizedKinds: ["event"],
          details: ["news"],
        }
      },
    })

    expect(seenConfig).toMatchObject({
      lookbackDays: 14,
    })
    expect(result).toMatchObject({
      connector: "news",
      status: "ok",
      lookbackDays: 14,
      itemCount: 6,
      normalizedEntityCount: 4,
    })
    const persisted = JSON.parse(await fs.readFile(operationsFile, "utf8")) as {
      operations: Array<Record<string, unknown>>
    }
    expect(persisted.operations[0]).toMatchObject({
      connector: "news",
      status: "ok",
      lookbackDays: 14,
    })
    expect(recordSpy.mock.calls.some((call) => call[0]?.kind === "investing.ingestion.backfill")).toBe(true)
  })
})
