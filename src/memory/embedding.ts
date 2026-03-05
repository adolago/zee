/**
 * Embedding client for generating vector representations of text.
 *
 * Zee currently supports Google (Gemini) embeddings only.
 *
 * Includes LRU caching to avoid redundant API calls.
 *
 * Ported into Zee for the unified memory layer.
 */

import * as crypto from "node:crypto";
import type {
  EmbeddingProvider,
  EmbeddingProviderType,
  MediaType,
  MultimodalContent,
} from "./types";
import { getAuthApiKeySync } from "../config/providers";
import { setCurrentEmbeddingModel } from "./stats";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for embedding providers
 */
export interface EmbeddingConfig {
  /** Embedding provider type */
  provider?: EmbeddingProviderType;
  /** Model name for embeddings */
  model?: string;
  /** Embedding dimensions */
  dimensions?: number;
  /** Base URL for the embedding API */
  baseUrl?: string;
}

// =============================================================================
// LRU Cache
// =============================================================================

/**
 * Simple LRU cache for embeddings (supports text and multimodal content)
 */
class EmbeddingCache {
  private readonly cache = new Map<string, number[]>();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /** Hash text to create cache key */
  private hash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  /**
   * Hash multimodal content to create cache key.
   * Includes text content, image URLs/base64, video URLs+timerange.
   */
  hashMultimodal(content: MultimodalContent): string {
    const parts: string[] = [];

    for (const input of content.contents) {
      switch (input.type) {
        case "text":
          parts.push(`text:${input.content}`);
          break;
        case "image":
          if (input.url) {
            parts.push(`image:url:${input.url}`);
          } else if (input.base64) {
            // Hash the base64 content for shorter key
            const hash = crypto.createHash("sha256").update(input.base64).digest("hex").slice(0, 16);
            parts.push(`image:base64:${hash}`);
          }
          break;
        case "video":
          parts.push(`video:${input.url}:${input.startTime ?? 0}:${input.endTime ?? "end"}`);
          break;
      }
    }

    return this.hash(parts.join("|"));
  }

