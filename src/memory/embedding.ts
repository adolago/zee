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
  EmbeddingRequestOptions,
  EmbeddingProvider,
  EmbeddingProviderType,
  EmbeddingTaskType,
  MediaType,
  MultimodalContent,
  MultimodalInput,
} from "./types";
import { getAuthApiKeySync } from "../config/providers";
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

const GOOGLE_EMBEDDING_TASK_TYPES = new Set<EmbeddingTaskType>([
  "SEMANTIC_SIMILARITY",
  "CLASSIFICATION",
  "CLUSTERING",
  "RETRIEVAL_DOCUMENT",
  "RETRIEVAL_QUERY",
  "QUESTION_ANSWERING",
  "FACT_VERIFICATION",
  "CODE_RETRIEVAL_QUERY",
]);

const GOOGLE_MULTIMODAL_MEDIA_TYPES: MediaType[] = ["text", "image", "video", "audio", "pdf"];

function isGeminiEmbedding2Model(model: string): boolean {
  return model.trim().replace(/^models\//, "").toLowerCase() === "gemini-embedding-2-preview";
}

function assertSupportedEmbeddingModel(model?: string): string {
  const resolved = (model ?? EMBEDDING_MODEL).trim();
  if (!isGeminiEmbedding2Model(resolved)) {
    throw new Error(
      `Unsupported embedding model "${resolved}". Zee memory always uses "${EMBEDDING_MODEL}".`,
    );
  }
  return EMBEDDING_MODEL;
}

function assertSupportedEmbeddingDimensions(dimensions?: number): number {
  if (dimensions !== undefined && dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unsupported embedding dimensions "${dimensions}". Zee memory always uses ${EMBEDDING_DIMENSIONS}.`,
    );
  }
  return EMBEDDING_DIMENSIONS;
}

function normalizeTaskType(taskType?: string): EmbeddingTaskType | undefined {
  if (!taskType) return undefined;
  const normalized = taskType.trim().toUpperCase() as EmbeddingTaskType;
  if (!GOOGLE_EMBEDDING_TASK_TYPES.has(normalized)) {
    throw new Error(`Unsupported Google embedding task type: ${taskType}`);
  }
  return normalized;
}

function stripBase64Prefix(data: string): string {
  const trimmed = data.trim();
  const marker = ";base64,";
  const idx = trimmed.indexOf(marker);
  return idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed;
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    data: match[2],
  };
}

function defaultMimeType(input: Exclude<MultimodalInput, { type: "text" }>): string {
  switch (input.type) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/mpeg";
    case "pdf":
      return "application/pdf";
  }
}

function resolveMimeType(input: Exclude<MultimodalInput, { type: "text" }>): string {
  if (input.mimeType?.trim()) return input.mimeType.trim();
  if ("url" in input && input.url) {
    const parsed = parseDataUrl(input.url);
    if (parsed) return parsed.mimeType;
  }
  return defaultMimeType(input);
}

function toGooglePart(input: Exclude<MultimodalInput, { type: "text" }>): Record<string, unknown> {
  const mimeType = resolveMimeType(input);
  if ("base64" in input && typeof input.base64 === "string" && input.base64.trim()) {
    return {
      inlineData: {
        mimeType,
        data: stripBase64Prefix(input.base64),
      },
    };
  }

  if ("url" in input && typeof input.url === "string" && input.url.trim()) {
    const parsed = parseDataUrl(input.url);
    if (parsed) {
      return {
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.data,
        },
      };
    }

    return {
      fileData: {
        mimeType,
        fileUri: input.url,
      },
    };
  }

  throw new Error(`Multimodal ${input.type} input requires either url or base64 data`);
}

function multimodalToGoogleParts(content: MultimodalContent): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];

  for (const input of content.contents) {
    if (input.type === "text") {
      parts.push({ text: input.content });
      continue;
    }

    parts.push(toGooglePart(input));

    if (input.type === "video" && (input.startTime !== undefined || input.endTime !== undefined)) {
      const timeRange = [
        input.startTime !== undefined ? `start=${input.startTime}s` : undefined,
        input.endTime !== undefined ? `end=${input.endTime}s` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      if (timeRange) {
        parts.push({ text: `Focus on video segment (${timeRange}).` });
      }
    }
  }

  return parts;
}

/**
 * Google embedding client using Generative Language API
 */
class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly id = "google";
  readonly model: string;
  readonly supportsMultimodal?: boolean;
  readonly supportedMediaTypes?: MediaType[];
  dimension: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly outputDimensionality?: number;
  private readonly taskType?: EmbeddingTaskType;
  private readonly title?: string;

  constructor(config: EmbeddingConfig) {
    // Single source of truth: global auth store (`zee auth login google`).
    this.apiKey = getAuthApiKeySync("google") ?? "";
    this.model = assertSupportedEmbeddingModel(config.model);
    this.outputDimensionality = assertSupportedEmbeddingDimensions(config.dimensions);
    this.dimension = this.outputDimensionality;
    this.taskType = normalizeTaskType(config.taskType);
    this.title = config.title?.trim() || undefined;
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      ""
    );
    this.supportsMultimodal = true;
    this.supportedMediaTypes = GOOGLE_MULTIMODAL_MEDIA_TYPES;

    if (!this.apiKey) {
      throw new Error(
        "Google API key required: run `zee auth login google`"
      );
    }
  }

  private resolveModel(): string {
    return this.model.startsWith("models/") ? this.model : `models/${this.model}`;
  }

  private resolveOptions(options?: EmbeddingRequestOptions): EmbeddingRequestOptions {
    return {
      taskType: normalizeTaskType(options?.taskType ?? this.taskType),
      title: options?.title?.trim() || this.title,
    };
  }

  private buildRequest(
    parts: Array<Record<string, unknown>>,
    options?: EmbeddingRequestOptions,
  ): {
    model: string;
    content: { role: "user"; parts: Array<Record<string, unknown>> };
    outputDimensionality?: number;
    taskType?: EmbeddingTaskType;
    title?: string;
  } {
    const request: {
      model: string;
      content: { role: "user"; parts: Array<Record<string, unknown>> };
      outputDimensionality?: number;
      taskType?: EmbeddingTaskType;
      title?: string;
    } = {
      model: this.resolveModel(),
      content: { role: "user", parts },
    };
    const resolved = this.resolveOptions(options);
    if (this.outputDimensionality) {
      request.outputDimensionality = this.outputDimensionality;
    }
    if (resolved.taskType) {
      request.taskType = resolved.taskType;
    }
    if (resolved.title) {
      request.title = resolved.title;
    }
    return request;
  }

  private async requestEmbeddings(
    requests: Array<{
      model: string;
      content: { role: "user"; parts: Array<Record<string, unknown>> };
      outputDimensionality?: number;
      taskType?: EmbeddingTaskType;
      title?: string;
    }>,
  ): Promise<number[][]> {
    if (requests.length === 0) return [];

    const model = this.resolveModel();
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
    return vectors;
  }

  async embed(text: string, options?: EmbeddingRequestOptions): Promise<number[]> {
    const result = await this.embedBatch([text], options);
    return result[0] ?? [];
  }

  async embedBatch(texts: string[], options?: EmbeddingRequestOptions): Promise<number[][]> {
    if (texts.length === 0) return [];
    const requests = texts.map((text) => this.buildRequest([{ text }], options));
    return this.requestEmbeddings(requests);
  }

  async embedMultimodal(
    content: MultimodalContent,
    options?: EmbeddingRequestOptions,
  ): Promise<number[]> {
    const result = await this.embedMultimodalBatch([content], options);
    return result[0] ?? [];
  }

  async embedMultimodalBatch(
    contents: MultimodalContent[],
    options?: EmbeddingRequestOptions,
  ): Promise<number[][]> {
    if (contents.length === 0) return [];

    const requests = contents.map((content) => this.buildRequest(multimodalToGoogleParts(content), options));
    return this.requestEmbeddings(requests);
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
