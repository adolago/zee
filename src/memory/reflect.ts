/**
 * Memory Reflect Job
 *
 * Scheduled curation process that runs as a cron task:
 * 1. Deduplicates similar facts (merges near-duplicates)
 * 2. Evolves opinion confidence based on evidence patterns
 * 3. Updates entity pages from recent memories
 * 4. Identifies stale beliefs (not challenged in a long time)
 *
 * This job does NOT use LLM calls -- it operates on heuristics
 * and local memory queries. An LLM-enhanced version can be added later
 * as an agentTurn cron payload.
 */

import type { Memory } from "./unified";
import type { MemoryEntry } from "./types";
import { generateEntityPages } from "./entity-pages";
import { Log } from "../../packages/zee/src/util/log";

const log = Log.create({ service: "memory-reflect" });

// =============================================================================
// Types
// =============================================================================

export interface ReflectResult {
  /** Number of duplicate facts merged */
  duplicatesMerged: number;
  /** Number of beliefs with decayed confidence */
  beliefsDecayed: number;
  /** Number of entity pages regenerated */
  entityPagesUpdated: number;
  /** Number of stale beliefs identified */
  staleBeliefs: number;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface ReflectOptions {
  /** Namespace to reflect on. Default: "zee" */
  namespace?: string;
  /** Similarity threshold for duplicate detection. Default: 0.92 */
  duplicateThreshold?: number;
  /** Days without challenge before a belief is considered stale. Default: 30 */
  staleDays?: number;
  /** Confidence decay per reflect cycle for stale beliefs. Default: 0.02 */
  staleDecay?: number;
  /** Maximum entries to scan per reflect run. Default: 200 */
  scanLimit?: number;
  /** Whether to regenerate entity pages. Default: true */
  updateEntityPages?: boolean;
}

// =============================================================================
// Reflect Job
// =============================================================================

/**
 * Run the memory reflect job.
 * This is designed to be called from a cron job or on-demand.
 */
export async function runReflect(
  memory: Memory,
  options: ReflectOptions = {},
): Promise<ReflectResult> {
  const startTime = Date.now();
  const namespace = options.namespace ?? "zee";
  const duplicateThreshold = options.duplicateThreshold ?? 0.92;
  const staleDays = options.staleDays ?? 30;
  const staleDecay = options.staleDecay ?? 0.02;
  const scanLimit = options.scanLimit ?? 200;
  const updateEntityPages = options.updateEntityPages ?? true;

  const result: ReflectResult = {
    duplicatesMerged: 0,
    beliefsDecayed: 0,
    entityPagesUpdated: 0,
    staleBeliefs: 0,
    durationMs: 0,
  };

  log.info("Reflect job starting", { namespace, scanLimit });

  try {
    // Phase 1: Deduplicate similar facts
    result.duplicatesMerged = await deduplicateFacts(memory, namespace, scanLimit, duplicateThreshold);

    // Phase 2: Decay stale beliefs
    const staleResult = await decayStaleBeliefs(memory, namespace, scanLimit, staleDays, staleDecay);
    result.beliefsDecayed = staleResult.decayed;
    result.staleBeliefs = staleResult.stale;

    // Phase 3: Update entity pages
    if (updateEntityPages) {
      const pages = await generateEntityPages(memory, { namespace });
      result.entityPagesUpdated = pages.length;
    }
  } catch (err) {
    log.error("Reflect job failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  result.durationMs = Date.now() - startTime;
  log.info("Reflect job completed", result);
  return result;
}

// =============================================================================
// Phase 1: Deduplicate Facts
// =============================================================================

async function deduplicateFacts(
  memory: Memory,
  namespace: string,
  limit: number,
  threshold: number,
): Promise<number> {
  let merged = 0;

  try {
    // Get recent facts
    const facts = await memory.agenticSearch({
      domain: "*",
      namespace,
      limit,
    });

    const factEntries = facts
      .filter((r) => r.entry.category === "fact" && !r.entry.superseded)
      .map((r) => r.entry);

    if (factEntries.length < 2) return 0;

    // Check each fact against others for near-duplicates
    const superseded = new Set<string>();

    for (let i = 0; i < factEntries.length; i++) {
      if (superseded.has(factEntries[i].id)) continue;

      const entry = factEntries[i];
      // Search for similar entries
      const similar = await memory.search({
        query: entry.content,
        namespace,
        limit: 5,
        threshold,
        category: "fact",
      });

      for (const match of similar) {
        if (match.entry.id === entry.id) continue;
        if (superseded.has(match.entry.id)) continue;
        if (match.score < threshold) continue;

        // Found a near-duplicate. Keep the newer one (or the one with higher confidence).
        const keepEntry = (entry.confidence ?? 0.5) >= (match.entry.confidence ?? 0.5)
          ? entry
          : match.entry;
        const discardEntry = keepEntry.id === entry.id ? match.entry : entry;

        // Mark the duplicate as superseded
        try {
          await memory.delete(discardEntry.id);
          superseded.add(discardEntry.id);
          merged++;
        } catch {
          // Non-fatal
        }
      }
    }
  } catch (err) {
    log.debug("Deduplication phase failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return merged;
}

// =============================================================================
// Phase 2: Decay Stale Beliefs
// =============================================================================

async function decayStaleBeliefs(
  memory: Memory,
  namespace: string,
  limit: number,
  staleDays: number,
  decayAmount: number,
): Promise<{ decayed: number; stale: number }> {
  let decayed = 0;
  let stale = 0;

  try {
    const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

    // Get entries with confidence tracking
    const results = await memory.agenticSearch({
      domain: "*",
      namespace,
      limit,
    });

    for (const result of results) {
      const entry = result.entry;
      if (entry.confidence === undefined) continue;
      if (entry.superseded) continue;

      const lastChallenged = entry.lastChallenged ?? entry.createdAt;
      if (lastChallenged > cutoff) continue;

      // This belief is stale
      stale++;

      // Only decay if confidence is above a minimum threshold
      if (entry.confidence > 0.1) {
        try {
          await memory.challengeBelief(
            entry.id,
            `Auto-decayed: not challenged in ${staleDays}+ days`,
            decayAmount,
          );
          decayed++;
        } catch {
          // Non-fatal
        }
      }
    }
  } catch (err) {
    log.debug("Stale belief decay failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { decayed, stale };
}

// =============================================================================
// Cron Job Registration Helper
// =============================================================================

/**
 * Returns the cron job definition for the reflect job.
 * This can be registered with the cron service.
 */
export function getReflectJobDefinition(options?: {
  /** Cron expression. Default: daily at 3am */
  schedule?: string;
  /** Timezone. Default: system timezone */
  timezone?: string;
}): {
  name: string;
  schedule: { kind: "cron"; expr: string; tz?: string };
  payload: { kind: "agentTurn"; message: string };
} {
  return {
    name: "memory-reflect",
    schedule: {
      kind: "cron",
      expr: options?.schedule ?? "0 3 * * *",
      tz: options?.timezone,
    },
    payload: {
      kind: "agentTurn",
      message: [
        "Run the memory reflect job to curate and maintain the knowledge base.",
        "Use zee:memory-reflect to execute the reflection cycle.",
        "Report the results briefly.",
      ].join(" "),
    },
  };
}
