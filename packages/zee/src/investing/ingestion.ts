import fs from "node:fs/promises"
import path from "node:path"
import { InvestingClient } from "@zee/investing-sdk"
import { Config } from "@/config/config"
import { FluxRecorder } from "@/flux"
import { Global } from "@/global"
import { Investing as InvestingPaths } from "@/paths"
import { Instance } from "@/project/instance"
import { Scheduler } from "@/scheduler"
import { Log } from "@/util/log"

const log = Log.create({ service: "investing:ingestion" })

export const INVESTING_CONNECTOR_KINDS = [
  "filings",
  "earnings",
  "transcripts",
  "market",
  "macro",
  "news",
] as const

export type InvestingConnectorKind = (typeof INVESTING_CONNECTOR_KINDS)[number]

export type InvestingConnectorRunStatus = "ok" | "error"

export type InvestingConnectorRunRecord = {
  connector: InvestingConnectorKind
  enabled: boolean
  scheduleMinutes: number
  coverageSymbols: string[]
  endpointPath?: string
  lastStartedAt: number
  lastFinishedAt: number
  lastDurationMs: number
  lastStatus: InvestingConnectorRunStatus
  itemCount: number
  requestCount: number
  details: string[]
  error?: string
}

type InvestingIngestionState = {
  version: 1
  connectors: Partial<Record<InvestingConnectorKind, InvestingConnectorRunRecord>>
}

export type InvestingConnectorConfig = {
  enabled: boolean
  scheduleMinutes: number
  symbols: string[]
  endpointPath?: string
  quarters?: number
  lookbackDays?: number
}

export type InvestingIngestionConfig = {
  enabled: boolean
  coverageSymbols: string[]
  connectors: Record<InvestingConnectorKind, InvestingConnectorConfig>
}

export type InvestingIngestionStatus = {
  enabled: boolean
  connectors: Array<InvestingConnectorRunRecord & { scheduledTaskId: string }>
}

type ConnectorRunSummary = {
  itemCount: number
  requestCount: number
  details?: string[]
}

export type InvestingConnectorExecutor = (input: {
  client: InvestingClient
  config: InvestingConnectorConfig
}) => Promise<ConnectorRunSummary>

type RegisterTask = typeof Scheduler.register

const DEFAULT_SCHEDULE_MINUTES: Record<InvestingConnectorKind, number> = {
  filings: 24 * 60,
  earnings: 12 * 60,
  transcripts: 6 * 60,
  market: 60,
  macro: 3 * 60,
  news: 2 * 60,
}

const DEFAULT_ENDPOINT_PATHS: Partial<Record<InvestingConnectorKind, string>> = {
  transcripts: "/api/transcripts/recent",
  news: "/api/news/recent",
}

const STATE_FILE = path.join(Global.Path.state, "investing-ingestion.json")

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function resolveBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function resolveStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
}

function resolvePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function countItems(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== "object") return value == null ? 0 : 1
  const record = value as Record<string, unknown>
  if (Array.isArray(record.quarters)) return record.quarters.length
  if (record.indices && typeof record.indices === "object") {
    const indices = Object.keys(record.indices as Record<string, unknown>).length
    const sectors = record.sectors && typeof record.sectors === "object" ? Object.keys(record.sectors as Record<string, unknown>).length : 0
    return indices + sectors
  }
  return 1
}

function scheduleTaskId(connector: InvestingConnectorKind): string {
  return `investing.ingestion.${connector}`
}

async function readState(stateFile = STATE_FILE): Promise<InvestingIngestionState> {
  const raw = await fs.readFile(stateFile, "utf8").catch(() => "")
  if (!raw) return { version: 1, connectors: {} }
  try {
    const parsed = JSON.parse(raw) as InvestingIngestionState
    return {
      version: 1,
      connectors: parsed.connectors ?? {},
    }
  } catch {
    return { version: 1, connectors: {} }
  }
}

async function writeState(state: InvestingIngestionState, stateFile = STATE_FILE): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8")
}

