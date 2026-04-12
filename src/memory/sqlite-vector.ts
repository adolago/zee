/**
 * Local SQLite vector storage for Zee memory.
 *
 * This provides the small storage surface used by the unified memory layer while
 * keeping all state inside Zee's normal data root.
 */

import fs from "node:fs";
import path from "node:path";
import type { VectorStorage } from "./types";
import { Log } from "../../packages/zee/src/util/log";
import { resolveStateDir, resolveUserPath } from "../../packages/zee/src/global/dirs";
import { LOCAL_MEMORY_COLLECTION } from "../config/constants";

const log = Log.create({ service: "memory:sqlite-vector" });

type SqliteStatement<Row = unknown> = {
  all: (...params: unknown[]) => Row[];
  get: (...params: unknown[]) => Row | undefined;
  run: (...params: unknown[]) => unknown;
};

type SqliteDb = {
  exec: (sql: string) => unknown;
  query: <Row = unknown, _Params extends unknown[] = unknown[]>(sql: string) => SqliteStatement<Row>;
  close: () => void;
};

type PointRow = {
  id: string;
  vector_json: string;
  payload_json: string;
  rowid: number;
};

type CollectionRow = {
  dimension: number;
};

type FilterCondition = {
  key?: string;
  match?: { value: string | number | boolean };
  range?: { lt?: number; gt?: number; lte?: number; gte?: number };
  is_null?: { key: string };
  should?: FilterCondition[];
};

