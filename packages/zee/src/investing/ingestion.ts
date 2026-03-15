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
import {
  normalizeInvestingConnectorEntities,
  upsertInvestingEntities,
  type NormalizedInvestingEntity,
} from "@/investing/entities"

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
export type InvestingConnectorFreshnessStatus = "fresh" | "stale" | "missing" | "disabled"

export type InvestingConnectorRunRecord = {
  connector: InvestingConnectorKind
  enabled: boolean
  scheduleMinutes: number
  retryAttempts: number
  freshnessSloMinutes: number
  coverageSymbols: string[]
  endpointPath?: string
  lastStartedAt: number
  lastFinishedAt: number
  lastDurationMs: number
  lastStatus: InvestingConnectorRunStatus
  freshnessStatus: InvestingConnectorFreshnessStatus
  itemCount: number
  requestCount: number
  normalizedEntityCount: number
  normalizedKinds: string[]
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
  retryAttempts: number
  retryDelayMs: number
  freshnessSloMinutes: number
  symbols: string[]
  endpointPath?: string
  quarters?: number
  lookbackDays?: number
  backfillMaxLookbackDays?: number
  backfillMaxQuarters?: number
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

export type InvestingBackfillOperationRecord = {
  id: string
  connector: InvestingConnectorKind
  requestedAt: number
  startedAt: number
  finishedAt: number
  status: InvestingConnectorRunStatus
  symbols: string[]
  lookbackDays?: number
  quarters?: number
  itemCount: number
  normalizedEntityCount: number
  retryAttempts: number
  error?: string
}

type ConnectorRunSummary = {
  itemCount: number
  requestCount: number
  entities?: NormalizedInvestingEntity[]
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

const DEFAULT_RETRY_ATTEMPTS: Record<InvestingConnectorKind, number> = {
  filings: 3,
  earnings: 3,
  transcripts: 4,
  market: 4,
  macro: 3,
  news: 4,
}

const DEFAULT_RETRY_DELAY_MS: Record<InvestingConnectorKind, number> = {
  filings: 1_000,
  earnings: 1_000,
  transcripts: 1_000,
  market: 500,
  macro: 1_000,
  news: 1_000,
}

const DEFAULT_FRESHNESS_SLO_MINUTES: Record<InvestingConnectorKind, number> = {
  filings: 2 * 24 * 60,
  earnings: 24 * 60,
  transcripts: 12 * 60,
  market: 2 * 60,
  macro: 6 * 60,
  news: 4 * 60,
}

const DEFAULT_BACKFILL_LOOKBACK_DAYS: Partial<Record<InvestingConnectorKind, number>> = {
  transcripts: 30,
  news: 30,
}

const DEFAULT_BACKFILL_QUARTERS: Partial<Record<InvestingConnectorKind, number>> = {
  earnings: 16,
}

const STATE_FILE = path.join(Global.Path.state, "investing-ingestion.json")
const BACKFILL_STATE_FILE = path.join(Global.Path.state, "investing-ingestion-backfills.json")

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

function resolvePositiveOptionalInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
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

async function readBackfillOperations(stateFile = BACKFILL_STATE_FILE): Promise<InvestingBackfillOperationRecord[]> {
  const raw = await fs.readFile(stateFile, "utf8").catch(() => "")
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { operations?: InvestingBackfillOperationRecord[] }
    return Array.isArray(parsed.operations) ? parsed.operations : []
  } catch {
    return []
  }
}

async function writeBackfillOperations(
  operations: InvestingBackfillOperationRecord[],
  stateFile = BACKFILL_STATE_FILE,
): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(
    stateFile,
    JSON.stringify(
      {
        version: 1,
        operations,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
}

function computeFreshnessStatus(input: {
  enabled: boolean
  lastFinishedAt: number
  lastStatus: InvestingConnectorRunStatus
  freshnessSloMinutes: number
  now?: number
}): InvestingConnectorFreshnessStatus {
  if (!input.enabled) return "disabled"
  if (input.lastFinishedAt <= 0) return "missing"
  if (input.lastStatus === "error") return "stale"
  const now = input.now ?? Date.now()
  const maxAgeMs = input.freshnessSloMinutes * 60 * 1000
  return now - input.lastFinishedAt > maxAgeMs ? "stale" : "fresh"
}

function isRetryableConnectorError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return [
    "timed out",
    "timeout",
    "network",
    "socket hang up",
    "econnreset",
    "econnrefused",
    "etimedout",
    "request failed",
    "failed to fetch",
  ].some((marker) => message.includes(marker))
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
  connector: "transcripts" | "news",
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
    entities: normalizeInvestingConnectorEntities({
      connector,
      data: response.data,
    }),
  }
}

const BUILTIN_CONNECTORS: Record<InvestingConnectorKind, InvestingConnectorExecutor> = {
  filings: async ({ client, config }) => {
    let itemCount = 0
    let requestCount = 0
    const entities: NormalizedInvestingEntity[] = []
    for (const symbol of config.symbols) {
      const response = await client.accounting.getFilings(symbol)
      requestCount += 1
      if (!response.success) throw new Error(response.error ?? `filings connector failed for ${symbol}`)
      itemCount += Array.isArray(response.data) ? response.data.length : 0
      entities.push(
        ...normalizeInvestingConnectorEntities({
          connector: "filings",
          symbol,
          data: response.data,
        }),
      )
    }
    return {
      itemCount,
      requestCount,
      entities,
      details: config.symbols,
    }
  },
  earnings: async ({ client, config }) => {
    let itemCount = 0
    let requestCount = 0
    const entities: NormalizedInvestingEntity[] = []
    const quarters = config.quarters ?? 8
    for (const symbol of config.symbols) {
      const response = await client.research.getEarnings(symbol, quarters)
      requestCount += 1
      if (!response.success) throw new Error(response.error ?? `earnings connector failed for ${symbol}`)
      itemCount += Array.isArray(response.data?.quarters) ? response.data.quarters.length : 0
      entities.push(
        ...normalizeInvestingConnectorEntities({
          connector: "earnings",
          symbol,
          data: response.data,
        }),
      )
    }
    return {
      itemCount,
      requestCount,
      entities,
      details: config.symbols,
    }
  },
  transcripts: async ({ client, config }) => {
    return runRawListEndpoint(client, "transcripts", config.endpointPath ?? DEFAULT_ENDPOINT_PATHS.transcripts!, config.lookbackDays ?? 7)
  },
  market: async ({ client, config }) => {
    let itemCount = 0
    let requestCount = 0
    const entities: NormalizedInvestingEntity[] = []
    for (const symbol of config.symbols) {
      const response = await client.market.getData(symbol)
      requestCount += 1
      if (!response.success) throw new Error(response.error ?? `market connector failed for ${symbol}`)
      itemCount += response.data ? 1 : 0
      if (response.data) {
        entities.push(
          ...normalizeInvestingConnectorEntities({
            connector: "market",
            symbol,
            data: response.data,
          }),
        )
      }
    }
    return {
      itemCount,
      requestCount,
      entities,
      details: config.symbols,
    }
  },
  macro: async ({ client }) => {
    const response = await client.macro.getCalendar()
    if (!response.success) throw new Error(response.error ?? "macro connector failed")
    return {
      itemCount: Array.isArray(response.data) ? response.data.length : 0,
      requestCount: 1,
      entities: normalizeInvestingConnectorEntities({
        connector: "macro",
        data: response.data,
      }),
      details: ["calendar"],
    }
  },
  news: async ({ client, config }) => {
    return runRawListEndpoint(client, "news", config.endpointPath ?? DEFAULT_ENDPOINT_PATHS.news!, config.lookbackDays ?? 3)
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
          retryAttempts: resolvePositiveInt(raw.retryAttempts, DEFAULT_RETRY_ATTEMPTS[kind]),
          retryDelayMs: resolvePositiveInt(raw.retryDelayMs, DEFAULT_RETRY_DELAY_MS[kind]),
          freshnessSloMinutes: resolvePositiveInt(raw.freshnessSloMinutes, DEFAULT_FRESHNESS_SLO_MINUTES[kind]),
          symbols: resolveStringArray(raw.symbols).length > 0 ? resolveStringArray(raw.symbols) : coverageSymbols,
          endpointPath:
            typeof raw.endpointPath === "string" && raw.endpointPath.trim().length > 0
              ? raw.endpointPath
              : DEFAULT_ENDPOINT_PATHS[kind],
          quarters: typeof raw.quarters === "number" ? resolvePositiveInt(raw.quarters, 8) : undefined,
          lookbackDays: typeof raw.lookbackDays === "number" ? resolvePositiveInt(raw.lookbackDays, 7) : undefined,
          backfillMaxLookbackDays:
            typeof raw.backfillMaxLookbackDays === "number"
              ? resolvePositiveOptionalInt(raw.backfillMaxLookbackDays)
              : DEFAULT_BACKFILL_LOOKBACK_DAYS[kind],
          backfillMaxQuarters:
            typeof raw.backfillMaxQuarters === "number"
              ? resolvePositiveOptionalInt(raw.backfillMaxQuarters)
              : DEFAULT_BACKFILL_QUARTERS[kind],
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
  entityStateFile?: string
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
    const normalized = summary.entities?.length
      ? await upsertInvestingEntities({
          entities: summary.entities,
          stateFile: input.entityStateFile,
        })
      : undefined
    const finishedAt = Date.now()
    const record: InvestingConnectorRunRecord = {
      connector: input.connector,
      enabled: input.config.enabled,
      scheduleMinutes: input.config.scheduleMinutes,
      retryAttempts: input.config.retryAttempts,
      freshnessSloMinutes: input.config.freshnessSloMinutes,
      coverageSymbols: input.config.symbols,
      endpointPath: input.config.endpointPath,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastDurationMs: finishedAt - startedAt,
      lastStatus: "ok",
      freshnessStatus: computeFreshnessStatus({
        enabled: input.config.enabled,
        lastFinishedAt: finishedAt,
        lastStatus: "ok",
        freshnessSloMinutes: input.config.freshnessSloMinutes,
        now: finishedAt,
      }),
      itemCount: summary.itemCount,
      requestCount: summary.requestCount,
      normalizedEntityCount: normalized?.batchCount ?? 0,
      normalizedKinds: normalized?.batchKinds ?? [],
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
        normalizedEntityCount: record.normalizedEntityCount,
        normalizedKinds: record.normalizedKinds,
        freshnessStatus: record.freshnessStatus,
        freshnessSloMinutes: record.freshnessSloMinutes,
        retryAttempts: record.retryAttempts,
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
      retryAttempts: input.config.retryAttempts,
      freshnessSloMinutes: input.config.freshnessSloMinutes,
      coverageSymbols: input.config.symbols,
      endpointPath: input.config.endpointPath,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastDurationMs: finishedAt - startedAt,
      lastStatus: "error",
      freshnessStatus: computeFreshnessStatus({
        enabled: input.config.enabled,
        lastFinishedAt: finishedAt,
        lastStatus: "error",
        freshnessSloMinutes: input.config.freshnessSloMinutes,
        now: finishedAt,
      }),
      itemCount: 0,
      requestCount: 0,
      normalizedEntityCount: 0,
      normalizedKinds: [],
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
        retryAttempts: record.retryAttempts,
        freshnessStatus: record.freshnessStatus,
        freshnessSloMinutes: record.freshnessSloMinutes,
        scheduleMinutes: record.scheduleMinutes,
        coverageSymbols: record.coverageSymbols,
        endpointPath: record.endpointPath,
      },
    })
    throw error
  }
}

