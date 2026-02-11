/**
 * Usage storage using Bun's built-in SQLite.
 * Provides efficient querying for usage analytics.
 */

import { Database } from "bun:sqlite"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import type {
  UsageEvent,
  UsageEventInput,
  UsageEventQuery,
  UsagePeriod,
  UsageSummary,
  ProviderUsage,
  ModelUsage,
  SessionUsage,
  UsageStats,
  UsageSummaryQuery,
} from "./types"

const log = Log.create({ service: "usage-storage" })

const USAGE_DIR = path.join(Global.Path.state, "usage")
const DB_PATH = path.join(USAGE_DIR, "usage.db")

let db: Database | null = null

/**
 * Initialize the usage database.
 */
export async function init(): Promise<void> {
  await fs.mkdir(USAGE_DIR, { recursive: true })

  db = new Database(DB_PATH, { create: true })

  // Enable WAL mode for better concurrent performance
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      message_id TEXT,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_name TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      reasoning_tokens INTEGER,
      input_cost REAL NOT NULL,
      output_cost REAL NOT NULL,
      cache_cost REAL,
      total_cost REAL NOT NULL,
      duration_ms INTEGER,
      streaming INTEGER,
      tool_calls INTEGER,
      error TEXT,
      retry_count INTEGER
    )
  `)

  // Create indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_events(timestamp)")
  db.run("CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_events(provider_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_events(model_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_events(timestamp / 86400000)") // Day index

  log.info("Usage storage initialized", { path: DB_PATH })
}

/**
 * Close the database connection.
 */
export async function close(): Promise<void> {
  if (db) {
    db.close()
    db = null
    log.info("Usage storage closed")
  }
}

/**
 * Get the database instance.
 */
function getDb(): Database {
  if (!db) {
    throw new Error("Usage storage not initialized. Call init() first.")
  }
  return db
}

/**
 * Insert a usage event.
 */
export function insertEvent(event: UsageEvent): void {
  const d = getDb()

  const stmt = d.prepare(`
    INSERT INTO usage_events (
      id, timestamp, session_id, message_id, provider_id, model_id, model_name,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      input_cost, output_cost, cache_cost, total_cost,
      duration_ms, streaming, tool_calls, error, retry_count
    ) VALUES (
      $id, $timestamp, $sessionId, $messageId, $providerId, $modelId, $modelName,
      $inputTokens, $outputTokens, $cacheReadTokens, $cacheWriteTokens, $reasoningTokens,
      $inputCost, $outputCost, $cacheCost, $totalCost,
      $durationMs, $streaming, $toolCalls, $error, $retryCount
    )
  `)

  stmt.run({
    $id: event.id,
    $timestamp: event.timestamp,
    $sessionId: event.sessionId,
    $messageId: event.messageId ?? null,
    $providerId: event.providerId,
    $modelId: event.modelId,
    $modelName: event.modelName ?? null,
    $inputTokens: event.inputTokens,
    $outputTokens: event.outputTokens,
    $cacheReadTokens: event.cacheReadTokens ?? null,
    $cacheWriteTokens: event.cacheWriteTokens ?? null,
    $reasoningTokens: event.reasoningTokens ?? null,
    $inputCost: event.inputCost,
    $outputCost: event.outputCost,
    $cacheCost: event.cacheCost ?? null,
    $totalCost: event.totalCost,
    $durationMs: event.durationMs,
    $streaming: event.streaming ? 1 : 0,
    $toolCalls: event.toolCalls ?? null,
    $error: event.error ?? null,
    $retryCount: event.retryCount ?? null,
  })
}

/**
 * Query usage events with filters.
 */
export function queryEvents(query: UsageEventQuery = {}): UsageEvent[] {
  const d = getDb()

  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (query.from) {
    conditions.push("timestamp >= $from")
    params.$from = query.from
  }
  if (query.to) {
    conditions.push("timestamp <= $to")
    params.$to = query.to
  }
  if (query.providerId) {
    conditions.push("provider_id = $providerId")
    params.$providerId = query.providerId
  }
  if (query.modelId) {
    conditions.push("model_id = $modelId")
    params.$modelId = query.modelId
  }
  if (query.sessionId) {
    conditions.push("session_id = $sessionId")
    params.$sessionId = query.sessionId
  }
  if (query.hasError !== undefined) {
    conditions.push(query.hasError ? "error IS NOT NULL" : "error IS NULL")
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = query.limit ?? 100
  const offset = query.offset ?? 0

  const stmt = d.prepare(`
    SELECT * FROM usage_events
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $limit OFFSET $offset
  `)

  const rows = stmt.all({ ...params, $limit: limit, $offset: offset }) as Array<Record<string, unknown>>

  return rows.map(rowToEvent)
}

/**
 * Get aggregated summary for a time period.
 */
export function getSummary(query: UsageSummaryQuery = {}): UsageSummary {
  const d = getDb()
  const { startTime, endTime } = getPeriodRange(query.period ?? "day", query.from, query.to)

  const conditions: string[] = ["timestamp >= $startTime AND timestamp <= $endTime"]
  // biome-ignore lint/suspicious/noExplicitAny: SQLite bindings accept dynamic params
  const params: Record<string, any> = { $startTime: startTime, $endTime: endTime }

  if (query.providerId) {
    conditions.push("provider_id = $providerId")
    params.$providerId = query.providerId
  }
  if (query.modelId) {
    conditions.push("model_id = $modelId")
    params.$modelId = query.modelId
  }
  if (query.sessionId) {
    conditions.push("session_id = $sessionId")
    params.$sessionId = query.sessionId
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`

  // Get totals
  const totals = d
    .prepare(
      `
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(total_cost), 0) as total_cost,
      COALESCE(AVG(duration_ms), 0) as avg_latency_ms,
      COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) as error_count,
      COALESCE(SUM(CASE WHEN cache_read_tokens > 0 THEN 1 ELSE 0 END), 0) as cache_hits
    FROM usage_events
    ${whereClause}
  `,
    )
    .get(params) as Record<string, number>

  // Get by provider
  const byProviderRows = d
    .prepare(
      `
    SELECT
      provider_id,
      COUNT(*) as requests,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(total_cost) as cost,
      GROUP_CONCAT(DISTINCT model_id) as models
    FROM usage_events
    ${whereClause}
    GROUP BY provider_id
  `,
    )
    .all(params) as Array<Record<string, unknown>>

  const byProvider: Record<string, ProviderUsage> = {}
  for (const row of byProviderRows) {
    byProvider[row.provider_id as string] = {
      providerId: row.provider_id as string,
      requests: row.requests as number,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cost: row.cost as number,
      models: ((row.models as string) || "").split(",").filter(Boolean),
    }
  }

  // Get by model
  const byModelRows = d
    .prepare(
      `
    SELECT
      model_id,
      model_name,
      provider_id,
      COUNT(*) as requests,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(total_cost) as cost,
      AVG(duration_ms) as avg_latency_ms
    FROM usage_events
    ${whereClause}
    GROUP BY model_id
  `,
    )
    .all(params) as Array<Record<string, unknown>>

  const byModel: Record<string, ModelUsage> = {}
  for (const row of byModelRows) {
    byModel[row.model_id as string] = {
      modelId: row.model_id as string,
      modelName: row.model_name as string | undefined,
      providerId: row.provider_id as string,
      requests: row.requests as number,
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cost: row.cost as number,
      avgLatencyMs: row.avg_latency_ms as number,
    }
  }

  const totalRequests = totals.total_requests || 0

  return {
    period: query.period ?? "day",
    startTime,
    endTime,
    totalRequests,
    totalInputTokens: totals.total_input_tokens || 0,
    totalOutputTokens: totals.total_output_tokens || 0,
    totalCost: totals.total_cost || 0,
    byProvider,
    byModel,
    avgLatencyMs: totals.avg_latency_ms || 0,
    errorCount: totals.error_count || 0,
    errorRate: totalRequests > 0 ? totals.error_count / totalRequests : 0,
    cacheHitRate: totalRequests > 0 ? totals.cache_hits / totalRequests : 0,
  }
}