  get(text: string): number[] | undefined {
    const key = this.hash(text);
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      this.hits++;
      return value;
    }
    this.misses++;
    return undefined;
  }

  /** Get cached embedding for multimodal content */
  getMultimodal(content: MultimodalContent): number[] | undefined {
    const key = this.hashMultimodal(content);
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
      this.hits++;
      return value;
    }
    this.misses++;
    return undefined;
  }

  set(text: string, embedding: number[]): void {
    const key = this.hash(text);
    // Delete first to update insertion order
    this.cache.delete(key);
    this.cache.set(key, embedding);

    // Evict oldest entries if over capacity
    while (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  /** Set cached embedding for multimodal content */
  setMultimodal(content: MultimodalContent, embedding: number[]): void {
    const key = this.hashMultimodal(content);
    this.cache.delete(key);
    this.cache.set(key, embedding);

    while (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }
}

// =============================================================================
// Provider Implementations
// =============================================================================

export const LEGACY_LOCAL_EMBEDDINGGEMMA_MODEL =
  "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
export const PREFERRED_LOCAL_EMBEDDINGGEMMA_QAT_MODEL =
  "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";

function normalizeEmbeddingModel(model: string): string {
  const trimmed = model.trim();
  if (trimmed === LEGACY_LOCAL_EMBEDDINGGEMMA_MODEL) {
    return PREFERRED_LOCAL_EMBEDDINGGEMMA_QAT_MODEL;
  }
  return trimmed;
}

/**
 * Google embedding client using Generative Language API
 */
class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly id = "google";
  readonly model: string;
  dimension: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly outputDimensionality?: number;

  constructor(config: EmbeddingConfig) {
    // Single source of truth: global auth store (`zee auth login google`).
    this.apiKey = getAuthApiKeySync("google") ?? "";
    this.model = normalizeEmbeddingModel(config.model ?? "gemini-embedding-001");
    this.outputDimensionality =
      typeof config.dimensions === "number" ? config.dimensions : undefined;
    this.dimension = this.outputDimensionality ?? 3072; // gemini-embedding-001 default
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      ""
    );

    if (!this.apiKey) {
      throw new Error(
        "Google API key required: run `zee auth login google`"
      );
    }
  }

  private resolveModel(): string {
    return this.model.startsWith("models/") ? this.model : `models/${this.model}`;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const model = this.resolveModel();
    const requests = texts.map((text) => {
      const request: {
        model: string;
        content: { parts: Array<{ text: string }> };
        outputDimensionality?: number;
      } = {
        model,
        content: { parts: [{ text }] },
      };
      if (this.outputDimensionality) {
        request.outputDimensionality = this.outputDimensionality;
      }
      return request;
    });

    const response = await fetch(
      `${this.baseUrl}/${model}:batchEmbedContents?key=${encodeURIComponent(
        this.apiKey
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google embedding failed (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as {
      embeddings?: Array<{ values?: number[] }>;
    };

    const vectors = (data.embeddings ?? []).map((item) => item.values ?? []);
    if (vectors.length === 0) {
      throw new Error("Google embedding returned no vectors");
    }
    if (!this.outputDimensionality && vectors.length > 0) {
      const length = vectors[0]?.length ?? 0;
      if (length > 0) this.dimension = length;
    }
    return vectors;
  }
}

// =============================================================================
// Caching Wrapper
// =============================================================================

/**
 * Caching wrapper for any embedding provider
 */
class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimension: number;
  readonly supportsMultimodal?: boolean;
  readonly supportedMediaTypes?: MediaType[];
  private readonly inner: EmbeddingProvider;
  private readonly cache: EmbeddingCache;

  constructor(inner: EmbeddingProvider, cacheSize = 1000) {
    this.inner = inner;
    this.cache = new EmbeddingCache(cacheSize);
    this.id = inner.id;
    this.model = inner.model;
    this.dimension = inner.dimension;
    this.supportsMultimodal = inner.supportsMultimodal;
    this.supportedMediaTypes = inner.supportedMediaTypes;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    const embedding = await this.inner.embed(text);
    this.cache.set(text, embedding);

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Check cache for each text
    const results: (number[] | null)[] = texts.map(
      (t) => this.cache.get(t) ?? null
    );
    const uncachedIndices = results
      .map((r, i) => (r === null ? i : -1))
      .filter((i) => i >= 0);

    if (uncachedIndices.length === 0) {
      // All cached
      return results as number[][];
    }

    // Fetch uncached embeddings
    const uncachedTexts = uncachedIndices.map((i) => texts[i]);
    const fetched = await this.inner.embedBatch(uncachedTexts);

    // Merge results and update cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j];
      results[i] = fetched[j];
      this.cache.set(texts[i], fetched[j]);
    }

    return results as number[][];
  }

  async embedMultimodal(content: MultimodalContent): Promise<number[]> {
    if (!this.inner.embedMultimodal) {
      throw new Error(`Provider ${this.id} does not support multimodal embeddings`);
    }

    const cached = this.cache.getMultimodal(content);
    if (cached !== undefined) return cached;

    const embedding = await this.inner.embedMultimodal(content);
    this.cache.setMultimodal(content, embedding);
    return embedding;
  }

  async embedMultimodalBatch(contents: MultimodalContent[]): Promise<number[][]> {
    if (!this.inner.embedMultimodalBatch) {
      throw new Error(`Provider ${this.id} does not support multimodal batch embeddings`);
    }

    if (contents.length === 0) return [];

    // Check cache for each content
    const results: (number[] | null)[] = contents.map(
      (c) => this.cache.getMultimodal(c) ?? null
    );
    const uncachedIndices = results
      .map((r, i) => (r === null ? i : -1))
      .filter((i) => i >= 0);

    if (uncachedIndices.length === 0) {
      return results as number[][];
    }

    // Fetch uncached embeddings
    const uncachedContents = uncachedIndices.map((i) => contents[i]);
    const fetched = await this.inner.embedMultimodalBatch(uncachedContents);

    // Merge results and update cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j];
      results[i] = fetched[j];
      this.cache.setMultimodal(contents[i], fetched[j]);
    }

    return results as number[][];
  }

  clearCache(): void {
    this.cache.clear();
  }

  cacheStats(): { hits: number; misses: number; size: number } {
    return this.cache.stats();
  }
}

// =============================================================================
// Factory Function
// =============================================================================


/**
 * Create an embedding provider based on configuration.
 *
 * Zee currently supports Google embeddings only.
 * Includes LRU caching to avoid redundant API calls.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
  options?: { cacheSize?: number; noCache?: boolean }
): EmbeddingProvider {
  const provider = new GoogleEmbeddingProvider(config);

  // Track current model for max context lookup
  setCurrentEmbeddingModel(provider.model);

  // Wrap with cache unless disabled
  if (options?.noCache) {
    return provider;
  }
  return new CachedEmbeddingProvider(provider, options?.cacheSize ?? 1000);
}

/**
 * Create an embedding provider asynchronously.
 * Required for providers that need async initialization (e.g., Qwen3-VL).
 */
export async function createEmbeddingProviderAsync(
  config: EmbeddingConfig,
  options?: { cacheSize?: number; noCache?: boolean }
): Promise<EmbeddingProvider> {
  const provider = new GoogleEmbeddingProvider(config);

  // Track current model for max context lookup
  setCurrentEmbeddingModel(provider.model);

  // Wrap with cache unless disabled
  if (options?.noCache) {
    return provider;
  }
  return new CachedEmbeddingProvider(provider, options?.cacheSize ?? 1000);
}

// =============================================================================
// Exports
// =============================================================================

export {
  EmbeddingCache,
  GoogleEmbeddingProvider,
  CachedEmbeddingProvider,
};
