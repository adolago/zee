/**
 * Entity Page Auto-Generation
 *
 * Scans entity-tagged memories in local memory and produces
 * bank/entities/{entity-name}.md files with:
 * - Entity summary (aggregated from facts)
 * - Related facts with confidence scores
 * - Relationship graph
 *
 * Can be triggered on-demand via tool or by the reflect cron job.
 */

import type { Memory } from "./unified";
import type { MemoryEntry } from "./types";
import { getMarkdownSync, type MarkdownSyncConfig } from "./markdown-sync";
import { Log } from "../../packages/zee/src/util/log";

const log = Log.create({ service: "entity-pages" });

// =============================================================================
// Types
// =============================================================================

export interface EntityPageResult {
  entityName: string;
  factCount: number;
  filePath: string;
}

export interface GenerateEntityPagesOptions {
  /** Only regenerate pages for these entities. Default: all discovered entities. */
  entities?: string[];
  /** Namespace to search. Default: "zee" */
  namespace?: string;
  /** Maximum facts per entity page. Default: 50 */
  maxFactsPerEntity?: number;
  /** Markdown sync config override */
  markdownConfig?: MarkdownSyncConfig;
}

// =============================================================================
// Entity Discovery
// =============================================================================

/**
 * Discover all unique entity names from memory entries.
 * Scans metadata.entities arrays across all memory entries.
 */
export async function discoverEntities(
  memory: Memory,
  namespace: string = "zee",
  limit: number = 1000,
): Promise<string[]> {
  const entitySet = new Set<string>();

  // Search for entries that have entities in metadata
  // We use a broad search since there's no direct "has entities" filter
  const results = await memory.agenticSearch({
    domain: "*",
    namespace,
    limit,
  });

  for (const result of results) {
    const entities = result.entry.metadata?.entities ?? [];
    for (const entity of entities) {
      if (entity.trim()) {
        entitySet.add(entity.trim());
      }
    }
  }

  return Array.from(entitySet).sort();
}

/**
 * Get all memories related to a specific entity.
 */
export async function getEntityMemories(
  memory: Memory,
  entityName: string,
  namespace: string = "zee",
  limit: number = 50,
): Promise<MemoryEntry[]> {
  // Semantic search for the entity name
  const results = await memory.search({
    query: entityName,
    namespace,
    limit: limit * 2, // fetch extra for post-filtering
    threshold: 0.3,
  });

  // Filter to entries that actually reference this entity
  const entityLower = entityName.toLowerCase();
  const filtered = results.filter((r) => {
    const entities = r.entry.metadata?.entities ?? [];
    const hasEntity = entities.some((e) => e.toLowerCase() === entityLower);
    const contentMentions = r.entry.content.toLowerCase().includes(entityLower);
    return hasEntity || contentMentions;
  });

  return filtered.slice(0, limit).map((r) => r.entry);
}

// =============================================================================
// Page Generation
// =============================================================================

/**
 * Generate a summary from entity-related facts.
 * Uses simple aggregation (no LLM call) -- the reflect job can enhance this.
 */
function generateEntitySummary(entityName: string, entries: MemoryEntry[]): string {
  const factEntries = entries.filter((e) => e.category === "fact" || e.category === "preference");
  const decisionEntries = entries.filter((e) => e.category === "decision");

  const parts: string[] = [];

  if (factEntries.length > 0) {
    const topFacts = factEntries
      .sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
      .slice(0, 5);
    parts.push(
      `${entityName} has ${factEntries.length} known fact${factEntries.length !== 1 ? "s" : ""}. ` +
      `Key: ${topFacts.map((f) => f.content.substring(0, 80)).join("; ")}.`,
    );
  }

  if (decisionEntries.length > 0) {
    parts.push(
      `${decisionEntries.length} decision${decisionEntries.length !== 1 ? "s" : ""} recorded.`,
    );
  }

  const totalEntries = entries.length;
  const oldest = entries.reduce((min, e) => Math.min(min, e.createdAt), Infinity);
  const newest = entries.reduce((max, e) => Math.max(max, e.createdAt), 0);

  if (oldest < Infinity && newest > 0) {
    const oldestDate = new Date(oldest).toLocaleDateString();
    const newestDate = new Date(newest).toLocaleDateString();
    parts.push(`${totalEntries} total entries from ${oldestDate} to ${newestDate}.`);
  }

  return parts.join(" ") || `Entity page for ${entityName}.`;
}

/**
 * Generate entity pages for discovered entities.
 * Writes Markdown files to the bank/entities/ directory.
 */
export async function generateEntityPages(
  memory: Memory,
  options: GenerateEntityPagesOptions = {},
): Promise<EntityPageResult[]> {
  const namespace = options.namespace ?? "zee";
  const maxFacts = options.maxFactsPerEntity ?? 50;
  const mdSync = getMarkdownSync(options.markdownConfig);

  if (!mdSync.isEnabled()) {
    log.debug("Markdown sync disabled, skipping entity page generation");
    return [];
  }

  // Discover or use provided entity list
  const entities = options.entities ?? await discoverEntities(memory, namespace);

  if (entities.length === 0) {
    log.debug("No entities found for page generation");
    return [];
  }

  log.info("Generating entity pages", { count: entities.length });
  const results: EntityPageResult[] = [];

  for (const entityName of entities) {
    try {
      const entries = await getEntityMemories(memory, entityName, namespace, maxFacts);
      if (entries.length === 0) continue;

      const summary = generateEntitySummary(entityName, entries);

      const facts = entries.map((e) => ({
        content: e.content,
        confidence: e.confidence,
        date: new Date(e.createdAt).toLocaleDateString(),
      }));

      // Extract relationships from entries
      const relationships: Array<{ target: string; type: string }> = [];
      for (const entry of entries) {
        const otherEntities = (entry.metadata?.entities ?? []).filter(
          (e) => e.toLowerCase() !== entityName.toLowerCase(),
        );
        for (const other of otherEntities) {
          if (!relationships.some((r) => r.target === other)) {
            relationships.push({ target: other, type: "related_to" });
          }
        }
      }

      mdSync.writeEntityPage(entityName, { summary, facts, relationships });

      results.push({
        entityName,
        factCount: facts.length,
        filePath: mdSync.entityPagePath(entityName),
      });
    } catch (err) {
      log.debug("Failed to generate entity page", {
        entity: entityName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("Entity pages generated", { count: results.length });
  return results;
}
