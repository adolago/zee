/**
 * Model pricing utilities.
 * Fetches pricing from models.dev and computes costs.
 */

import { ModelsDev } from "../provider/models"
import { Log } from "../util/log"
import type { TokenUsage, ModelPricing, CostBreakdown } from "./types"

const log = Log.create({ service: "usage-pricing" })

// In-memory cache for pricing data
let pricingCache: Map<string, ModelPricing> = new Map()
let lastRefresh = 0
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Get pricing for a model.
 * Returns null if pricing is not available.
 */
export async function getModelPricing(providerId: string, modelId: string): Promise<ModelPricing | null> {
  const cacheKey = `${providerId}/${modelId}`

  // Check cache
  if (pricingCache.has(cacheKey) && Date.now() - lastRefresh < CACHE_TTL) {
    return pricingCache.get(cacheKey) ?? null
  }

  // Refresh pricing data
  await refreshPricingCache()

  return pricingCache.get(cacheKey) ?? null
}

/**
 * Refresh the pricing cache from models.dev.
 */
async function refreshPricingCache(): Promise<void> {
  try {
    const providers = await ModelsDev.get()
    pricingCache = new Map()

    for (const [providerId, provider] of Object.entries(providers)) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        if (model.cost) {
          const cacheKey = `${providerId}/${modelId}`
          pricingCache.set(cacheKey, {
            input: model.cost.input,
            output: model.cost.output,
            cacheRead: model.cost.cache_read,
            cacheWrite: model.cost.cache_write,
          })
        }
      }
    }

    lastRefresh = Date.now()
    log.debug("Pricing cache refreshed", { models: pricingCache.size })
  } catch (e) {
    log.error("Failed to refresh pricing cache", { error: String(e) })
  }
}

/**
 * Compute cost breakdown from token usage and pricing.
 */
export function computeCost(tokens: TokenUsage, pricing: ModelPricing | null): CostBreakdown {
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, cacheCost: 0, totalCost: 0 }
  }

  // Pricing is per 1M tokens
  const inputCost = (tokens.promptTokens / 1_000_000) * pricing.input
  const outputCost = (tokens.completionTokens / 1_000_000) * pricing.output

  let cacheCost = 0
  if (tokens.cacheReadTokens && pricing.cacheRead) {
    cacheCost += (tokens.cacheReadTokens / 1_000_000) * pricing.cacheRead
  }
  if (tokens.cacheWriteTokens && pricing.cacheWrite) {
    cacheCost += (tokens.cacheWriteTokens / 1_000_000) * pricing.cacheWrite
  }

  const totalCost = inputCost + outputCost + cacheCost

  return {
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    cacheCost: roundCost(cacheCost),
    totalCost: roundCost(totalCost),
  }
}

/**
 * Round cost to 6 decimal places (micro-cents precision).
 */
function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000
}

/**
 * Format cost for display.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/**
 * Format token count for display.
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString()
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}
