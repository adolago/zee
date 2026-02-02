import { Log } from "@/util/log"
import { ModelEquivalence } from "./equivalence"
import type { NamedError } from "@agent-core/util/error"

/**
 * Fallback Chain - User-configurable fallback sequences.
 *
 * Determines which provider/model to try next when the current one fails,
 * based on the error type and configured rules.
 */
export namespace FallbackChain {
  const log = Log.create({ service: "fallback-chain" })

  /**
   * Error conditions that can trigger fallback.
   */
  export type ErrorCondition = "rate_limit" | "unavailable" | "timeout" | "error" | "circuit_open" | "any"

  /**
   * A fallback rule that maps an error condition to fallback options.
   */
  export type Rule = {
    /** Error condition that triggers this rule */
    condition: ErrorCondition
    /** Fallback options - can be "providerID/modelID" or just "providerID" (use equivalent tier) */
    fallbacks: string[]
  }

  /**
   * Configuration for the fallback chain.
   */
  export type Config = {
    /** Whether fallback is enabled */
    enabled: boolean
    /** Maximum total attempts including the original (default: 3) */
    maxAttempts: number
    /** Fallback rules in priority order */
    rules: Rule[]
    /** Skip fallbacks that cost more than the original model (default: false) */
    costAware?: boolean
    /** Emit event when fallback is used (default: true) */
    notifyOnFallback?: boolean
  }

  /**
   * Default fallback rules.
   */
  export const DEFAULT_RULES: Rule[] = [
    {
      condition: "rate_limit",
      fallbacks: ["anthropic", "openai", "google"],
    },
    {
      condition: "unavailable",
      fallbacks: ["anthropic", "openai", "google"],
    },
    {
      condition: "timeout",
      fallbacks: ["anthropic", "openai", "google"],
    },
    {
      condition: "circuit_open",
      fallbacks: ["anthropic", "openai", "google"],
    },
    {
      condition: "any",
      fallbacks: ["anthropic"],
    },
  ]

  /**
   * Default configuration.
   */
  export const DEFAULT_CONFIG: Config = {
    enabled: true,
    maxAttempts: 3,
    rules: DEFAULT_RULES,
    costAware: false,
    notifyOnFallback: true,
  }

  /**
   * Classify an error into an ErrorCondition.
   */
  export function classifyError(error: Error | ReturnType<NamedError["toObject"]>): ErrorCondition {
    // Handle Error objects
    const message = "message" in error ? error.message : ""
    const lowerMessage = message.toLowerCase()

    // Check for timeout
    if (
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("timed out") ||
      lowerMessage.includes("etimedout") ||
      lowerMessage.includes("aborted")
    ) {
      return "timeout"
    }

    // Check for circuit breaker
    if (lowerMessage.includes("circuit_open") || lowerMessage.includes("circuit open")) {
      return "circuit_open"
    }

    // Check APIError for detailed classification
    if ("data" in error && error.data) {
      const data = error.data as Record<string, unknown>

      // Check isRetryable flag and status code
      if (data.statusCode === 429 || data.statusCode === "429") {
        return "rate_limit"
      }

      if (data.statusCode === 503 || data.statusCode === "503") {
        return "unavailable"
      }

      if (data.statusCode === 502 || data.statusCode === 504) {
        return "unavailable"
      }

      // Check message content
      if (typeof data.message === "string") {
        const errorMessage = data.message.toLowerCase()
        if (errorMessage.includes("rate") && errorMessage.includes("limit")) {
          return "rate_limit"
        }
        if (errorMessage.includes("insufficient_quota") || errorMessage.includes("quota")) {
          return "rate_limit"
        }
        if (errorMessage.includes("overloaded") || errorMessage.includes("capacity")) {
          return "rate_limit"
        }
        if (errorMessage.includes("unavailable") || errorMessage.includes("exhausted")) {
          return "unavailable"
        }
      }
    }

    // Try to parse JSON error body
    try {
      const json = JSON.parse(message)
      if (json.type === "error") {
        if (json.error?.type === "too_many_requests" || json.error?.code?.includes("rate_limit")) {
          return "rate_limit"
        }
        // OpenAI insufficient_quota errors should trigger fallback
        if (json.error?.type === "insufficient_quota" || json.error?.code === "insufficient_quota") {
          return "rate_limit"
        }
        if (json.error?.type === "server_error" || json.error?.type === "overloaded_error") {
          return "unavailable"
        }
      }
      if (json.code?.includes("exhausted") || json.code?.includes("unavailable")) {
        return "unavailable"
      }
    } catch {
      // Not JSON, continue
    }

    // Check for rate limit patterns
    if (lowerMessage.includes("rate") && lowerMessage.includes("limit")) {
      return "rate_limit"
    }
    if (lowerMessage.includes("too many requests") || lowerMessage.includes("429")) {
      return "rate_limit"
    }
    if (
      lowerMessage.includes("insufficient_quota") ||
      (lowerMessage.includes("exceeded") && lowerMessage.includes("quota"))
    ) {
      return "rate_limit"
    }
    if (lowerMessage.includes("overloaded") || lowerMessage.includes("capacity")) {
      return "rate_limit"
    }

    // Check for unavailable patterns
    if (
      lowerMessage.includes("unavailable") ||
      lowerMessage.includes("503") ||
      lowerMessage.includes("502") ||
      lowerMessage.includes("bad gateway")
    ) {
      return "unavailable"
    }

    // Default to generic error
    return "error"
  }

