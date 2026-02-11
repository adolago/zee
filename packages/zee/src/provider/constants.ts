/**
 * Provider Constants
 *
 * Central configuration for provider-specific values.
 * These values are documented and should be changed with care.
 */

/**
 * Thinking/Reasoning Budget Token Limits
 *
 * These values control how many tokens are allocated for extended thinking/reasoning.
 * The budgets are used across different providers (Anthropic, OpenAI, Google, etc.)
 *
 * Why these specific values:
 * - low: 8192 - Quick responses, minimal reasoning overhead
 * - medium: 16000 - Balanced for most tasks (default)
 * - high: 32000 - Complex reasoning, multi-step problems
 * - max: 64000 - Deep analysis, maximum reasoning capacity
 *
 * Note: Some models have lower limits. The actual budget used will be
 * min(requested, model_limit).
 */
export const THINKING_BUDGETS = {
  low: 8192,
  medium: 16000,
  high: 32000,
  max: 64000,
} as const

export type ThinkingBudgetLevel = keyof typeof THINKING_BUDGETS

/**
 * Default output token limits
 */
export const OUTPUT_TOKEN_MAX = 32768
