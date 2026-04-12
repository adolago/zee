/**
 * Embedding client for generating vector representations of text.
 *
 * Zee memory defaults to local embeddings.
 *
 * Includes LRU caching to avoid redundant API calls.
 *
 * Ported into Zee for the unified memory layer.
 */

import * as crypto from "node:crypto";
import type {
  EmbeddingRequestOptions,
  EmbeddingProvider,
  EmbeddingProviderType,
  EmbeddingTaskType,
  MediaType,
  MultimodalContent,
} from "./types";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../config/constants";
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
  /** Default Google embedding task type */
  taskType?: EmbeddingTaskType;
  /** Optional title for document embeddings */
  title?: string;
  /** Base URL for the embedding API */
  baseUrl?: string;
  /** Local model/cache directory, when the provider needs one. */
  modelPath?: string;
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

  /** Hash cache input to create a stable key */
  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  private optionsKey(options?: EmbeddingRequestOptions): string {
    if (!options?.taskType && !options?.title) return "";
    return JSON.stringify({
      taskType: options.taskType ?? null,
      title: options.title ?? null,
    });
  }

  /**
   * Hash multimodal content to create cache key.
   * Includes text content, image URLs/base64, video URLs+timerange.
   */
  hashMultimodal(content: MultimodalContent, options?: EmbeddingRequestOptions): string {
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
        case "audio":
          if (input.url) {
            parts.push(`audio:url:${input.url}`);
          } else if (input.base64) {
            const hash = crypto.createHash("sha256").update(input.base64).digest("hex").slice(0, 16);
            parts.push(`audio:base64:${hash}`);
          }
          break;
        case "pdf":
          if (input.url) {
            parts.push(`pdf:url:${input.url}`);
          } else if (input.base64) {
            const hash = crypto.createHash("sha256").update(input.base64).digest("hex").slice(0, 16);
            parts.push(`pdf:base64:${hash}`);
          }
          break;
      }
    }

    const optionsKey = this.optionsKey(options);
    if (optionsKey) parts.push(`options:${optionsKey}`);
    return this.hash(parts.join("|"));
  }

  get(text: string, options?: EmbeddingRequestOptions): number[] | undefined {
    const key = this.hash(`${text}|${this.optionsKey(options)}`);
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
  getMultimodal(content: MultimodalContent, options?: EmbeddingRequestOptions): number[] | undefined {
    const key = this.hashMultimodal(content, options);
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

  set(text: string, embedding: number[], options?: EmbeddingRequestOptions): void {
    const key = this.hash(`${text}|${this.optionsKey(options)}`);
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
  setMultimodal(content: MultimodalContent, embedding: number[], options?: EmbeddingRequestOptions): void {
    const key = this.hashMultimodal(content, options);
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

function normalizeVector(vector: number[]): number[] {
  const mag = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return mag > 0 ? vector.map((value) => value / mag) : vector;
}

function stableHash(input: string): number {
  const hash = crypto.createHash("sha256").update(input).digest();
  return hash.readUInt32BE(0);
}

function tokenizeEmbeddingText(text: string): string[] {
  const normalized = text.toLowerCase().normalize("NFKC");
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const shingles: string[] = [];
  for (const word of words) {
    if (word.length < 4) continue;
    for (let i = 0; i <= word.length - 3; i++) {
      shingles.push(word.slice(i, i + 3));
    }
  }
  return [...words, ...shingles];
}

function multimodalToLocalText(content: MultimodalContent): string {
  return content.contents
    .map((input) => {
      if (input.type === "text") return input.content;
      if ("url" in input && input.url) return `[${input.type}:${input.url}]`;
      if ("base64" in input && input.base64) return `[${input.type}:inline:${stableHash(input.base64)}]`;
      return `[${input.type}]`;
    })
    .join("\n");
}

/**
 * Deterministic local embedding provider.
 *
 * This is intentionally dependency-free so package installs do not need Google,
 * Docker, Python, or a native embedding service before Zee can run.
 */
class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local";
  readonly model: string;
  dimension: number;
  readonly supportsMultimodal = true;
  readonly supportedMediaTypes: MediaType[] = ["text", "image", "video", "audio", "pdf"];

  constructor(config: EmbeddingConfig) {
    this.model = config.model?.trim() || EMBEDDING_MODEL;
    this.dimension = config.dimensions ?? EMBEDDING_DIMENSIONS;
  }

  async embed(text: string, _options?: EmbeddingRequestOptions): Promise<number[]> {
    const vector = new Array(this.dimension).fill(0);
    const tokens = tokenizeEmbeddingText(text);
    if (tokens.length === 0) return vector;

    for (const token of tokens) {
      const hash = stableHash(token);
      const index = hash % this.dimension;
      const sign = (hash & 1) === 0 ? 1 : -1;
      vector[index] += sign;
    }

    return normalizeVector(vector);
  }

  async embedBatch(texts: string[], options?: EmbeddingRequestOptions): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text, options)));
  }

  async embedMultimodal(content: MultimodalContent, options?: EmbeddingRequestOptions): Promise<number[]> {
    return this.embed(multimodalToLocalText(content), options);
  }

  async embedMultimodalBatch(
    contents: MultimodalContent[],
    options?: EmbeddingRequestOptions,
  ): Promise<number[][]> {
    return Promise.all(contents.map((content) => this.embedMultimodal(content, options)));
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
  dimension: number;
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

  async embed(text: string, options?: EmbeddingRequestOptions): Promise<number[]> {
    const cached = this.cache.get(text, options);
    if (cached !== undefined) return cached;

    const embedding = await this.inner.embed(text, options);
    this.dimension = this.inner.dimension;
    this.cache.set(text, embedding, options);

    return embedding;
  }

  async embedBatch(texts: string[], options?: EmbeddingRequestOptions): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Check cache for each text
    const results: (number[] | null)[] = texts.map(
      (t) => this.cache.get(t, options) ?? null
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
    const fetched = await this.inner.embedBatch(uncachedTexts, options);
    this.dimension = this.inner.dimension;

    // Merge results and update cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j];
      results[i] = fetched[j];
      this.cache.set(texts[i], fetched[j], options);
    }

    return results as number[][];
  }

  async embedMultimodal(content: MultimodalContent, options?: EmbeddingRequestOptions): Promise<number[]> {
    if (!this.inner.embedMultimodal) {
      throw new Error(`Provider ${this.id} does not support multimodal embeddings`);
    }

    const cached = this.cache.getMultimodal(content, options);
    if (cached !== undefined) return cached;

    const embedding = await this.inner.embedMultimodal(content, options);
    this.dimension = this.inner.dimension;
    this.cache.setMultimodal(content, embedding, options);
    return embedding;
  }

  async embedMultimodalBatch(
    contents: MultimodalContent[],
    options?: EmbeddingRequestOptions,
  ): Promise<number[][]> {
    if (!this.inner.embedMultimodalBatch) {
      throw new Error(`Provider ${this.id} does not support multimodal batch embeddings`);
    }

    if (contents.length === 0) return [];

    // Check cache for each content
    const results: (number[] | null)[] = contents.map(
      (c) => this.cache.getMultimodal(c, options) ?? null
    );
    const uncachedIndices = results
      .map((r, i) => (r === null ? i : -1))
      .filter((i) => i >= 0);

    if (uncachedIndices.length === 0) {
      return results as number[][];
    }

    // Fetch uncached embeddings
    const uncachedContents = uncachedIndices.map((i) => contents[i]);
    const fetched = await this.inner.embedMultimodalBatch(uncachedContents, options);
    this.dimension = this.inner.dimension;

    // Merge results and update cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j];
      results[i] = fetched[j];
      this.cache.setMultimodal(contents[i], fetched[j], options);
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
 * Zee memory defaults to local embeddings.
 * Includes LRU caching to avoid redundant API calls.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
  options?: { cacheSize?: number; noCache?: boolean }
): EmbeddingProvider {
  const provider = new LocalEmbeddingProvider(config);

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
  const provider = new LocalEmbeddingProvider(config);

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
  LocalEmbeddingProvider,
  CachedEmbeddingProvider,
};