async function createInvestingClient(config: unknown): Promise<InvestingClient> {
  const root = asObject(config) ?? {}
  const investing = asObject(root.investing) ?? {}
  const client = new InvestingClient({
    baseUrl: typeof investing.baseUrl === "string" && investing.baseUrl.trim().length > 0 ? investing.baseUrl : InvestingPaths.apiUrl(),
    auth: {
      apiKey: typeof investing.apiKey === "string" ? investing.apiKey : undefined,
    },
    daemon: {
      autoStart: resolveBool(investing.autoStart, true),
      coreBin: InvestingPaths.coreBin(),
      repoPath: typeof investing.repoPath === "string" && investing.repoPath.trim().length > 0 ? investing.repoPath : InvestingPaths.repo(),
    },
    ws: {
      enabled: false,
    },
  })
  await client.connect()
  return client
}

async function runRawListEndpoint(
  client: InvestingClient,
  endpointPath: string,
  lookbackDays: number,
): Promise<ConnectorRunSummary> {
  const separator = endpointPath.includes("?") ? "&" : "?"
  const response = await client.rawRequest<unknown>("GET", `${endpointPath}${separator}lookback_days=${lookbackDays}`)
  if (!response.success) {
    throw new Error(response.error ?? `request failed for ${endpointPath}`)
  }
  return {
    itemCount: countItems(response.data),
    requestCount: 1,
    details: [endpointPath],
  }
}

const BUILTIN_CONNECTORS: Record<InvestingConnectorKind, InvestingConnectorExecutor> = {
  filings: async ({ client, config }) => {
    let itemCount = 0
    let requestCount = 0
    for (const symbol of config.symbols) {
      const response = await client.accounting.getFilings(symbol)
      requestCount += 1
      if (!response.success) throw new Error(response.error ?? `filings connector failed for ${symbol}`)
      itemCount += Array.isArray(response.data) ? response.data.length : 0
    }
    return {
      itemCount,
      requestCount,
      details: config.symbols,
    }
  },
  earnings: async ({ client, config }) => {
    let itemCount = 0
    let requestCount = 0
    const quarters = config.quarters ?? 8
    for (const symbol of config.symbols) {
      const response = await client.research.getEarnings(symbol, quarters)
      requestCount += 1
      if (!response.success) throw new Error(response.error ?? `earnings connector failed for ${symbol}`)
      itemCount += Array.isArray(response.data?.quarters) ? response.data.quarters.length : 0
    }
    return {
      itemCount,
      requestCount,
      details: config.symbols,
    }
  },
  transcripts: async ({ client, config }) => {
    return runRawListEndpoint(client, config.endpointPath ?? DEFAULT_ENDPOINT_PATHS.transcripts!, config.lookbackDays ?? 7)
  },
  market: async ({ client, config }) => {
    let itemCount = 0
    let requestCount = 0
    for (const symbol of config.symbols) {
      const response = await client.market.getData(symbol)
      requestCount += 1
      if (!response.success) throw new Error(response.error ?? `market connector failed for ${symbol}`)
      itemCount += response.data ? 1 : 0
    }
    return {
      itemCount,
      requestCount,
      details: config.symbols,
    }
  },
  macro: async ({ client }) => {
    const response = await client.macro.getCalendar()
    if (!response.success) throw new Error(response.error ?? "macro connector failed")
    return {
      itemCount: Array.isArray(response.data) ? response.data.length : 0,
      requestCount: 1,
      details: ["calendar"],
    }
  },
  news: async ({ client, config }) => {
    return runRawListEndpoint(client, config.endpointPath ?? DEFAULT_ENDPOINT_PATHS.news!, config.lookbackDays ?? 3)
  },
}

export function resolveInvestingIngestionConfig(config: unknown): InvestingIngestionConfig {
  const root = asObject(config) ?? {}
  const investing = asObject(root.investing) ?? {}
  const ingestion = asObject(investing.ingestion) ?? {}
  const connectorRoot = asObject(ingestion.connectors) ?? {}
  const coverageSymbols = resolveStringArray(ingestion.coverageSymbols)

  const connectors = Object.fromEntries(
    INVESTING_CONNECTOR_KINDS.map((kind) => {
      const raw = asObject(connectorRoot[kind]) ?? {}
      return [
        kind,
        {
          enabled: resolveBool(raw.enabled, true),
          scheduleMinutes: resolvePositiveInt(raw.scheduleMinutes, DEFAULT_SCHEDULE_MINUTES[kind]),
          symbols: resolveStringArray(raw.symbols).length > 0 ? resolveStringArray(raw.symbols) : coverageSymbols,
          endpointPath:
            typeof raw.endpointPath === "string" && raw.endpointPath.trim().length > 0
              ? raw.endpointPath
              : DEFAULT_ENDPOINT_PATHS[kind],
          quarters: typeof raw.quarters === "number" ? resolvePositiveInt(raw.quarters, 8) : undefined,
          lookbackDays: typeof raw.lookbackDays === "number" ? resolvePositiveInt(raw.lookbackDays, 7) : undefined,
        } satisfies InvestingConnectorConfig,
      ]
    }),
  ) as Record<InvestingConnectorKind, InvestingConnectorConfig>

  return {
    enabled: resolveBool(ingestion.enabled, true),
    coverageSymbols,
    connectors,
  }
}

