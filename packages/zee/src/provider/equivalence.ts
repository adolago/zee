import { Log } from "@/util/log"
import { Provider } from "./provider"

/**
 * Model Equivalence Mapper - Maps models across providers by capability tier.
 *
 * When a provider fails, this module finds equivalent models from other providers
 * that can serve as fallbacks with similar capabilities.
 */
export namespace ModelEquivalence {
  const log = Log.create({ service: "model-equivalence" })

  /**
   * Capability tiers from highest to lowest.
   */
  export type Tier = "flagship" | "standard" | "fast"

  /**
   * Built-in tier mappings. Models listed first are preferred within each tier.
   * Format: "providerID/modelID" or patterns like "anthropic/claude-opus*"
   */
  const DEFAULT_TIERS: Record<Tier, string[]> = {
    flagship: [
      "anthropic/claude-opus-4-5",
      "anthropic/claude-opus-4",
      "openai/gpt-5",
      "openai/o3",
      "google/gemini-2.5-pro",
      "google/gemini-2.0-pro",
    ],
    standard: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-sonnet-3-5",
      "openai/gpt-4.1",
      "openai/gpt-4o",
      "google/gemini-2.5-flash",
      "google/gemini-2.0-flash",
    ],
    fast: [
      "anthropic/claude-haiku-4",
      "anthropic/claude-haiku-3-5",
      "anthropic/claude-haiku-3",
      "openai/gpt-4.1-mini",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-lite",
    ],
  }

  // Custom tiers from config (merged with defaults)
  let customTiers: Record<Tier, string[]> = { ...DEFAULT_TIERS }

  /**
   * Configure custom tier mappings.
   */
  export function configure(tiers: Partial<Record<Tier, string[]>>): void {
    customTiers = {
      flagship: [...(tiers.flagship ?? DEFAULT_TIERS.flagship)],
      standard: [...(tiers.standard ?? DEFAULT_TIERS.standard)],
      fast: [...(tiers.fast ?? DEFAULT_TIERS.fast)],
    }
    log.info("configured", { tiers: Object.keys(customTiers) })
  }

  /**
   * Reset to default tier mappings (for testing).
   */
  export function reset(): void {
    customTiers = { ...DEFAULT_TIERS }
  }

  /**
   * Get the tier mappings.
   */
  export function getTiers(): Record<Tier, string[]> {
    return { ...customTiers }
  }

  /**
   * Normalize model ID for matching.
   * Handles variations like "claude-opus-4-5" vs "claude-opus-4.5"
   */
  function normalizeModelID(model: string): string {
    return model
      .toLowerCase()
      .replace(/\./g, "-") // dots to dashes
      .replace(/-+/g, "-") // collapse multiple dashes
      .replace(/latest$/, "") // remove "latest" suffix
  }

  /**
   * Check if a model matches a pattern.
   * Supports exact match and prefix patterns (e.g., "anthropic/claude-opus*")
   */
  function matchesPattern(model: string, pattern: string): boolean {
    const normalizedModel = normalizeModelID(model)
    const normalizedPattern = normalizeModelID(pattern)

    if (normalizedPattern.endsWith("*")) {
      const prefix = normalizedPattern.slice(0, -1)
      return normalizedModel.startsWith(prefix)
    }

    return normalizedModel === normalizedPattern || normalizedModel.startsWith(normalizedPattern + "-")
  }

  /**
   * Get the tier for a model.
   *
   * @param model Full model string "providerID/modelID" or just "modelID"
   * @returns The tier, or undefined if model isn't in any tier
   */
  export function getTier(model: string): Tier | undefined {
    for (const [tier, models] of Object.entries(customTiers) as [Tier, string[]][]) {
      for (const pattern of models) {
        if (matchesPattern(model, pattern)) {
          return tier
        }
      }
    }

    // Try to infer tier from model name patterns
    const lower = model.toLowerCase()
    if (lower.includes("opus") || lower.includes("gpt-5") || lower.includes("o3") || lower.includes("pro")) {
      return "flagship"
    }
    if (lower.includes("sonnet") || lower.includes("4o") || lower.includes("4.1") || lower.includes("flash")) {
      return "standard"
    }
    // "fast" tier now includes models previously in "mini"
    if (lower.includes("haiku") || lower.includes("mini") || lower.includes("small") || lower.includes("lite")) {
      return "fast"
    }

    return undefined
  }

  /**
   * Get all models in the same tier as the given model.
   *
   * @param model Full model string "providerID/modelID"
   * @returns Array of equivalent models, excluding the input model
   */
  export function getEquivalents(model: string): string[] {
    const tier = getTier(model)
    if (!tier) {
      log.warn("no tier found", { model })
      return []
    }

    return customTiers[tier].filter((m) => !matchesPattern(model, m))
  }

  /**
   * Find a fallback model from a different provider.
   *
   * @param model The original model that failed
   * @param excludeProviders Providers to exclude (already tried or failing)
   * @param preferredProviders Optional ordered list of preferred providers
   * @returns A fallback model string, or undefined if none available
   */
  export async function findFallback(
    model: string,
    excludeProviders: string[],
    preferredProviders?: string[],
  ): Promise<string | undefined> {
    const tier = getTier(model)
    if (!tier) {
      log.warn("cannot find fallback - no tier for model", { model })
      return undefined
    }

    // Get available providers
    const providers = await Provider.list()
    const availableProviderIDs = new Set(
      Object.values(providers)
        .filter((p) => !excludeProviders.includes(p.id))
        .map((p) => p.id),
    )

    // Order candidates by preference
    const tieredModels = customTiers[tier]
    const candidates: string[] = []

    // First, add preferred providers' models
    if (preferredProviders) {
      for (const providerID of preferredProviders) {
        if (availableProviderIDs.has(providerID)) {
          for (const m of tieredModels) {
            if (m.startsWith(providerID + "/")) {
              candidates.push(m)
            }
          }
        }
      }
    }

    // Then add remaining models
    for (const m of tieredModels) {
      if (!candidates.includes(m)) {
        const [providerID] = m.split("/")
        if (availableProviderIDs.has(providerID)) {
          candidates.push(m)
        }
      }
    }

    // Exclude the original model
    const filtered = candidates.filter((m) => !matchesPattern(model, m))

    // Verify model exists
    for (const candidate of filtered) {
      const [providerID, modelID] = candidate.split("/")
      try {
        await Provider.getModel(providerID, modelID)
        log.info("found fallback", { original: model, fallback: candidate, tier })
        return candidate
      } catch {
        // Model not available, try next
        continue
      }
    }

    // Try lower tier if no same-tier fallback found
    const tierOrder: Tier[] = ["flagship", "standard", "fast"]
    const currentTierIndex = tierOrder.indexOf(tier)

    for (let i = currentTierIndex + 1; i < tierOrder.length; i++) {
      const lowerTier = tierOrder[i]
      const lowerModels = customTiers[lowerTier]

      for (const m of lowerModels) {
        const [providerID, modelID] = m.split("/")
        if (!availableProviderIDs.has(providerID)) continue

        try {
          await Provider.getModel(providerID, modelID)
          log.info("found lower-tier fallback", {
            original: model,
            fallback: m,
            originalTier: tier,
            fallbackTier: lowerTier,
          })
          return m
        } catch {
          continue
        }
      }
    }

    log.warn("no fallback found", { model, excludeProviders, tier })
    return undefined
  }

  /**
   * Parse a model string into provider and model IDs.
   */
  export function parseModel(model: string): { providerID: string; modelID: string } {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID,
      modelID: rest.join("/"),
    }
  }

  /**
   * Check if two models are equivalent (same tier).
   */
  export function areEquivalent(model1: string, model2: string): boolean {
    const tier1 = getTier(model1)
    const tier2 = getTier(model2)
    return tier1 !== undefined && tier1 === tier2
  }

  /**
   * Get all tiers in order from highest to lowest capability.
   */
  export function getTierOrder(): Tier[] {
    return ["flagship", "standard", "fast"]
  }
}
