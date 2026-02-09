import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { LLM } from "@/session/llm"
import { Provider } from "./provider"
import { CircuitBreaker } from "./circuit-breaker"
import { FallbackChain } from "./fallback-chain"
import { ModelEquivalence } from "./equivalence"
import z from "zod"
import type { StreamTextResult, ToolSet, TextStreamPart } from "ai"

/**
 * Fallback Orchestrator - Main entry point for LLM streaming with automatic fallback.
 *
 * Wraps LLM.stream() to provide:
 * - Circuit breaker protection for unhealthy providers
 * - Automatic fallback to equivalent models on failure
 * - Configurable fallback rules based on error types
 * - Event emission for UI notifications
 */
export namespace Fallback {
  const log = Log.create({ service: "fallback" })

  // Events
  export const Event = {
    FallbackUsed: BusEvent.define(
      "fallback.used",
      z.object({
        sessionID: z.string(),
        originalProvider: z.string(),
        originalModel: z.string(),
        fallbackProvider: z.string(),
        fallbackModel: z.string(),
        reason: z.string(),
        attempt: z.number(),
      }),
    ),
    AllFallbacksExhausted: BusEvent.define(
      "fallback.exhausted",
      z.object({
        sessionID: z.string(),
        originalProvider: z.string(),
        originalModel: z.string(),
        attempted: z.array(z.string()),
        lastError: z.string(),
      }),
    ),
  }

  /**
   * Extended stream input with fallback configuration.
   */
  export type StreamInput = LLM.StreamInput & {
    /** Override default fallback config */
    fallbackConfig?: Partial<FallbackChain.Config>
    /** Skip fallback for this request */
    skipFallback?: boolean
  }

  /**
   * Context passed through stream wrapper for mid-stream fallback retry.
   */
  type StreamContext = {
    input: StreamInput
    config: FallbackChain.Config
    attempted: string[]
    currentModel: Provider.Model
    originalModel: Provider.Model
    sessionID: string
  }

  /**
   * Wrap fullStream to catch mid-stream errors and trigger fallback.
   * This handles cases where the provider returns a stream successfully
   * but errors during iteration (e.g., insufficient_quota mid-stream).
   *
   * Returns the original stream's fullStream but with error handling wrapped
   * around the async iteration. We preserve the original type by creating
   * a proxy that intercepts Symbol.asyncIterator.
   */
  function wrapFullStream<T extends ToolSet>(
    stream: StreamTextResult<T, any>,
    context: StreamContext,
  ): typeof stream.fullStream {
    const originalFullStream = stream.fullStream

    // Create an async generator that wraps the original with error handling
    async function* wrappedIterator(): AsyncGenerator<TextStreamPart<T>> {
      try {
        for await (const value of originalFullStream) {
          yield value
        }
      } catch (error) {
        log.warn("mid-stream error detected", {
          provider: context.currentModel.providerID,
          model: context.currentModel.id,
          error: (error as Error).message,
        })

        // Try to recover with fallback
        const fallbackStream = await tryMidStreamFallback(error as Error, context)
        if (!fallbackStream) {
          throw error // No fallback available, re-throw
        }

        // Continue yielding from fallback stream
        for await (const value of fallbackStream.fullStream) {
          yield value as TextStreamPart<T>
        }
      }
    }

    // Return a proxy that intercepts async iteration but preserves ReadableStream methods
    return new Proxy(originalFullStream, {
      get(target, prop) {
        if (prop === Symbol.asyncIterator) {
          return () => wrappedIterator()
        }
        // Forward all other properties/methods to the original stream
        const value = Reflect.get(target, prop)
        if (typeof value === "function") {
          return value.bind(target)
        }
        return value
      },
    })
  }