export async function executeInvestingConnectorRun(input: {
  connector: InvestingConnectorKind
  config: InvestingConnectorConfig
  client: InvestingClient
  executor?: InvestingConnectorExecutor
  stateFile?: string
  now?: number
}): Promise<InvestingConnectorRunRecord> {
  const startedAt = input.now ?? Date.now()
  const executor = input.executor ?? BUILTIN_CONNECTORS[input.connector]
  const state = await readState(input.stateFile)

  try {
    const summary = await executor({
      client: input.client,
      config: input.config,
    })
    const finishedAt = Date.now()
    const record: InvestingConnectorRunRecord = {
      connector: input.connector,
      enabled: input.config.enabled,
      scheduleMinutes: input.config.scheduleMinutes,
      coverageSymbols: input.config.symbols,
      endpointPath: input.config.endpointPath,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastDurationMs: finishedAt - startedAt,
      lastStatus: "ok",
      itemCount: summary.itemCount,
      requestCount: summary.requestCount,
      details: summary.details ?? [],
    }
    state.connectors[input.connector] = record
    await writeState(state, input.stateFile)
    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.ingestion.run",
      status: "ok",
      method: "scheduler",
      path: input.connector,
      route: input.connector,
      latencyMs: record.lastDurationMs,
      metadata: {
        connector: input.connector,
        itemCount: record.itemCount,
        requestCount: record.requestCount,
        scheduleMinutes: record.scheduleMinutes,
        coverageSymbols: record.coverageSymbols,
        endpointPath: record.endpointPath,
      },
    })
    return record
  } catch (error) {
    const finishedAt = Date.now()
    const message = error instanceof Error ? error.message : String(error)
    const record: InvestingConnectorRunRecord = {
      connector: input.connector,
      enabled: input.config.enabled,
      scheduleMinutes: input.config.scheduleMinutes,
      coverageSymbols: input.config.symbols,
      endpointPath: input.config.endpointPath,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastDurationMs: finishedAt - startedAt,
      lastStatus: "error",
      itemCount: 0,
      requestCount: 0,
      details: [],
      error: message,
    }
    state.connectors[input.connector] = record
    await writeState(state, input.stateFile)
    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.ingestion.run",
      status: "error",
      method: "scheduler",
      path: input.connector,
      route: input.connector,
      latencyMs: record.lastDurationMs,
      error: {
        message,
      },
      metadata: {
        connector: input.connector,
        scheduleMinutes: record.scheduleMinutes,
        coverageSymbols: record.coverageSymbols,
        endpointPath: record.endpointPath,
      },
    })
    throw error
  }
}

export async function runInvestingConnector(
  connector: InvestingConnectorKind,
  options: {
    config?: unknown
    stateFile?: string
  } = {},
): Promise<InvestingConnectorRunRecord> {
  const rawConfig = options.config ?? (await Config.get())
  const resolved = resolveInvestingIngestionConfig(rawConfig)
  const connectorConfig = resolved.connectors[connector]
  const client = await createInvestingClient(rawConfig)
  try {
    return await executeInvestingConnectorRun({
      connector,
      config: connectorConfig,
      client,
      stateFile: options.stateFile,
    })
  } finally {
    await client.disconnect().catch(() => {})
  }
}

