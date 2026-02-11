/**
 * Usage tracking module for agent-core.
 *
 * Captures API usage at the source for:
 * - Cost tracking
 * - Token analytics
 * - Performance monitoring
 * - Budget management
 *
 * @example
 * ```typescript
 * import { Usage } from "./usage"
 *
 * // Initialize in daemon startup
 * await Usage.init()
 *
 * // Record usage from LLM response
 * await Usage.recordFromResponse({
 *   sessionId: session.id,
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-5-20250929",
 *   usage: { promptTokens: 1000, completionTokens: 500 },
 *   durationMs: 2500,
 *   streaming: true,
 * })
 *
 * // Query usage
 * const stats = Storage.getStats()
 * const summary = Storage.getSummary({ period: "day" })
 * ```
 */

// Types
export type {
  UsageEvent,
  UsageEventInput,
  TokenUsage,
  ModelPricing,
  CostBreakdown,
  UsagePeriod,
  UsageSummary,
  ProviderUsage,
  ModelUsage,
  SessionUsage,
  UsageStats,
  UsageEventQuery,
  UsageSummaryQuery,
} from "./types"

// Tracker (main API)
export {
  init,
  shutdown,
  record,
  recordFromResponse,
  isInitialized,
  UsageRecorded,
} from "./tracker"

// Storage (direct queries)
export * as Storage from "./storage"

// Pricing utilities
export { getModelPricing, computeCost, formatCost, formatTokens } from "./pricing"

// Hono routes
export { UsageRoute } from "./route"
