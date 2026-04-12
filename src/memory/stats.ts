/**
 * Embedding Model Configuration
 *
 * Provides local embedding runtime state.
 */

/** Default max context when model is unknown */
export const DEFAULT_EMBEDDING_MAX_CONTEXT = 2048;

/**
 * Get the max input tokens for local embeddings.
 */
export function getEmbeddingMaxContext(_model?: string): number {
  return DEFAULT_EMBEDDING_MAX_CONTEXT;
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
