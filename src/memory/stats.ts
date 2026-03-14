/**
 * Embedding Model Configuration
 *
 * Provides embedding model limits and configuration.
 * Max context is determined by the embedding model being used.
 */

// =============================================================================
// Embedding Model Limits
// =============================================================================

/**
 * Max input tokens for known embedding models.
 * Source: Model documentation and API specifications.
 */
export const EMBEDDING_MODEL_LIMITS: Record<string, number> = {
  // Google
  "gemini-embedding-2-preview": 2048,
};

/** Default max context when model is unknown */
export const DEFAULT_EMBEDDING_MAX_CONTEXT = 2048;

/**
 * Get the max input tokens for an embedding model.
 */
export function getEmbeddingMaxContext(model?: string): number {
  if (!model) return DEFAULT_EMBEDDING_MAX_CONTEXT;
  return EMBEDDING_MODEL_LIMITS[model] ?? DEFAULT_EMBEDDING_MAX_CONTEXT;
}

// =============================================================================
// Current Embedding Model State
// =============================================================================

let currentEmbeddingModel: string | undefined;

/**
 * Set the current embedding model being used.
 * Called by the embedding provider when initialized.
 */
export function setCurrentEmbeddingModel(model: string): void {
  currentEmbeddingModel = model;
}

/**
 * Get the current embedding model.
 */
export function getCurrentEmbeddingModel(): string | undefined {
  return currentEmbeddingModel;
}

/**
 * Get the max context for the current embedding model.
 */
export function getCurrentEmbeddingMaxContext(): number {
  return getEmbeddingMaxContext(currentEmbeddingModel);
}