  /**
   * Find a matching rule for the given error condition.
   */
  function findRule(condition: ErrorCondition, rules: Rule[]): Rule | undefined {
    // First, look for exact match
    const exactMatch = rules.find((r) => r.condition === condition)
    if (exactMatch) {
      return exactMatch
    }

    // Fall back to "any" rule
    return rules.find((r) => r.condition === "any")
  }

  /**
   * Resolve the next fallback model to try.
   *
   * @param originalModel The original model that was requested "providerID/modelID"
   * @param error The error that occurred
   * @param attempted List of models already attempted
   * @param config Fallback configuration
   * @returns The next model to try, or undefined if no fallback available
   */
  export async function resolve(
    originalModel: string,
    error: Error | ReturnType<NamedError["toObject"]>,
    attempted: string[],
    config: Config = DEFAULT_CONFIG,
  ): Promise<string | undefined> {
    if (!config.enabled) {
      log.info("fallback disabled")
      return undefined
    }

    if (attempted.length >= config.maxAttempts) {
      log.info("max attempts reached", { maxAttempts: config.maxAttempts, attempted })
      return undefined
    }

    const condition = classifyError(error)
    log.info("classifying error", {
      condition,
      error: "message" in error ? error.message : String(error),
    })

    const rule = findRule(condition, config.rules)
    if (!rule) {
      log.info("no matching rule", { condition })
      return undefined
    }

    log.info("found rule", { condition: rule.condition, fallbacks: rule.fallbacks })

    // Extract providers already tried
    const attemptedProviders = new Set(attempted.map((m) => m.split("/")[0]))

    // Try each fallback option
    for (const fallback of rule.fallbacks) {
      // Skip if this provider was already tried
      const fallbackProvider = fallback.split("/")[0]
      if (attemptedProviders.has(fallbackProvider)) {
        continue
      }

      // Check if it's a full model spec or just a provider
      if (fallback.includes("/")) {
        // Full model spec - use directly if not attempted
        if (!attempted.includes(fallback)) {
          log.info("using explicit fallback", { original: originalModel, fallback })
          return fallback
        }
      } else {
        // Just provider - find equivalent model
        const equivalent = await ModelEquivalence.findFallback(originalModel, Array.from(attemptedProviders), [
          fallbackProvider,
        ])

        if (equivalent) {
          log.info("using equivalent fallback", { original: originalModel, fallback: equivalent })
          return equivalent
        }
      }
    }

    // No rule-based fallback found, try general equivalence
    const generalFallback = await ModelEquivalence.findFallback(originalModel, Array.from(attemptedProviders))

    if (generalFallback) {
      log.info("using general equivalence fallback", { original: originalModel, fallback: generalFallback })
      return generalFallback
    }

    log.warn("no fallback available", { originalModel, attempted, condition })
    return undefined
  }

  /**
   * Check if an error should trigger fallback.
   */
  export function shouldFallback(error: Error | ReturnType<NamedError["toObject"]>, config: Config): boolean {
    if (!config.enabled) {
      return false
    }

    const condition = classifyError(error)
    const rule = findRule(condition, config.rules)

    return rule !== undefined && rule.fallbacks.length > 0
  }

  /**
   * Merge user config with defaults.
   */
  export function mergeConfig(userConfig?: Partial<Config>): Config {
    if (!userConfig) {
      return { ...DEFAULT_CONFIG }
    }

    return {
      enabled: userConfig.enabled ?? DEFAULT_CONFIG.enabled,
      maxAttempts: userConfig.maxAttempts ?? DEFAULT_CONFIG.maxAttempts,
      rules: userConfig.rules ?? DEFAULT_CONFIG.rules,
      costAware: userConfig.costAware ?? DEFAULT_CONFIG.costAware,
      notifyOnFallback: userConfig.notifyOnFallback ?? DEFAULT_CONFIG.notifyOnFallback,
    }
  }
}
