/**
 * Hybrid Memory Search
 *
 * Combines local vector similarity search with SQLite BM25 keyword search.
 * The vector path excels at semantic similarity while BM25 excels at exact
 * keyword matching. Merging both provides better recall than either alone.
 *
 * Algorithm:
 *   1. Run vector search and keyword search (SQLite FTS) in parallel
 *   2. Normalize scores to [0, 1] range
 *   3. Merge by ID, combining scores with configurable weights
 *   4. Sort by combined score, return top-N
 *
 * Default weights: 70% vector + 30% keyword (semantic-primary mode).
 *
 * @module memory/hybrid
 */

import type { MemorySearchResult, MemorySearchParams } from "./types"
import { Log } from "../../packages/zee/src/util/log"

const log = Log.create({ service: "memory:hybrid" })

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HybridSearchConfig {
  /** Weight for vector similarity score (0-1). Default: 0.7 */
  vectorWeight?: number
  /** Weight for keyword/BM25 score (0-1). Default: 0.3 */
  keywordWeight?: number
  /** Minimum combined score threshold (0-1). Default: 0.3 */
  threshold?: number
  /** Maximum results. Default: 10 */
  limit?: number
}

const DEFAULT_VECTOR_WEIGHT = 0.7
const DEFAULT_KEYWORD_WEIGHT = 0.3
const DEFAULT_THRESHOLD = 0.3
const DEFAULT_LIMIT = 10

// ---------------------------------------------------------------------------
// Hybrid Result Type
// ---------------------------------------------------------------------------

export interface HybridSearchResult {
  /** The memory entry (from vector search; may be null for keyword-only matches) */
  entry: MemorySearchResult["entry"] | null
  /** Combined hybrid score */
  score: number
  /** Individual component scores */
  components: {
    vector: number
    keyword: number
  }
  /** FTS snippet with highlighted matches */
  snippet?: string
  /** Memory ID (present in all results) */
  id: string
}

// ---------------------------------------------------------------------------
// Merge function
// ---------------------------------------------------------------------------

/**
 * Merge vector and keyword results into a single ranked list.
 *
 * @param vectorResults - Results from local vector search
 * @param keywordResults - Results from SQLite FTS search
 * @param config - Hybrid search configuration
 */
export function mergeHybridResults(
  vectorResults: MemorySearchResult[],
  keywordResults: Array<{ id: string; score: number; snippet?: string }>,
  config: HybridSearchConfig = {},
): HybridSearchResult[] {
  const vectorWeight = config.vectorWeight ?? DEFAULT_VECTOR_WEIGHT
  const keywordWeight = config.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT
  const threshold = config.threshold ?? DEFAULT_THRESHOLD
  const limit = config.limit ?? DEFAULT_LIMIT

  // Index vector results by ID
  const merged = new Map<string, HybridSearchResult>()

  for (const vr of vectorResults) {
    const id = vr.entry.id
    merged.set(id, {
      entry: vr.entry,
      score: 0, // will be computed
      components: { vector: vr.score, keyword: 0 },
      id,
    })
  }

  // Merge keyword results
  for (const kr of keywordResults) {
    const existing = merged.get(kr.id)
    if (existing) {
      existing.components.keyword = kr.score
      if (kr.snippet) existing.snippet = kr.snippet
    } else {
      merged.set(kr.id, {
        entry: null, // no vector result; caller can hydrate from local storage if needed
        score: 0,
        components: { vector: 0, keyword: kr.score },
        snippet: kr.snippet,
        id: kr.id,
      })
    }
  }

  // Compute combined scores
  for (const result of merged.values()) {
    result.score =
      vectorWeight * result.components.vector +
      keywordWeight * result.components.keyword
  }

  // Filter by threshold and sort
  const filtered = Array.from(merged.values())
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  log.debug("hybrid merge", {
    vectorCount: vectorResults.length,
    keywordCount: keywordResults.length,
    mergedCount: merged.size,
    filteredCount: filtered.length,
    weights: { vector: vectorWeight, keyword: keywordWeight },
  })

  return filtered
}

// ---------------------------------------------------------------------------
// Hybrid search parameters extension
// ---------------------------------------------------------------------------

export interface HybridSearchParams extends MemorySearchParams {
  /** Enable hybrid search (default: true if FTS is available) */
  hybrid?: boolean
  /** Override hybrid weights */
  hybridConfig?: HybridSearchConfig
}