  /**
   * Attempt to recover from a mid-stream error by switching to a fallback provider.
   */
  async function tryMidStreamFallback(error: Error, context: StreamContext): Promise<LLM.StreamOutput | undefined> {
    // Record failure for circuit breaker
    await CircuitBreaker.recordFailure(context.currentModel.providerID, error)

    const modelKey = `${context.currentModel.providerID}/${context.currentModel.id}`

    // Find fallback model
    const fallbackModel = await FallbackChain.resolve(modelKey, error, context.attempted, context.config)

    if (!fallbackModel) {
      log.error("no fallback available for mid-stream error", {
        originalModel: `${context.originalModel.providerID}/${context.originalModel.id}`,
        attempted: context.attempted,
        error: error.message,
      })
      return undefined
    }

    // Switch to fallback model
    const { providerID, modelID } = ModelEquivalence.parseModel(fallbackModel)
    let newModel: Provider.Model
    try {
      newModel = await Provider.getModel(providerID, modelID)
    } catch (e) {
      log.error("failed to get fallback model for mid-stream recovery", { fallbackModel, error: e })
      return undefined
    }

    log.info("mid-stream fallback activated", {
      from: modelKey,
      to: fallbackModel,
      reason: error.message,
    })

    // Update context for potential nested fallbacks
    context.attempted.push(fallbackModel)
    context.currentModel = newModel

    // Emit fallback event
    if (context.config.notifyOnFallback) {
      Bus.publish(Event.FallbackUsed, {
        sessionID: context.sessionID,
        originalProvider: context.originalModel.providerID,
        originalModel: context.originalModel.id,
        fallbackProvider: newModel.providerID,
        fallbackModel: newModel.id,
        reason: `mid-stream: ${error.message}`,
        attempt: context.attempted.length,
      })
    }

    // Get new stream from fallback provider
    try {
      const newStream = await LLM.stream({
        ...context.input,
        model: newModel,
      })

      // Recursively wrap the new stream for nested fallbacks
      // We spread first then override fullStream to get proper typing
      const wrappedStream = Object.assign({}, newStream, {
        fullStream: wrapFullStream(newStream, context),
      })
      return wrappedStream
    } catch (e) {
      log.error("fallback stream creation failed", { fallbackModel, error: e })
      // Try another fallback recursively
      return tryMidStreamFallback(e as Error, context)
    }
  }