/**
 * Get session usage summary.
 */
export function getSessionUsage(sessionId: string): SessionUsage | null {
  const d = getDb()

  const row = d
    .prepare(
      `
    SELECT
      session_id,
      COUNT(*) as requests,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(total_cost) as cost,
      MIN(timestamp) as first_request,
      MAX(timestamp) as last_request
    FROM usage_events
    WHERE session_id = $sessionId
    GROUP BY session_id
  `,
    )
    .get({ $sessionId: sessionId }) as Record<string, unknown> | undefined

  if (!row) return null

  return {
    sessionId: row.session_id as string,
    requests: row.requests as number,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    cost: row.cost as number,
    firstRequest: row.first_request as number,
    lastRequest: row.last_request as number,
  }
}

/**
 * Get quick stats for dashboard.
 */
export function getStats(): UsageStats {
  const d = getDb()

  const now = Date.now()
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const weekStart = now - 7 * 24 * 60 * 60 * 1000
  const monthStart = now - 30 * 24 * 60 * 60 * 1000

  // Today
  const today = d
    .prepare(
      `
    SELECT
      COUNT(*) as requests,
      COALESCE(SUM(total_cost), 0) as cost,
      COALESCE(SUM(input_tokens + output_tokens), 0) as tokens
    FROM usage_events
    WHERE timestamp >= $start
  `,
    )
    .get({ $start: todayStart }) as Record<string, number>

  // This week
  const week = d
    .prepare(
      `
    SELECT COUNT(*) as requests, COALESCE(SUM(total_cost), 0) as cost
    FROM usage_events WHERE timestamp >= $start
  `,
    )
    .get({ $start: weekStart }) as Record<string, number>

  // This month
  const month = d
    .prepare(
      `
    SELECT COUNT(*) as requests, COALESCE(SUM(total_cost), 0) as cost
    FROM usage_events WHERE timestamp >= $start
  `,
    )
    .get({ $start: monthStart }) as Record<string, number>

  // Top model (by cost this month)
  const topModel = d
    .prepare(
      `
    SELECT model_id, SUM(total_cost) as cost
    FROM usage_events
    WHERE timestamp >= $start
    GROUP BY model_id
    ORDER BY cost DESC
    LIMIT 1
  `,
    )
    .get({ $start: monthStart }) as Record<string, unknown> | undefined

  // Top provider (by cost this month)
  const topProvider = d
    .prepare(
      `
    SELECT provider_id, SUM(total_cost) as cost
    FROM usage_events
    WHERE timestamp >= $start
    GROUP BY provider_id
    ORDER BY cost DESC
    LIMIT 1
  `,
    )
    .get({ $start: monthStart }) as Record<string, unknown> | undefined

  // Last request
  const lastRequest = d
    .prepare(
      `
    SELECT MAX(timestamp) as timestamp FROM usage_events
  `,
    )
    .get() as Record<string, number | null>

  return {
    todayRequests: today.requests || 0,
    todayCost: today.cost || 0,
    todayTokens: today.tokens || 0,
    weekRequests: week.requests || 0,
    weekCost: week.cost || 0,
    monthRequests: month.requests || 0,
    monthCost: month.cost || 0,
    topModel: topModel ? { modelId: topModel.model_id as string, cost: topModel.cost as number } : undefined,
    topProvider: topProvider
      ? { providerId: topProvider.provider_id as string, cost: topProvider.cost as number }
      : undefined,
    lastRequestAt: lastRequest.timestamp ?? undefined,
  }
}