export async function runEnabledInvestingConnectors(options: {
  config?: unknown
  stateFile?: string
  connectors?: InvestingConnectorKind[]
} = {}): Promise<InvestingConnectorRunRecord[]> {
  const rawConfig = options.config ?? (await Config.get())
  const resolved = resolveInvestingIngestionConfig(rawConfig)
  if (!resolved.enabled) return []
  const selected = options.connectors?.length ? options.connectors : INVESTING_CONNECTOR_KINDS
  const enabled = selected.filter((connector) => resolved.connectors[connector].enabled)
  if (enabled.length === 0) return []
  const client = await createInvestingClient(rawConfig)
  try {
    const results: InvestingConnectorRunRecord[] = []
    for (const connector of enabled) {
      results.push(
        await executeInvestingConnectorRun({
          connector,
          config: resolved.connectors[connector],
          client,
          stateFile: options.stateFile,
        }),
      )
    }
    return results
  } finally {
    await client.disconnect().catch(() => {})
  }
}

export async function getInvestingIngestionStatus(options: {
  config?: unknown
  stateFile?: string
} = {}): Promise<InvestingIngestionStatus> {
  const rawConfig = options.config ?? (await Config.get())
  const resolved = resolveInvestingIngestionConfig(rawConfig)
  const state = await readState(options.stateFile)
  return {
    enabled: resolved.enabled,
    connectors: INVESTING_CONNECTOR_KINDS.map((connector) => {
      const current = state.connectors[connector]
      const fallback: InvestingConnectorRunRecord = {
        connector,
        enabled: resolved.connectors[connector].enabled,
        scheduleMinutes: resolved.connectors[connector].scheduleMinutes,
        coverageSymbols: resolved.connectors[connector].symbols,
        endpointPath: resolved.connectors[connector].endpointPath,
        lastStartedAt: 0,
        lastFinishedAt: 0,
        lastDurationMs: 0,
        lastStatus: "ok",
        itemCount: 0,
        requestCount: 0,
        details: [],
      }
      return {
        ...(current ?? fallback),
        enabled: resolved.connectors[connector].enabled,
        scheduleMinutes: resolved.connectors[connector].scheduleMinutes,
        coverageSymbols: resolved.connectors[connector].symbols,
        endpointPath: resolved.connectors[connector].endpointPath,
        scheduledTaskId: scheduleTaskId(connector),
      }
    }),
  }
}

export function registerInvestingIngestionSchedules(input: {
  config: InvestingIngestionConfig
  directory?: string
  rawConfig?: unknown
  stateFile?: string
  register?: RegisterTask
  runConnector?: (connector: InvestingConnectorKind) => Promise<unknown>
}): Array<{ connector: InvestingConnectorKind; taskId: string; scheduleMinutes: number }> {
  if (!input.config.enabled) return []
  const register = input.register ?? Scheduler.register
  const runConnector =
    input.runConnector ??
    (async (connector: InvestingConnectorKind) => {
      const run = async () =>
        await runInvestingConnector(connector, {
          config: input.rawConfig,
          stateFile: input.stateFile,
        })
      if (input.directory) {
        return await Instance.provide({
          directory: input.directory,
          fn: run,
        })
      }
      return await run()
    })

  const registrations: Array<{ connector: InvestingConnectorKind; taskId: string; scheduleMinutes: number }> = []
  for (const connector of INVESTING_CONNECTOR_KINDS) {
    const connectorConfig = input.config.connectors[connector]
    if (!connectorConfig.enabled) continue
    const taskId = scheduleTaskId(connector)
    register({
      id: taskId,
      interval: connectorConfig.scheduleMinutes * 60 * 1000,
      scope: "global",
      run: async () => {
        try {
          await runConnector(connector)
        } catch (error) {
          log.warn("connector run failed", {
            connector,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    })
    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.ingestion.schedule",
      status: "ok",
      method: "scheduler",
      path: connector,
      route: taskId,
      metadata: {
        connector,
        scheduleMinutes: connectorConfig.scheduleMinutes,
        coverageSymbols: connectorConfig.symbols,
        endpointPath: connectorConfig.endpointPath,
      },
    })
    registrations.push({
      connector,
      taskId,
      scheduleMinutes: connectorConfig.scheduleMinutes,
    })
  }
  return registrations
}

export async function registerInvestingIngestionScheduler(): Promise<Array<{
  connector: InvestingConnectorKind
  taskId: string
  scheduleMinutes: number
}>> {
  const directory = Instance.directory
  const config = await Config.get()
  return registerInvestingIngestionSchedules({
    config: resolveInvestingIngestionConfig(config),
    directory,
    rawConfig: config,
  })
}
