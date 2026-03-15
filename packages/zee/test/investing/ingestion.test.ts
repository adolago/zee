import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import {
  executeInvestingConnectorRun,
  getInvestingIngestionStatus,
  registerInvestingIngestionSchedules,
  resolveInvestingIngestionConfig,
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
      symbols: ["AAPL", "MSFT"],
    })
    expect(config.connectors.earnings).toMatchObject({
      enabled: true,
      scheduleMinutes: 12 * 60,
      symbols: ["AAPL", "MSFT"],
      quarters: 12,
    })
    expect(config.connectors.market).toMatchObject({
      enabled: false,
      scheduleMinutes: 15,
      symbols: ["NVDA"],
    })
    expect(config.connectors.transcripts).toMatchObject({
      enabled: true,
      scheduleMinutes: 6 * 60,
      endpointPath: "/api/transcripts/custom",
      lookbackDays: 14,
    })
    expect(config.connectors.news.endpointPath).toBe("/api/news/recent")
  })
})

describe("executeInvestingConnectorRun", () => {
  test("persists successful runs and emits telemetry", async () => {
    await using dir = await tmpdir()
    const stateFile = path.join(dir.path, "investing-ingestion.json")
    const recordSpy = spyOn(FluxRecorder, "record")
    const startedAt = 1_700_000_000_000

    const result = await executeInvestingConnectorRun({
      connector: "earnings",
      client: {} as any,
      config: {
        enabled: true,
        scheduleMinutes: 30,
        symbols: ["AAPL"],
        quarters: 8,
      },
      stateFile,
      now: startedAt,
      executor: async () => ({
        itemCount: 4,
        requestCount: 1,
        details: ["AAPL"],
      }),
    })

    expect(result).toMatchObject({
      connector: "earnings",
      lastStatus: "ok",
      itemCount: 4,
      requestCount: 1,
      coverageSymbols: ["AAPL"],
      details: ["AAPL"],
    })
    expect(result.lastStartedAt).toBe(startedAt)
    expect(result.lastFinishedAt).toBeGreaterThanOrEqual(startedAt)
    expect(recordSpy).toHaveBeenCalledTimes(1)
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.ingestion.run",
      status: "ok",
      path: "earnings",
      metadata: {
        connector: "earnings",
        itemCount: 4,
        requestCount: 1,
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
      coverageSymbols: ["AAPL"],
    })
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
          symbols: [],
          endpointPath: "/api/news/recent",
          lookbackDays: 3,
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
      itemCount: 0,
      requestCount: 0,
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
              coverageSymbols: ["OLD"],
              lastStartedAt: 10,
              lastFinishedAt: 20,
              lastDurationMs: 10,
              lastStatus: "ok",
              itemCount: 7,
              requestCount: 2,
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
      coverageSymbols: ["AAPL", "MSFT"],
      lastStatus: "ok",
      itemCount: 7,
      requestCount: 2,
    })
    expect(market).toMatchObject({
      connector: "market",
      scheduledTaskId: "investing.ingestion.market",
      enabled: false,
      lastStartedAt: 0,
      lastFinishedAt: 0,
      itemCount: 0,
      requestCount: 0,
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
    ])
    expect(registered.map((task) => task.scope)).toEqual(["global", "global", "global", "global", "global"])
    expect(registered.find((task) => task.id === "investing.ingestion.news")?.interval).toBe(5 * 60 * 1000)
    expect(recordSpy).toHaveBeenCalledTimes(5)
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      domain: "investing",
      kind: "investing.ingestion.schedule",
      status: "ok",
    })
  })
})