/**
 * Delete events older than a timestamp.
 */
export function purgeEvents(before: number): number {
  const d = getDb()
  const result = d.prepare("DELETE FROM usage_events WHERE timestamp < $before").run({ $before: before })
  log.info("Purged usage events", { before: new Date(before).toISOString(), deleted: result.changes })
  return result.changes
}

/**
 * Get total event count.
 */
export function getEventCount(): number {
  const d = getDb()
  const result = d.prepare("SELECT COUNT(*) as count FROM usage_events").get() as { count: number }
  return result.count
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function rowToEvent(row: Record<string, unknown>): UsageEvent {
  return {
    id: row.id as string,
    timestamp: row.timestamp as number,
    sessionId: row.session_id as string,
    messageId: row.message_id as string | undefined,
    providerId: row.provider_id as string,
    modelId: row.model_id as string,
    modelName: row.model_name as string | undefined,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    cacheReadTokens: row.cache_read_tokens as number | undefined,
    cacheWriteTokens: row.cache_write_tokens as number | undefined,
    reasoningTokens: row.reasoning_tokens as number | undefined,
    inputCost: row.input_cost as number,
    outputCost: row.output_cost as number,
    cacheCost: row.cache_cost as number | undefined,
    totalCost: row.total_cost as number,
    durationMs: row.duration_ms as number,
    streaming: Boolean(row.streaming),
    toolCalls: row.tool_calls as number | undefined,
    error: row.error as string | undefined,
    retryCount: row.retry_count as number | undefined,
  }
}

function getPeriodRange(
  period: UsagePeriod,
  from?: number,
  to?: number,
): { startTime: number; endTime: number } {
  const now = Date.now()
  const endTime = to ?? now

  if (from) {
    return { startTime: from, endTime }
  }

  switch (period) {
    case "hour":
      return { startTime: now - 60 * 60 * 1000, endTime }
    case "day":
      return { startTime: new Date().setHours(0, 0, 0, 0), endTime }
    case "week":
      return { startTime: now - 7 * 24 * 60 * 60 * 1000, endTime }
    case "month":
      return { startTime: now - 30 * 24 * 60 * 60 * 1000, endTime }
    case "all":
      return { startTime: 0, endTime }
  }
}