async function createSqliteDatabase(dbPath: string): Promise<SqliteDb> {
  try {
    const module = await import("bun:sqlite");
    const Database = (module as { Database: new (path: string) => SqliteDb }).Database;
    return new Database(dbPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite vector memory requires bun:sqlite (${reason})`);
  }
}

function defaultDbPath(): string {
  const direct = process.env.ZEE_MEMORY_DB_PATH?.trim();
  if (direct) return resolveUserPath(direct);
  const memoryDir = process.env.ZEE_MEMORY_DIR?.trim()
    ? resolveUserPath(process.env.ZEE_MEMORY_DIR)
    : path.join(resolveStateDir(), "memory");
  return path.join(memoryDir, "memory.sqlite");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
  } catch {
    return [];
  }
}

function nestedValue(payload: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = payload;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function exactMatches(actual: unknown, expected: string | number | boolean): boolean {
  if (Array.isArray(actual)) return actual.some((item) => exactMatches(item, expected));
  return actual === expected;
}

function conditionMatches(condition: FilterCondition, payload: Record<string, unknown>): boolean {
  if (condition.should?.length) {
    return condition.should.some((item) => conditionMatches(item, payload));
  }

  if (condition.is_null?.key) {
    const value = nestedValue(payload, condition.is_null.key);
    return value === undefined || value === null;
  }

  if (!condition.key) return true;
  const value = nestedValue(payload, condition.key);

  if (condition.match) {
    return exactMatches(value, condition.match.value);
  }

  if (condition.range) {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const range = condition.range;
    if (range.lt !== undefined && !(value < range.lt)) return false;
    if (range.gt !== undefined && !(value > range.gt)) return false;
    if (range.lte !== undefined && !(value <= range.lte)) return false;
    if (range.gte !== undefined && !(value >= range.gte)) return false;
  }

  return true;
}

function filterMatches(filter: Record<string, unknown> | undefined, payload: Record<string, unknown>): boolean {
  if (!filter) return true;

  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;

      if (Array.isArray(obj.$in)) {
        if (!obj.$in.some((item) => exactMatches(nestedValue(payload, key), item as string | number | boolean))) {
          return false;
        }
        continue;
      }

      if (Array.isArray(obj.$should)) {
        if (!(obj.$should as FilterCondition[]).some((condition) => conditionMatches(condition, payload))) {
          return false;
        }
        continue;
      }

      const range: FilterCondition["range"] = {};
      for (const [from, to] of [
        ["lt", "lt"],
        ["$lt", "lt"],
        ["gt", "gt"],
        ["$gt", "gt"],
        ["lte", "lte"],
        ["$lte", "lte"],
        ["gte", "gte"],
        ["$gte", "gte"],
      ] as const) {
        const candidate = obj[from];
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          range[to] = candidate;
        }
      }

      if (Object.keys(range).length > 0) {
        if (!conditionMatches({ key, range }, payload)) return false;
        continue;
      }
    }

    if (!exactMatches(nestedValue(payload, key), value as string | number | boolean)) return false;
  }

  return true;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class SqliteVectorStorage implements VectorStorage {
  private db: SqliteDb | null = null;
  private readonly dbPath: string;
  private readonly defaultCollection: string;
  private currentCollection: string;

  constructor(config: { collection?: string; dbPath?: string } = {}) {
    this.dbPath = config.dbPath ?? defaultDbPath();
    this.defaultCollection = config.collection ?? LOCAL_MEMORY_COLLECTION;
    this.currentCollection = this.defaultCollection;
  }

  private async database(): Promise<SqliteDb> {
    if (this.db) return this.db;

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = await createSqliteDatabase(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_collections (
        name TEXT PRIMARY KEY,
        dimension INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_points (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS memory_points_collection_idx ON memory_points(collection)");
    return this.db;
  }

  async init(): Promise<void> {
    await this.database();
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    const db = await this.database();
    const existing = db
      .query<CollectionRow, [string]>("SELECT dimension FROM memory_collections WHERE name = ?")
      .get(name);
    if (existing && existing.dimension !== dimension) {
      throw new Error(`SQLite memory collection "${name}" has dimension ${existing.dimension}, expected ${dimension}.`);
    }
    if (!existing) {
      db.query("INSERT INTO memory_collections (name, dimension, created_at) VALUES (?, ?, ?)").run(
        name,
        dimension,
        Date.now(),
      );
    }
    this.currentCollection = name;
  }

  async deleteCollection(name: string): Promise<void> {
    const db = await this.database();
    db.query("DELETE FROM memory_points WHERE collection = ?").run(name);
    db.query("DELETE FROM memory_collections WHERE name = ?").run(name);
    if (this.currentCollection === name) this.currentCollection = this.defaultCollection;
  }

  async listCollections(): Promise<string[]> {
    const db = await this.database();
    return db
      .query<{ name: string }, []>("SELECT name FROM memory_collections ORDER BY name")
      .all()
      .map((row) => row.name);
  }

  async getCollectionDimension(name: string): Promise<number | null> {
    const db = await this.database();
    const row = db.query<CollectionRow, [string]>("SELECT dimension FROM memory_collections WHERE name = ?").get(name);
    return row?.dimension ?? null;
  }

  async getCollectionPointCount(name: string): Promise<number | null> {
    const db = await this.database();
    const row = db
      .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM memory_points WHERE collection = ?")
      .get(name);
    return row?.count ?? 0;
  }

  async insert(entries: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.database();
    const now = Date.now();
    const stmt = db.query(
      `INSERT INTO memory_points (collection, id, vector_json, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(collection, id) DO UPDATE SET
         vector_json = excluded.vector_json,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    );

    for (const entry of entries) {
      stmt.run(
        this.currentCollection,
        entry.id,
        JSON.stringify(entry.vector),
        JSON.stringify(entry.payload),
        now,
        now,
      );
    }
  }

  async search(
    vector: number[],
    options: { limit: number; threshold?: number; filter?: Record<string, unknown> },
  ): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
    const db = await this.database();
    const rows = db
      .query<PointRow, [string]>(
        "SELECT rowid, id, vector_json, payload_json FROM memory_points WHERE collection = ? ORDER BY rowid",
      )
      .all(this.currentCollection);

    const threshold = options.threshold ?? 0;
    return rows
      .map((row) => ({
        id: row.id,
        score: cosineSimilarity(vector, parseVector(row.vector_json)),
        payload: parseJsonObject(row.payload_json),
      }))
      .filter((point) => point.score >= threshold && filterMatches(options.filter, point.payload))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  async get(
    ids: string[],
    options?: { withVector?: boolean },
  ): Promise<Array<{ id: string; vector?: number[]; payload: Record<string, unknown> } | null>> {
    if (ids.length === 0) return [];
    const db = await this.database();
    const stmt = db.query<PointRow, [string, string]>(
      "SELECT rowid, id, vector_json, payload_json FROM memory_points WHERE collection = ? AND id = ?",
    );
    return ids.map((id) => {
      const row = stmt.get(this.currentCollection, id);
      if (!row) return null;
      return {
        id: row.id,
        vector: options?.withVector ? parseVector(row.vector_json) : undefined,
        payload: parseJsonObject(row.payload_json),
      };
    });
  }

  async update(id: string, payload: Record<string, unknown>): Promise<void> {
    const db = await this.database();
    const row = db
      .query<PointRow, [string, string]>(
        "SELECT rowid, id, vector_json, payload_json FROM memory_points WHERE collection = ? AND id = ?",
      )
      .get(this.currentCollection, id);
    if (!row) return;

    const merged = { ...parseJsonObject(row.payload_json), ...payload };
    db.query("UPDATE memory_points SET payload_json = ?, updated_at = ? WHERE collection = ? AND id = ?").run(
      JSON.stringify(merged),
      Date.now(),
      this.currentCollection,
      id,
    );
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.database();
    const stmt = db.query("DELETE FROM memory_points WHERE collection = ? AND id = ?");
    for (const id of ids) stmt.run(this.currentCollection, id);
  }

  async deleteWhere(filter: Record<string, unknown>): Promise<number> {
    const page = await this.scroll({ filter, limit: Number.MAX_SAFE_INTEGER, withPayload: false });
    await this.delete(page.points.map((point) => point.id));
    return page.points.length;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    const db = await this.database();
    if (!filter) {
      const row = db
        .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM memory_points WHERE collection = ?")
        .get(this.currentCollection);
      return row?.count ?? 0;
    }
    const rows = db
      .query<PointRow, [string]>("SELECT rowid, id, vector_json, payload_json FROM memory_points WHERE collection = ?")
      .all(this.currentCollection);
    return rows.filter((row) => filterMatches(filter, parseJsonObject(row.payload_json))).length;
  }

  async scroll(options: {
    filter?: Record<string, unknown>;
    limit?: number;
    offset?: string | number;
    withPayload?: boolean;
    withVector?: boolean;
    orderBy?: { key: string; direction?: "asc" | "desc" };
  } = {}): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown>; vector?: number[] }>;
    nextOffset?: string | number | null;
  }> {
    const db = await this.database();
    const rows = db
      .query<PointRow, [string]>(
        "SELECT rowid, id, vector_json, payload_json FROM memory_points WHERE collection = ? ORDER BY rowid",
      )
      .all(this.currentCollection)
      .filter((row) => filterMatches(options.filter, parseJsonObject(row.payload_json)));

    if (options.orderBy) {
      const direction = options.orderBy.direction === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const av = nestedValue(parseJsonObject(a.payload_json), options.orderBy!.key);
        const bv = nestedValue(parseJsonObject(b.payload_json), options.orderBy!.key);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
        return String(av ?? "").localeCompare(String(bv ?? "")) * direction;
      });
    }

    const limit = options.limit ?? 100;
    const start = typeof options.offset === "number" ? Math.max(0, options.offset) : 0;
    const slice = rows.slice(start, start + limit);
    const nextOffset = start + limit < rows.length ? start + limit : null;

    return {
      points: slice.map((row) => ({
        id: row.id,
        payload: options.withPayload === false ? {} : parseJsonObject(row.payload_json),
        vector: options.withVector ? parseVector(row.vector_json) : undefined,
      })),
      nextOffset,
    };
  }

  setCollection(name: string): void {
    this.currentCollection = name;
  }

  getCollection(): string {
    return this.currentCollection;
  }

  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}

export function resolveSqliteVectorDbPath(): string {
  return defaultDbPath();
}
