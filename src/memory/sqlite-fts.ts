/**
 * SQLite Full-Text Search (FTS5) for Memory
 *
 * Provides BM25-based keyword search as a complement to local vector search.
 * SQLite FTS is used as a fast-path for exact/keyword queries and combined
 * with vector results in hybrid search mode.
 *
 * The FTS index mirrors local vector data - on store, entries are indexed in both.
 * On search, FTS results are merged with vector results using configurable weights.
 *
 * @module memory/sqlite-fts
 */

import path from "path"
import fs from "node:fs"
import { Log } from "../../packages/zee/src/util/log"
import { resolveStateDir } from "../../packages/zee/src/global/dirs"

const log = Log.create({ service: "memory:fts" })

type SqliteStatement<Row = unknown> = {
  all: (...params: unknown[]) => Row[]
  get: (...params: unknown[]) => Row | undefined
  run: (...params: unknown[]) => unknown
}

type SqliteDb = {
  exec: (sql: string) => unknown
  run: (sql: string, params?: unknown[]) => unknown
  query: <Row = unknown, _Params extends unknown[] = unknown[]>(sql: string) => SqliteStatement<Row>
  transaction: <T extends (...args: unknown[]) => unknown>(fn: T) => T
  close: () => void
}

async function createSqliteDatabase(dbPath: string): Promise<SqliteDb> {
  try {
    const module = await import("bun:sqlite")
    const Database = (module as { Database: new (path: string) => SqliteDb }).Database
    return new Database(dbPath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`SQLite FTS requires bun:sqlite (${reason})`)
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_DB_DIR = path.join(resolveStateDir(), "memory")
const DEFAULT_DB_NAME = "fts.sqlite"

export interface FtsConfig {
  /** Directory for the SQLite database file */
  dbDir?: string
  /** Database file name */
  dbName?: string
}

// ---------------------------------------------------------------------------
// FTS Entry
// ---------------------------------------------------------------------------

export interface FtsEntry {
  /** Unique ID matching the local vector point ID */
  id: string
  /** Searchable text content */
  content: string
  /** Optional summary (also searchable) */
  summary?: string
  /** Memory category for filtering */
  category?: string
  /** Namespace for filtering */
  namespace?: string
  /** Context tree: domain */
  domain?: string
  /** Context tree: topic */
  topic?: string
  /** Context tree: subtopic */
  subtopic?: string
  /** Timestamp (epoch ms) */
  createdAt?: number
}

export interface FtsSearchResult {
  id: string
  content: string
  summary?: string
  category?: string
  namespace?: string
  domain?: string
  topic?: string
  subtopic?: string
  createdAt?: number
  /** BM25 rank converted to a 0-1 score */
  score: number
  /** Raw BM25 rank from SQLite (lower is better) */
  rank: number
  /** Snippet with match highlights */
  snippet?: string
}

// ---------------------------------------------------------------------------
// FTS Store
// ---------------------------------------------------------------------------

export class SqliteFtsStore {
  private db: SqliteDb | null = null
  private readonly dbPath: string
  private initialized = false

  constructor(config: FtsConfig = {}) {
    const dir = config.dbDir ?? DEFAULT_DB_DIR
    const name = config.dbName ?? DEFAULT_DB_NAME
    this.dbPath = path.join(dir, name)
  }

  async init(): Promise<void> {
    if (this.initialized) return

    // Ensure directory exists
    const dir = path.dirname(this.dbPath)
    fs.mkdirSync(dir, { recursive: true })

    this.db = await createSqliteDatabase(this.dbPath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")

    // Create FTS5 virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        content,
        summary,
        category UNINDEXED,
        namespace UNINDEXED,
        domain UNINDEXED,
        topic UNINDEXED,
        subtopic UNINDEXED,
        created_at UNINDEXED,
        tokenize = 'porter unicode61'
      )
    `)

    // Metadata table for tracking indexed entries
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_meta (
        id TEXT PRIMARY KEY,
        indexed_at INTEGER NOT NULL
      )
    `)

    this.initialized = true
    log.info("SQLite FTS initialized", { path: this.dbPath })
  }

  /**
   * Index an entry for full-text search.
   * Upserts: if the ID already exists, it is replaced.
   */
  index(entry: FtsEntry): void {
    if (!this.db) throw new Error("FTS not initialized")

    const tx = this.db.transaction(() => {
      // Delete existing if present
      this.db!.run("DELETE FROM memory_fts WHERE id = ?", [entry.id])
      this.db!.run("DELETE FROM memory_meta WHERE id = ?", [entry.id])

      // Insert into FTS
      this.db!.run(
        `INSERT INTO memory_fts (id, content, summary, category, namespace, domain, topic, subtopic, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.content,
          entry.summary ?? "",
          entry.category ?? "",
          entry.namespace ?? "default",
          entry.domain ?? "",
          entry.topic ?? "",
          entry.subtopic ?? "",
          entry.createdAt ?? Date.now(),
        ],
      )

      // Track in metadata
      this.db!.run("INSERT INTO memory_meta (id, indexed_at) VALUES (?, ?)", [
        entry.id,
        Date.now(),
      ])
    })

    tx()
  }

  /**
   * Batch index multiple entries.
   */
  indexBatch(entries: FtsEntry[]): void {
    if (!this.db) throw new Error("FTS not initialized")
    if (!entries.length) return

    const tx = this.db.transaction(() => {
      for (const entry of entries) {
        this.db!.run("DELETE FROM memory_fts WHERE id = ?", [entry.id])
        this.db!.run("DELETE FROM memory_meta WHERE id = ?", [entry.id])

        this.db!.run(
          `INSERT INTO memory_fts (id, content, summary, category, namespace, domain, topic, subtopic, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.content,
            entry.summary ?? "",
            entry.category ?? "",
            entry.namespace ?? "default",
            entry.domain ?? "",
            entry.topic ?? "",
            entry.subtopic ?? "",
            entry.createdAt ?? Date.now(),
          ],
        )

        this.db!.run("INSERT INTO memory_meta (id, indexed_at) VALUES (?, ?)", [
          entry.id,
          Date.now(),
        ])
      }
    })

    tx()
  }

  /**
   * Search using BM25 full-text matching.
   */
  search(query: string, options: FtsSearchOptions = {}): FtsSearchResult[] {
    if (!this.db) throw new Error("FTS not initialized")

    const ftsQuery = buildFtsQuery(query)
    if (!ftsQuery) return []

    const limit = options.limit ?? 20
    const includeSnippets = options.includeSnippets ?? false
    const conditions: string[] = []
    const params: (string | number)[] = [ftsQuery]

    if (options.namespace) {
      conditions.push("namespace = ?")
      params.push(options.namespace)
    }
    if (options.category) {
      conditions.push("category = ?")
      params.push(options.category)
    }
    if (options.domain) {
      conditions.push("domain = ?")
      params.push(options.domain)
    }
    if (options.topic) {
      conditions.push("topic = ?")
      params.push(options.topic)
    }
    if (options.subtopic) {
      conditions.push("subtopic = ?")
      params.push(options.subtopic)
    }
    if (options.timeRange?.start !== undefined) {
      conditions.push("created_at >= ?")
      params.push(options.timeRange.start)
    }
    if (options.timeRange?.end !== undefined) {
      conditions.push("created_at <= ?")
      params.push(options.timeRange.end)
    }

    const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""

    params.push(limit)

    const snippetExpr = includeSnippets
      ? "snippet(memory_fts, 1, '<b>', '</b>', '...', 32) as snippet"
      : "NULL as snippet"

    const rows = this.db.query<FtsRow, (string | number)[]>(
      `SELECT id, content, summary, category, namespace, domain, topic, subtopic, created_at,
              rank, ${snippetExpr}
       FROM memory_fts
       WHERE memory_fts MATCH ? ${where}
       ORDER BY rank
       LIMIT ?`,
    ).all(...params)

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      summary: row.summary || undefined,
      category: row.category || undefined,
      namespace: row.namespace || undefined,
      domain: row.domain || undefined,
      topic: row.topic || undefined,
      subtopic: row.subtopic || undefined,
      createdAt: typeof row.created_at === "number" ? row.created_at : undefined,
      score: bm25RankToScore(row.rank),
      rank: row.rank,
      snippet: includeSnippets ? (row.snippet || undefined) : undefined,
    }))
  }

  /**
   * Delete an entry from the FTS index.
   */
  delete(id: string): void {
    if (!this.db) throw new Error("FTS not initialized")
    this.db.run("DELETE FROM memory_fts WHERE id = ?", [id])
    this.db.run("DELETE FROM memory_meta WHERE id = ?", [id])
  }

  /**
   * Delete multiple entries.
   */
  deleteBatch(ids: string[]): void {
    if (!this.db) throw new Error("FTS not initialized")
    if (!ids.length) return

    const tx = this.db.transaction(() => {
      for (const id of ids) {
        this.db!.run("DELETE FROM memory_fts WHERE id = ?", [id])
        this.db!.run("DELETE FROM memory_meta WHERE id = ?", [id])
      }
    })

    tx()
  }

  /**
   * Remove all indexed entries.
   */
  clear(): void {
    if (!this.db) throw new Error("FTS not initialized")
    this.db.run("DELETE FROM memory_fts")
    this.db.run("DELETE FROM memory_meta")
  }

  /**
   * Get FTS index statistics.
   */
  stats(): { totalEntries: number; dbSizeBytes: number } {
    if (!this.db) throw new Error("FTS not initialized")

    const countRow = this.db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM memory_meta",
    ).get()

    let dbSizeBytes = 0
    try {
      const stat = fs.statSync(this.dbPath)
      dbSizeBytes = stat.size
    } catch {
      // file may not exist yet
    }

    return {
      totalEntries: countRow?.count ?? 0,
      dbSizeBytes,
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
    }
  }
}

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

export interface FtsSearchOptions {
  limit?: number
  namespace?: string
  category?: string
  domain?: string
  topic?: string
  subtopic?: string
  timeRange?: { start?: number; end?: number }
  includeSnippets?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FtsRow = {
  id: string
  content: string
  summary: string
  category: string
  namespace: string
  domain: string
  topic: string
  subtopic: string
  created_at: number
  rank: number
  snippet: string | null
}

/**
 * Build an FTS5 match expression from a raw query string.
 * Tokenizes the input and joins with AND for stricter matching.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? []
  if (tokens.length === 0) return null
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`)
  return quoted.join(" AND ")
}

/**
 * Convert BM25 rank (lower is better) to a 0-1 score (higher is better).
 */
export function bm25RankToScore(rank: number): number {
  // SQLite FTS5 bm25() returns negative values where more negative = better match
  const absRank = Math.abs(Number.isFinite(rank) ? rank : 0)
  return absRank / (1 + absRank)
}