export async function executeInvestingConnectorRunWithRetry(input: {
  connector: InvestingConnectorKind
  config: InvestingConnectorConfig
  client: InvestingClient
  executor?: InvestingConnectorExecutor
  stateFile?: string
  entityStateFile?: string
  now?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<InvestingConnectorRunRecord> {
  const sleep = input.sleep ?? (async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)))
  let attempt = 0

  while (true) {
    try {
      return await executeInvestingConnectorRun({
        connector: input.connector,
        config: input.config,
        client: input.client,
        executor: input.executor,
        stateFile: input.stateFile,
        entityStateFile: input.entityStateFile,
        now: attempt === 0 ? input.now : undefined,
      })
    } catch (error) {
      attempt += 1
      if (attempt >= input.config.retryAttempts || !isRetryableConnectorError(error)) {
        throw error
      }

      const delayMs = input.config.retryDelayMs * attempt
      FluxRecorder.record({
        traceID: crypto.randomUUID(),
        direction: "internal",
        domain: "investing",
        kind: "investing.ingestion.retry",
        status: "ok",
        method: "scheduler",
        path: input.connector,
        route: input.connector,
        metadata: {
          connector: input.connector,
          attempt,
          retryAttempts: input.config.retryAttempts,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      await sleep(delayMs)
    }
  }
}

export async function runInvestingConnector(
  connector: InvestingConnectorKind,
  options: {
    config?: unknown
    stateFile?: string
    entityStateFile?: string
  } = {},
): Promise<InvestingConnectorRunRecord> {
  const rawConfig = options.config ?? (await Config.get())
  const resolved = resolveInvestingIngestionConfig(rawConfig)
  const connectorConfig = resolved.connectors[connector]
  const client = await createInvestingClient(rawConfig)
  try {
    return await executeInvestingConnectorRunWithRetry({
      connector,
      config: connectorConfig,
      client,
      stateFile: options.stateFile,
      entityStateFile: options.entityStateFile,
    })
  } finally {
    await client.disconnect().catch(() => {})
  }
}

export async function runEnabledInvestingConnectors(options: {
  config?: unknown
  stateFile?: string
  entityStateFile?: string
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
        await executeInvestingConnectorRunWithRetry({
          connector,
          config: resolved.connectors[connector],
          client,
          stateFile: options.stateFile,
          entityStateFile: options.entityStateFile,
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
  now?: number
} = {}): Promise<InvestingIngestionStatus> {
  const rawConfig = options.config ?? (await Config.get())
  const resolved = resolveInvestingIngestionConfig(rawConfig)
  const state = await readState(options.stateFile)
  const now = options.now ?? Date.now()
  return {
    enabled: resolved.enabled,
    connectors: INVESTING_CONNECTOR_KINDS.map((connector) => {
      const current = state.connectors[connector]
      const fallback: InvestingConnectorRunRecord = {
        connector,
        enabled: resolved.connectors[connector].enabled,
        scheduleMinutes: resolved.connectors[connector].scheduleMinutes,
        retryAttempts: resolved.connectors[connector].retryAttempts,
        freshnessSloMinutes: resolved.connectors[connector].freshnessSloMinutes,
        coverageSymbols: resolved.connectors[connector].symbols,
        endpointPath: resolved.connectors[connector].endpointPath,
        lastStartedAt: 0,
        lastFinishedAt: 0,
        lastDurationMs: 0,
        lastStatus: "ok",
        freshnessStatus: computeFreshnessStatus({
          enabled: resolved.connectors[connector].enabled,
          lastFinishedAt: 0,
          lastStatus: "ok",
          freshnessSloMinutes: resolved.connectors[connector].freshnessSloMinutes,
          now,
        }),
        itemCount: 0,
        requestCount: 0,
        normalizedEntityCount: 0,
        normalizedKinds: [],
        details: [],
      }
      const base = current ?? fallback
      return {
        ...base,
        enabled: resolved.connectors[connector].enabled,
        scheduleMinutes: resolved.connectors[connector].scheduleMinutes,
        retryAttempts: resolved.connectors[connector].retryAttempts,
        freshnessSloMinutes: resolved.connectors[connector].freshnessSloMinutes,
        coverageSymbols: resolved.connectors[connector].symbols,
        endpointPath: resolved.connectors[connector].endpointPath,
        freshnessStatus: computeFreshnessStatus({
          enabled: resolved.connectors[connector].enabled,
          lastFinishedAt: base.lastFinishedAt,
          lastStatus: base.lastStatus,
          freshnessSloMinutes: resolved.connectors[connector].freshnessSloMinutes,
          now,
        }),
        scheduledTaskId: scheduleTaskId(connector),
      }
    }),
  }
}

export async function recordInvestingIngestionFreshness(options: {
  config?: unknown
  stateFile?: string
  now?: number
} = {}): Promise<InvestingIngestionStatus> {
  const status = await getInvestingIngestionStatus(options)
  const now = options.now ?? Date.now()

  for (const connector of status.connectors) {
    const maxAgeMs = connector.freshnessSloMinutes * 60 * 1000
    const latenessMs =
      connector.lastFinishedAt > 0 ? Math.max(0, now - connector.lastFinishedAt - maxAgeMs) : maxAgeMs
    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.ingestion.freshness",
      status: connector.freshnessStatus === "fresh" || connector.freshnessStatus === "disabled" ? "ok" : "error",
      method: "monitor",
      path: connector.connector,
      route: connector.scheduledTaskId,
      metadata: {
        connector: connector.connector,
        enabled: connector.enabled,
        freshnessStatus: connector.freshnessStatus,
        freshnessSloMinutes: connector.freshnessSloMinutes,
        latenessMs,
        lastFinishedAt: connector.lastFinishedAt,
        lastStatus: connector.lastStatus,
      },
    })
  }

  return status
}

async function runBackfillWithConnectorConfig(input: {
  connector: InvestingConnectorKind
  connectorConfig: InvestingConnectorConfig
  rawConfig: unknown
  stateFile?: string
  entityStateFile?: string
}): Promise<InvestingConnectorRunRecord> {
  const client = await createInvestingClient(input.rawConfig)
  try {
    return await executeInvestingConnectorRunWithRetry({
      connector: input.connector,
      config: input.connectorConfig,
      client,
      stateFile: input.stateFile,
      entityStateFile: input.entityStateFile,
    })
  } finally {
    await client.disconnect().catch(() => {})
  }
}

function resolveBackfillConnectorConfig(input: {
  connector: InvestingConnectorKind
  config: InvestingConnectorConfig
  symbols?: string[]
  lookbackDays?: number
  quarters?: number
}): InvestingConnectorConfig {
  const next: InvestingConnectorConfig = {
    ...input.config,
    symbols: input.symbols?.length ? input.symbols : input.config.symbols,
  }

  if (input.lookbackDays !== undefined) {
    if (!["transcripts", "news"].includes(input.connector)) {
      throw new Error(`${input.connector} backfill does not support lookbackDays overrides`)
    }
    const maxLookback = input.config.backfillMaxLookbackDays
    if (maxLookback && input.lookbackDays > maxLookback) {
      throw new Error(`${input.connector} backfill lookbackDays exceeds configured max of ${maxLookback}`)
    }
    next.lookbackDays = input.lookbackDays
  }

  if (input.quarters !== undefined) {
    if (input.connector !== "earnings") {
      throw new Error(`${input.connector} backfill does not support quarters overrides`)
    }
    const maxQuarters = input.config.backfillMaxQuarters
    if (maxQuarters && input.quarters > maxQuarters) {
      throw new Error(`${input.connector} backfill quarters exceeds configured max of ${maxQuarters}`)
    }
    next.quarters = input.quarters
  }

  return next
}

export async function runInvestingConnectorBackfill(input: {
  connector: InvestingConnectorKind
  config?: unknown
  stateFile?: string
  entityStateFile?: string
  operationsFile?: string
  symbols?: string[]
  lookbackDays?: number
  quarters?: number
  now?: number
  runConnector?: (input: { connector: InvestingConnectorKind; config: InvestingConnectorConfig }) => Promise<InvestingConnectorRunRecord>
}): Promise<InvestingBackfillOperationRecord> {
  const rawConfig = input.config ?? (await Config.get())
  const resolved = resolveInvestingIngestionConfig(rawConfig)
  const connectorConfig = resolveBackfillConnectorConfig({
    connector: input.connector,
    config: resolved.connectors[input.connector],
    symbols: input.symbols,
    lookbackDays: input.lookbackDays,
    quarters: input.quarters,
  })
  const operations = await readBackfillOperations(input.operationsFile)
  const startedAt = input.now ?? Date.now()
  const record: InvestingBackfillOperationRecord = {
    id: `investing-backfill:${input.connector}:${startedAt}`,
    connector: input.connector,
    requestedAt: startedAt,
    startedAt,
    finishedAt: 0,
    status: "ok",
    symbols: connectorConfig.symbols,
    lookbackDays: connectorConfig.lookbackDays,
    quarters: connectorConfig.quarters,
    itemCount: 0,
    normalizedEntityCount: 0,
    retryAttempts: connectorConfig.retryAttempts,
  }

  operations.unshift(record)
  await writeBackfillOperations(operations.slice(0, 50), input.operationsFile)

  try {
    const result = input.runConnector
      ? await input.runConnector({
          connector: input.connector,
          config: connectorConfig,
        })
      : await runBackfillWithConnectorConfig({
          connector: input.connector,
          connectorConfig,
          rawConfig,
          stateFile: input.stateFile,
          entityStateFile: input.entityStateFile,
        })

    record.finishedAt = Date.now()
    record.status = result.lastStatus
    record.itemCount = result.itemCount
    record.normalizedEntityCount = result.normalizedEntityCount
    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.ingestion.backfill",
      status: "ok",
      method: "backfill",
      path: input.connector,
      route: record.id,
      latencyMs: record.finishedAt - record.startedAt,
      metadata: {
        connector: input.connector,
        symbols: record.symbols,
        lookbackDays: record.lookbackDays,
        quarters: record.quarters,
        itemCount: record.itemCount,
        normalizedEntityCount: record.normalizedEntityCount,
      },
    })
  } catch (error) {
    record.finishedAt = Date.now()
    record.status = "error"
    record.error = error instanceof Error ? error.message : String(error)
    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.ingestion.backfill",
      status: "error",
      method: "backfill",
      path: input.connector,
      route: record.id,
      latencyMs: record.finishedAt - record.startedAt,
      error: {
        message: record.error,
      },
      metadata: {
        connector: input.connector,
        symbols: record.symbols,
        lookbackDays: record.lookbackDays,
        quarters: record.quarters,
      },
    })
    throw error
  } finally {
    const nextOperations = await readBackfillOperations(input.operationsFile)
    const updatedOperations = nextOperations.map((operation) => (operation.id === record.id ? record : operation))
    await writeBackfillOperations(updatedOperations.slice(0, 50), input.operationsFile)
  }

  return record
}

