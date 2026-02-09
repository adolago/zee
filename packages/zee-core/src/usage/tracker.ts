/**
 * Usage tracker singleton.
 * Records API usage events at the source.
 */

import { Log } from "../util/log"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import * as Storage from "./storage"
import { getModelPricing, computeCost } from "./pricing"
import type { UsageEvent, UsageEventInput, TokenUsage } from "./types"
import z from "zod"

const log = Log.create({ service: "usage-tracker" })

let initialized = false

// Event for usage tracking
export const UsageRecorded = BusEvent.define(
  "usage.recorded",
  z.object({
    event: z.custom<UsageEvent>(),
  }),
)

/**
 * Initialize the usage tracker.
 */
export async function init(): Promise<void> {
  if (initialized) return

  await Storage.init()
  initialized = true

  log.info("Usage tracker initialized")
}

/**
 * Shutdown the usage tracker.
 */
export async function shutdown(): Promise<void> {
  if (!initialized) return

  await Storage.close()
  initialized = false

  log.info("Usage tracker shutdown")
}

/**
 * Record a usage event.
 * This is the main entry point called from the LLM layer.
 */
export async function record(input: UsageEventInput): Promise<UsageEvent> {
  if (!initialized) {
    log.warn("Usage tracker not initialized, skipping record")
    // Return a minimal event for the caller
    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...input,
      totalCost: input.inputCost + input.outputCost + (input.cacheCost ?? 0),
    }
  }

  const event: UsageEvent = {
    id: crypto.randomUUID(),
    timestamp: input.timestamp ?? Date.now(),
    sessionId: input.sessionId,
    messageId: input.messageId,
    providerId: input.providerId,
    modelId: input.modelId,
    modelName: input.modelName,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    reasoningTokens: input.reasoningTokens,
    inputCost: input.inputCost,
    outputCost: input.outputCost,
    cacheCost: input.cacheCost,
    totalCost: input.inputCost + input.outputCost + (input.cacheCost ?? 0),
    durationMs: input.durationMs,
    streaming: input.streaming,
    toolCalls: input.toolCalls,
    error: input.error,
    retryCount: input.retryCount,
  }

  try {
    Storage.insertEvent(event)

    log.debug("Usage recorded", {
      provider: event.providerId,
      model: event.modelId,
      tokens: event.inputTokens + event.outputTokens,
      cost: event.totalCost,
    })

    // Emit event for subscribers (e.g., TUI dashboard)
    Bus.publish(UsageRecorded, { event })
  } catch (e) {
    log.error("Failed to record usage", { error: String(e) })
  }

  return event
}

/**
 * Record usage from AI SDK response.
 * Convenience method that handles token extraction and cost computation.
 */
export async function recordFromResponse(params: {
  sessionId: string
  messageId?: string
  providerId: string
  modelId: string
  modelName?: string
  usage: TokenUsage
  durationMs: number
  streaming: boolean
  toolCalls?: number
  error?: string
}): Promise<UsageEvent> {
  // Get pricing for the model
  const pricing = await getModelPricing(params.providerId, params.modelId)
  const cost = computeCost(params.usage, pricing)

  return record({
    sessionId: params.sessionId,
    messageId: params.messageId,
    providerId: params.providerId,
    modelId: params.modelId,
    modelName: params.modelName,
    inputTokens: params.usage.promptTokens,
    outputTokens: params.usage.completionTokens,
    cacheReadTokens: params.usage.cacheReadTokens,
    cacheWriteTokens: params.usage.cacheWriteTokens,
    reasoningTokens: params.usage.reasoningTokens,
    inputCost: cost.inputCost,
    outputCost: cost.outputCost,
    cacheCost: cost.cacheCost,
    durationMs: params.durationMs,
    streaming: params.streaming,
    toolCalls: params.toolCalls,
    error: params.error,
  })
}

/**
 * Check if the tracker is initialized.
 */
export function isInitialized(): boolean {
  return initialized
}
