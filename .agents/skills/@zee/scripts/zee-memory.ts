#!/usr/bin/env npx tsx
/**
 * zee Memory CLI
 *
 * Wraps memory capabilities for the zee persona.
 * Uses Qdrant-backed vector storage for semantic memory.
 *
 * Usage:
 *   npx tsx zee-memory.ts store <content> [--category <c>] [--tags <t>]
 *   npx tsx zee-memory.ts search <query> [--limit <n>] [--category <c>]
 *   npx tsx zee-memory.ts recall <id>
 *   npx tsx zee-memory.ts patterns [--category <c>]
 *   npx tsx zee-memory.ts list [--category <c>] [--limit <n>]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  QdrantMemoryStore,
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "../../../../src/memory";

// ============================================================================
// Types (mirrors agent-core memory types)
// ============================================================================

interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly model = "mock-embedding";
  readonly dimension = 384;

  async embed(text: string): Promise<number[]> {
    const vector: number[] = new Array(this.dimension).fill(0);
    for (let i = 0; i < text.length && i < this.dimension; i++) {
      vector[i] = (text.charCodeAt(i) % 100) / 100;
    }
    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return vector.map((v) => v / (mag || 1));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ============================================================================
// State Management (local JSON - in production use Qdrant)
// ============================================================================

const STATE_DIR = join(homedir(), ".zee", "zee");
const MEMORY_PATH = join(STATE_DIR, "memories.json");
const BACKEND = (process.env.ZEE_MEMORY_BACKEND || "qdrant").toLowerCase();
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const QDRANT_COLLECTION = process.env.QDRANT_MEMORY_COLLECTION || "personas_memory";

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadMemories(): MemoryEntry[] {
  if (!existsSync(MEMORY_PATH)) return [];
  return JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
}

function saveMemories(memories: MemoryEntry[]) {
  ensureStateDir();
  writeFileSync(MEMORY_PATH, JSON.stringify(memories, null, 2));
}

async function createQdrantStore(): Promise<QdrantMemoryStore | null> {
  if (BACKEND === "local") return null;

  try {
    const embedder: EmbeddingProvider = process.env.OPENAI_API_KEY
      ? createEmbeddingProvider({
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
        })
      : new MockEmbeddingProvider();

    const store = new QdrantMemoryStore(
      {
        url: QDRANT_URL,
        apiKey: QDRANT_API_KEY,
        collection: QDRANT_COLLECTION,
      },
      embedder
    );
    await store.init();
    return store;
  } catch (error) {
    console.warn("⚠️  Qdrant unavailable, falling back to local memory.");
    console.warn(error);
    return null;
  }
}

// ============================================================================
// Commands
// ============================================================================

async function storeMemory(content: string, category: string, tags: string[]) {
  const store = await createQdrantStore();
  if (store) {
    const saved = await store.save({
      content,
      category,
      source: "user",
      senderId: "zee",
      namespace: "zee",
      metadata: { tags },
    });

    console.log("\n" + "═".repeat(50));
    console.log("MEMORY STORED");
    console.log("═".repeat(50));
    console.log(`\nID: ${saved.id}`);
    console.log(`Category: ${saved.category}`);
    console.log(`Tags: ${tags.length > 0 ? tags.join(", ") : "none"}`);
    console.log(`Content: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);
    return;
  }

  const memories = loadMemories();

  const entry: MemoryEntry = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    category,
    tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
  };

  memories.push(entry);
  saveMemories(memories);

  console.log("\n" + "═".repeat(50));
  console.log("MEMORY STORED");
  console.log("═".repeat(50));
  console.log(`\nID: ${entry.id}`);
  console.log(`Category: ${category}`);
  console.log(`Tags: ${tags.length > 0 ? tags.join(", ") : "none"}`);
  console.log(`Content: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);
}

async function searchMemory(query: string, limit: number, category?: string) {
  const store = await createQdrantStore();
  if (store) {
    const results = await store.search(query, {
      limit,
      category: category || undefined,
      namespace: "zee",
    });

    console.log("\n" + "═".repeat(50));
    console.log("MEMORY SEARCH");
    console.log("═".repeat(50));
    console.log(`\nQuery: "${query}"`);
    console.log(`Limit: ${limit}`);
    if (category) console.log(`Category: ${category}`);

    if (results.length === 0) {
      console.log("\nNo memories found matching query.");
      return;
    }

    console.log(`\nFound ${results.length} memories:\n`);
    for (const mem of results) {
      console.log(`[${mem.category}] ${mem.content.slice(0, 80)}${mem.content.length > 80 ? "..." : ""}`);
      console.log(`   ID: ${mem.id}`);
      console.log(`   Score: ${mem.score.toFixed(3)}`);
      console.log(`   Created: ${new Date(mem.createdAt).toLocaleString()}`);
      console.log();
    }
    return;
  }

  const memories = loadMemories();

  console.log("\n" + "═".repeat(50));
  console.log("MEMORY SEARCH");
  console.log("═".repeat(50));
  console.log(`\nQuery: "${query}"`);
  console.log(`Limit: ${limit}`);
  if (category) console.log(`Category: ${category}`);

  // Simple keyword search (in production: semantic search via Qdrant)
  const queryLower = query.toLowerCase();
  let results = memories.filter((m) => {
    if (category && m.category !== category) return false;
    return (
      m.content.toLowerCase().includes(queryLower) ||
      m.tags.some((t) => t.toLowerCase().includes(queryLower))
    );
  });

  results = results.slice(0, limit);

  if (results.length === 0) {
    console.log("\nNo memories found matching query.");
    return;
  }

  console.log(`\nFound ${results.length} memories:\n`);
  for (const mem of results) {
    console.log(`[${mem.category}] ${mem.content.slice(0, 80)}${mem.content.length > 80 ? "..." : ""}`);
    console.log(`   ID: ${mem.id}`);
    console.log(`   Tags: ${mem.tags.join(", ") || "none"}`);
    console.log(`   Created: ${new Date(mem.createdAt).toLocaleString()}`);
    console.log();
  }
}

async function recallMemory(id: string) {
  const store = await createQdrantStore();
  if (store) {
    const memory = await store.get(id);
    if (!memory) {
      console.error(`Memory not found: ${id}`);
      return;
    }

    console.log("\n" + "═".repeat(50));
    console.log("MEMORY RECALL");
    console.log("═".repeat(50));
    console.log(`\nID: ${memory.id}`);
    console.log(`Category: ${memory.category}`);
    console.log(`Created: ${new Date(memory.createdAt).toLocaleString()}`);
    console.log(`Updated: ${new Date(memory.updatedAt).toLocaleString()}`);
    console.log(`\nContent:\n${memory.content}`);
    return;
  }

  const memories = loadMemories();
  const memory = memories.find((m) => m.id === id);

  if (!memory) {
    console.error(`Memory not found: ${id}`);
    return;
  }

  console.log("\n" + "═".repeat(50));
  console.log("MEMORY RECALL");
  console.log("═".repeat(50));
  console.log(`\nID: ${memory.id}`);
  console.log(`Category: ${memory.category}`);
  console.log(`Tags: ${memory.tags.join(", ") || "none"}`);
  console.log(`Created: ${new Date(memory.createdAt).toLocaleString()}`);
  console.log(`Updated: ${new Date(memory.updatedAt).toLocaleString()}`);
  console.log(`\nContent:\n${memory.content}`);
}

async function showPatterns(category?: string) {
  const store = await createQdrantStore();
  const memories = store
    ? await store.list({ category: category || undefined, namespace: "zee", limit: 200 })
    : loadMemories();

  console.log("\n" + "═".repeat(50));
  console.log("🧠 MEMORY PATTERNS");
  console.log("═".repeat(50));

  // Group by category
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();

  for (const mem of memories) {
    if (category && mem.category !== category) continue;

    categories.set(mem.category, (categories.get(mem.category) || 0) + 1);
    const tagList = ("metadata" in mem ? (mem.metadata?.tags as string[] | undefined) : mem.tags) || [];
    for (const tag of tagList) {
      tags.set(tag, (tags.get(tag) || 0) + 1);
    }
  }

  console.log("\nBy Category:");
  for (const [cat, count] of Array.from(categories.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log("\nTop Tags:");
  for (const [tag, count] of Array.from(tags.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`  ${tag}: ${count}`);
  }

}

async function listMemories(category?: string, limit: number = 20) {
  const store = await createQdrantStore();
  const memories = store
    ? await store.list({ category: category || undefined, namespace: "zee", limit })
    : loadMemories();

  let filtered = memories;
  if (category) {
    filtered = memories.filter((m) => m.category === category);
  }

  if (!store) {
    filtered = filtered.slice(-limit).reverse(); // Most recent first
  }

  console.log("\n" + "═".repeat(50));
  console.log("MEMORY LIST");
  console.log("═".repeat(50));
  console.log(`\nTotal memories: ${memories.length}`);
  if (category) console.log(`Filtered by: ${category}`);
  console.log(`Showing: ${filtered.length}\n`);

  for (const mem of filtered) {
    console.log(`[${mem.category}] ${mem.content.slice(0, 60)}${mem.content.length > 60 ? "..." : ""}`);
    console.log(`  ${new Date(mem.createdAt).toLocaleDateString()} | ${mem.id}`);
    console.log();
  }
}

// ============================================================================
// CLI Parser
// ============================================================================

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function getContent(): string {
  // Content is everything after command that's not a flag
  const contentParts: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++; // Skip flag value
      continue;
    }
    contentParts.push(args[i]);
  }
  return contentParts.join(" ");
}

switch (command) {
  case "store":
    const content = getContent();
    const category = getArg("category") || "note";
    const tagStr = getArg("tags") || "";
    const tags = tagStr ? tagStr.split(",").map((t) => t.trim()) : [];
    storeMemory(content, category, tags);
    break;
  case "search":
    const query = args[1];
    if (!query) {
      console.error("Usage: search <query> [--limit n] [--category c]");
    } else {
      searchMemory(query, parseInt(getArg("limit") || "10"), getArg("category"));
    }
    break;
  case "recall":
    const id = args[1];
    if (!id) {
      console.error("Usage: recall <id>");
    } else {
      recallMemory(id);
    }
    break;
  case "patterns":
    showPatterns(getArg("category"));
    break;
  case "list":
    listMemories(getArg("category"), parseInt(getArg("limit") || "20"));
    break;
  default:
    console.log(`
zee memory CLI

Commands:
  store <content> [--category c] [--tags t1,t2]  Store a memory
  search <query> [--limit n] [--category c]      Search memories
  recall <id>                                    Recall a specific memory
  patterns [--category c]                        Show memory patterns
  list [--category c] [--limit n]               List recent memories

Categories:
  conversation, fact, preference, task, decision, relationship, note, pattern

Examples:
  zee-memory.ts store "Sarah prefers oat milk" --category preference --tags sarah,coffee
  zee-memory.ts search "Sarah" --limit 5
  zee-memory.ts patterns --category preference
`);
}
