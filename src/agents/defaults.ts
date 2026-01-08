// Defaults for agent metadata when upstream does not supply them.
// Model id uses pi-ai's built-in Anthropic catalog.
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-opus-4-5";
// Context window: Opus 4.5 supports ~200k tokens (per pi-ai models.generated.ts).
export const DEFAULT_CONTEXT_TOKENS = 200_000;

// Common model context windows
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gemini-2.0-flash": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
};

/**
 * Lookup context window size for a model.
 * Returns undefined if model is not found.
 */
export function lookupContextTokens(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  // Try exact match first
  if (MODEL_CONTEXT_WINDOWS[modelId]) {
    return MODEL_CONTEXT_WINDOWS[modelId];
  }
  // Try partial match (e.g., "anthropic/claude-opus-4-5" -> "claude-opus-4-5")
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelId.includes(key)) {
      return value;
    }
  }
  return undefined;
}
