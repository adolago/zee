/**
 * Reranker module for two-stage retrieval
 *
 * Supports multiple backends:
 * - voyage: Voyage AI reranker (recommended, high quality)
 * - vllm: Local vLLM server with reranker model
 */

import { getApiKeySync } from "../config/providers";

// =============================================================================
// Types
// =============================================================================

export interface RerankOptions {
  /** Number of top results to return */
  topK?: number;
  /** Instruction for the reranker (if supported) */
  instruction?: string;
}

export interface RerankResult {
  /** Original index in the documents array */
  index: number;
  /** Relevance score (higher = more relevant) */
  score: number;
}

export interface Reranker {
  id: string;
  model: string;
  /** Rerank documents by relevance to query */
  rerank(
    query: string,
    documents: string[],
    options?: RerankOptions
  ): Promise<RerankResult[]>;
}

export interface RerankerConfig {
  enabled?: boolean;
  provider?: "voyage" | "vllm";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

// =============================================================================
// Voyage Reranker
// =============================================================================

/**
 * Voyage AI reranker
 * Docs: https://docs.voyageai.com/reference/reranker-api
 */
class VoyageReranker implements Reranker {
  readonly id = "voyage";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: RerankerConfig) {
    this.apiKey = config.apiKey ?? getApiKeySync("voyage") ?? "";
    this.model = config.model ?? "rerank-2";
    this.baseUrl = (config.baseUrl ?? "https://api.voyageai.com/v1").replace(/\/$/, "");

    if (!this.apiKey) {
      throw new Error("Voyage API key required: run `zee auth login voyage` or set VOYAGE_API_KEY env");
    }
  }

  async rerank(query: string, documents: string[], options?: RerankOptions): Promise<RerankResult[]> {
    if (documents.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        top_k: options?.topK,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voyage rerank failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; relevance_score: number }>;
    };

    return data.data
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, options?.topK)
      .map((item) => ({
        index: item.index,
        score: item.relevance_score,
      }));
  }
}

// =============================================================================
// vLLM Reranker
// =============================================================================

/**
 * vLLM-based reranker for local deployment
 * Supports models like Qwen3-VL-Reranker or bge-reranker
 */
class VLLMReranker implements Reranker {
  readonly id = "vllm";
  readonly model: string;
  private readonly baseUrl: string;

  constructor(config: RerankerConfig) {
    this.model = config.model ?? "BAAI/bge-reranker-v2-m3";
    this.baseUrl = (config.baseUrl ?? "http://localhost:8002").replace(/\/$/, "");
  }

  async rerank(query: string, documents: string[], options?: RerankOptions): Promise<RerankResult[]> {
    if (documents.length === 0) return [];

    // vLLM reranker endpoint (OpenAI-compatible format)
    const response = await fetch(`${this.baseUrl}/v1/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        top_n: options?.topK,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`vLLM rerank failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, options?.topK)
      .map((item) => ({
        index: item.index,
        score: item.relevance_score,
      }));
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a reranker based on configuration
 */
export function createReranker(config: RerankerConfig): Reranker | null {
  if (!config.enabled) return null;

  const provider = config.provider ?? "voyage";

  switch (provider) {
    case "voyage":
      return new VoyageReranker(config);
    case "vllm":
      return new VLLMReranker(config);
    default:
      throw new Error(`Unknown reranker provider: ${provider}`);
  }
}

// =============================================================================
// Exports
// =============================================================================

export { VoyageReranker, VLLMReranker };