  /**
   * Stream with automatic fallback support.
   *
   * This is the main entry point - use this instead of LLM.stream() directly.
   */
  export async function stream(input: StreamInput): Promise<LLM.StreamOutput> {
    // Get fallback configuration
    const cfg = await Config.get()
    const fallbackConfig = FallbackChain.mergeConfig({
      ...cfg.fallback,
      ...input.fallbackConfig,
    })

    // Skip fallback if disabled or explicitly requested
    if (!fallbackConfig.enabled || input.skipFallback) {
      log.info("fallback disabled, using direct stream", {
        enabled: fallbackConfig.enabled,
        skipFallback: input.skipFallback,
      })
      return LLM.stream(input)
    }

    // Configure circuit breaker from config
    if (cfg.fallback?.circuitBreaker) {
      CircuitBreaker.configure(cfg.fallback.circuitBreaker)
    }

    const originalModel = `${input.model.providerID}/${input.model.id}`
    const attempted: string[] = []
    let currentModel = input.model
    let lastError: Error | undefined

    for (let attempt = 0; attempt < fallbackConfig.maxAttempts; attempt++) {
      const modelKey = `${currentModel.providerID}/${currentModel.id}`

      log.info("attempting stream", {
        attempt,
        provider: currentModel.providerID,
        model: currentModel.id,
        originalModel,
      })

      // Check circuit breaker before attempting
      if (!(await CircuitBreaker.canUse(currentModel.providerID))) {
        log.warn("circuit breaker open", { provider: currentModel.providerID })

        const fallbackModel = await FallbackChain.resolve(
          modelKey,
          new Error("circuit_open"),
          attempted,
          fallbackConfig,
        )

        if (fallbackModel) {
          const { providerID, modelID } = ModelEquivalence.parseModel(fallbackModel)
          try {
            currentModel = await Provider.getModel(providerID, modelID)
            continue
          } catch (e) {
            log.error("failed to get fallback model", { fallbackModel, error: e })
          }
        }

        // No fallback available for circuit-open provider
        throw new Error(`Provider ${currentModel.providerID} is unavailable (circuit breaker open)`)
      }

      // Track half-open requests
      const state = await CircuitBreaker.getState(currentModel.providerID)
      if (state.state === "half_open") {
        await CircuitBreaker.startHalfOpenRequest(currentModel.providerID)
      }

      attempted.push(modelKey)

      try {
        // Attempt the stream
        const result = await LLM.stream({
          ...input,
          model: currentModel,
        })

        // Don't record success immediately - the stream might still error during iteration
        // The circuit breaker will learn from failures; success is the default state
        // We only emit fallback notification here since we got a stream back
        if (attempt > 0 && fallbackConfig.notifyOnFallback) {
          Bus.publish(Event.FallbackUsed, {
            sessionID: input.sessionID,
            originalProvider: input.model.providerID,
            originalModel: input.model.id,
            fallbackProvider: currentModel.providerID,
            fallbackModel: currentModel.id,
            reason: lastError?.message ?? "unknown",
            attempt,
          })
        }

        // Wrap the stream to catch mid-stream errors and trigger fallback
        const streamContext: StreamContext = {
          input,
          config: fallbackConfig,
          attempted: [...attempted], // Copy to avoid mutation issues
          currentModel,
          originalModel: input.model,
          sessionID: input.sessionID,
        }

        // Use Object.assign to maintain proper typing
        const wrappedStream = Object.assign({}, result, {
          fullStream: wrapFullStream(result, streamContext),
        })
        return wrappedStream
      } catch (error) {
        lastError = error as Error
        await CircuitBreaker.recordFailure(currentModel.providerID, lastError)

        log.warn("stream failed", {
          attempt,
          provider: currentModel.providerID,
          model: currentModel.id,
          error: lastError.message,
        })

        // Find fallback
        const fallbackModel = await FallbackChain.resolve(modelKey, lastError, attempted, fallbackConfig)

        if (!fallbackModel) {
          log.error("no fallback available", {
            originalModel,
            attempted,
            error: lastError.message,
          })
          break
        }

        // Switch to fallback model
        const { providerID, modelID } = ModelEquivalence.parseModel(fallbackModel)
        try {
          currentModel = await Provider.getModel(providerID, modelID)
          log.info("switching to fallback", {
            from: modelKey,
            to: fallbackModel,
          })
        } catch (e) {
          log.error("failed to get fallback model", { fallbackModel, error: e })
          break
        }
      }
    }

    // All fallbacks exhausted
    Bus.publish(Event.AllFallbacksExhausted, {
      sessionID: input.sessionID,
      originalProvider: input.model.providerID,
      originalModel: input.model.id,
      attempted,
      lastError: lastError?.message ?? "unknown",
    })

    throw lastError ?? new Error("All fallbacks exhausted")
  }

  /**
   * Check if fallback is available for the current configuration.
   */
  export async function isEnabled(): Promise<boolean> {
    const cfg = await Config.get()
    return cfg.fallback?.enabled ?? FallbackChain.DEFAULT_CONFIG.enabled
  }

  /**
   * Get the current fallback configuration.
   */
  export async function getConfig(): Promise<FallbackChain.Config> {
    const cfg = await Config.get()
    return FallbackChain.mergeConfig(cfg.fallback)
  }

  /**
   * Get circuit breaker states for all providers.
   */
  export async function getCircuitBreakerStates(): Promise<Record<string, CircuitBreaker.ProviderState>> {
    return CircuitBreaker.getAllStates()
  }

  /**
   * Reset circuit breaker for a specific provider.
   */
  export async function resetCircuitBreaker(providerID: string): Promise<void> {
    await CircuitBreaker.reset(providerID)
  }

  /**
   * Reset all circuit breakers.
   */
  export async function resetAllCircuitBreakers(): Promise<void> {
    await CircuitBreaker.resetAll()
  }
}
