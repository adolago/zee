/**
 * Usage tracking types for agent-core.
 * Captures API usage at the source for cost tracking and analytics.
 */

/**
 * Raw usage event recorded for each API call.
 */
export interface UsageEvent {
  id: string // UUID
  timestamp: number // Unix ms

  // Request context
  sessionId: string
  messageId?: string

  // Provider info
  providerId: string // "anthropic", "openai", "google"
  modelId: string // "claude-sonnet-4-5-20250929"
  modelName?: string // Human-readable name

  // Token counts
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number // For o1/o3/thinking models

  // Cost (in USD)
  inputCost: number
  outputCost: number
  cacheCost?: number
  totalCost: number

  // Request metadata
  durationMs: number
  streaming: boolean
  toolCalls?: number

  // Error tracking
  error?: string
  retryCount?: number
}

/**
 * Input for recording a new usage event.
 * ID and timestamp are auto-generated.
 */
export type UsageEventInput = Omit<UsageEvent, "id" | "timestamp" | "totalCost"> & {
  timestamp?: number
}

/**
 * Token usage from AI SDK response.
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * Model pricing data ($ per 1M tokens).
 */
export interface ModelPricing {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/**
 * Computed cost breakdown.
 */
export interface CostBreakdown {
  inputCost: number
  outputCost: number
  cacheCost: number
  totalCost: number
}

/**
 * Time period for aggregation.
 */
export type UsagePeriod = "hour" | "day" | "week" | "month" | "all"

/**
 * Aggregated usage summary.
 */
export interface UsageSummary {
  period: UsagePeriod
  startTime: number
  endTime: number

  // Totals
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number

  // Breakdowns
  byProvider: Record<string, ProviderUsage>
  byModel: Record<string, ModelUsage>

  // Performance
  avgLatencyMs: number
  errorCount: number
  errorRate: number
  cacheHitRate: number
}

/**
 * Provider-level usage summary.
 */
export interface ProviderUsage {
  providerId: string
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
  models: string[]
}

/**
 * Model-level usage summary.
 */
export interface ModelUsage {
  modelId: string
  modelName?: string
  providerId: string
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
  avgLatencyMs: number
}

/**
 * Session-level usage summary.
 */
export interface SessionUsage {
  sessionId: string
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
  firstRequest: number
  lastRequest: number
}

/**
 * Quick stats for dashboard display.
 */
export interface UsageStats {
  // Today
  todayRequests: number
  todayCost: number
  todayTokens: number

  // This week
  weekRequests: number
  weekCost: number

  // This month
  monthRequests: number
  monthCost: number

  // Top usage
  topModel?: { modelId: string; cost: number }
  topProvider?: { providerId: string; cost: number }

  // Recent
  lastRequestAt?: number
}

/**
 * Query options for fetching events.
 */
export interface UsageEventQuery {
  limit?: number
  offset?: number
  from?: number // timestamp
  to?: number // timestamp
  providerId?: string
  modelId?: string
  sessionId?: string
  hasError?: boolean
}

/**
 * Query options for summaries.
 */
export interface UsageSummaryQuery {
  period?: UsagePeriod
  from?: number
  to?: number
  providerId?: string
  modelId?: string
  sessionId?: string
}