export function registerInvestingIngestionSchedules(input: {
  config: InvestingIngestionConfig
  directory?: string
  rawConfig?: unknown
  stateFile?: string
  entityStateFile?: string
  register?: RegisterTask
  runConnector?: (connector: InvestingConnectorKind) => Promise<unknown>
}): Array<{ connector: InvestingConnectorKind; taskId: string; scheduleMinutes: number }> {
  if (!input.config.enabled) return []
  const register = input.register ?? Scheduler.register
  const withDirectory = async <T>(fn: () => Promise<T>) => {
    if (input.directory) {
      return await Instance.provide({
        directory: input.directory,
        fn,
      })
    }
    return await fn()
  }
  const runConnector =
    input.runConnector ??
    (async (connector: InvestingConnectorKind) => {
      const run = async () =>
        await runInvestingConnector(connector, {
          config: input.rawConfig,
          stateFile: input.stateFile,
          entityStateFile: input.entityStateFile,
        })
      return await withDirectory(run)
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

  const enabledConnectors = registrations.length > 0 ? registrations : []
  if (enabledConnectors.length > 0) {
    const monitorMinutes = Math.max(
      5,
      Math.min(
        ...enabledConnectors.map(({ connector }) =>
          Math.max(5, Math.floor(input.config.connectors[connector].freshnessSloMinutes / 2)),
        ),
      ),
    )
    register({
      id: "investing.ingestion.freshness.monitor",
      interval: monitorMinutes * 60 * 1000,
      scope: "global",
      run: async () => {
        try {
          await withDirectory(async () =>
            await recordInvestingIngestionFreshness({
              config: input.rawConfig ?? { investing: { ingestion: input.config } },
              stateFile: input.stateFile,
            }),
          )
        } catch (error) {
          log.warn("freshness monitor failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
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
