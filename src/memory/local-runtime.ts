/**
 * Install/bootstrap helpers for Zee's local memory runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, LOCAL_MEMORY_COLLECTION } from "../config/constants";
import { SqliteFtsStore } from "./sqlite-fts";
import { SqliteVectorStorage } from "./sqlite-vector";
import {
  resolveCacheDir,
  resolveStateDir,
  resolveUserPath,
  type ZeeWindowsScope,
} from "../../packages/zee/src/global/dirs";
import { createEmbeddingProvider } from "./embedding";

export type LocalMemoryScope = "user" | "machine";

export type LocalMemoryPaths = {
  scope: LocalMemoryScope;
  stateDir: string;
  cacheDir: string;
  memoryDir: string;
  vectorDbPath: string;
  ftsDbPath: string;
  modelDir: string;
  modelManifestPath: string;
};

export type LocalMemoryStatus = {
  ok: boolean;
  prepared: boolean;
  scope: LocalMemoryScope;
  paths: LocalMemoryPaths;
  sqlite: {
    available: boolean;
    vectorDbPath: string;
    ftsDbPath: string;
    error?: string;
  };
  embedding: {
    provider: "local";
    model: string;
    dimensions: number;
    prepared: boolean;
    modelManifestPath: string;
    error?: string;
  };
};

export type PrepareLocalMemoryOptions = {
  scope?: LocalMemoryScope;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

function scopedEnv(scope: LocalMemoryScope, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  if (platform !== "win32") return env;
  return { ...env, ZEE_WINDOWS_SCOPE: scope as ZeeWindowsScope };
}

function resolveScope(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): LocalMemoryScope {
  if (platform !== "win32") return "user";
  return env.ZEE_WINDOWS_SCOPE?.trim().toLowerCase() === "machine" ? "machine" : "user";
}

export function resolveLocalMemoryPaths(options: PrepareLocalMemoryOptions = {}): LocalMemoryPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const scope = options.scope ?? resolveScope(env, platform);
  const effectiveEnv = scopedEnv(scope, env, platform);
  const pathApi = platform === "win32" ? path.win32 : path.posix;

  const stateDir = resolveStateDir(effectiveEnv, platform);
  const cacheDir = resolveCacheDir(effectiveEnv, platform);
  const memoryDir = effectiveEnv.ZEE_MEMORY_DIR?.trim()
    ? resolveUserPath(effectiveEnv.ZEE_MEMORY_DIR, effectiveEnv, platform)
    : pathApi.join(stateDir, "memory");
  const vectorDbPath = effectiveEnv.ZEE_MEMORY_DB_PATH?.trim()
    ? resolveUserPath(effectiveEnv.ZEE_MEMORY_DB_PATH, effectiveEnv, platform)
    : pathApi.join(memoryDir, "memory.sqlite");
  const ftsDbPath = effectiveEnv.ZEE_MEMORY_FTS_DB_PATH?.trim()
    ? resolveUserPath(effectiveEnv.ZEE_MEMORY_FTS_DB_PATH, effectiveEnv, platform)
    : pathApi.join(memoryDir, "fts.sqlite");
  const modelDir = effectiveEnv.ZEE_MEMORY_MODEL_DIR?.trim()
    ? resolveUserPath(effectiveEnv.ZEE_MEMORY_MODEL_DIR, effectiveEnv, platform)
    : pathApi.join(cacheDir, "memory", "models");

  return {
    scope,
    stateDir,
    cacheDir,
    memoryDir,
    vectorDbPath,
    ftsDbPath,
    modelDir,
    modelManifestPath: pathApi.join(modelDir, "local-embedding-model.json"),
  };
}

function writeModelManifest(paths: LocalMemoryPaths): void {
  const manifest = {
    provider: "local",
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    preparedAt: new Date().toISOString(),
    note: "Zee memory embeddings are generated locally.",
  };
  fs.writeFileSync(paths.modelManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

async function prepareSqlite(paths: LocalMemoryPaths): Promise<void> {
  const storage = new SqliteVectorStorage({
    collection: LOCAL_MEMORY_COLLECTION,
    dbPath: paths.vectorDbPath,
  });
  await storage.createCollection(LOCAL_MEMORY_COLLECTION, EMBEDDING_DIMENSIONS);
  storage.close();

  const fts = new SqliteFtsStore({
    dbDir: path.dirname(paths.ftsDbPath),
    dbName: path.basename(paths.ftsDbPath),
  });
  await fts.init();
  fts.close();
}

async function prepareEmbedding(paths: LocalMemoryPaths): Promise<void> {
  writeModelManifest(paths);
  const provider = createEmbeddingProvider(
    {
      provider: "local",
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    },
    { noCache: true },
  );
  const vector = await provider.embed("zee local memory installation check");
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Local embedding dimension mismatch: got ${vector.length}, expected ${EMBEDDING_DIMENSIONS}`);
  }
}

export async function prepareLocalMemory(options: PrepareLocalMemoryOptions = {}): Promise<LocalMemoryStatus> {
  const paths = resolveLocalMemoryPaths(options);
  fs.mkdirSync(paths.memoryDir, { recursive: true });
  fs.mkdirSync(paths.modelDir, { recursive: true });

  let sqliteError: string | undefined;
  let embeddingError: string | undefined;

  try {
    await prepareSqlite(paths);
  } catch (error) {
    sqliteError = error instanceof Error ? error.message : String(error);
  }

  try {
    await prepareEmbedding(paths);
  } catch (error) {
    embeddingError = error instanceof Error ? error.message : String(error);
  }

  return buildLocalMemoryStatus(paths, sqliteError, embeddingError);
}

export async function getLocalMemoryStatus(options: PrepareLocalMemoryOptions = {}): Promise<LocalMemoryStatus> {
  const paths = resolveLocalMemoryPaths(options);
  return buildLocalMemoryStatus(paths);
}

function buildLocalMemoryStatus(
  paths: LocalMemoryPaths,
  sqliteError?: string,
  embeddingError?: string,
): LocalMemoryStatus {
  const vectorDbExists = fs.existsSync(paths.vectorDbPath);
  const ftsDbExists = fs.existsSync(paths.ftsDbPath);
  const manifestExists = fs.existsSync(paths.modelManifestPath);
  const sqliteAvailable = !sqliteError && vectorDbExists && ftsDbExists;
  const embeddingPrepared = !embeddingError && manifestExists;
  const ok = sqliteAvailable && embeddingPrepared;

  return {
    ok,
    prepared: ok,
    scope: paths.scope,
    paths,
    sqlite: {
      available: sqliteAvailable,
      vectorDbPath: paths.vectorDbPath,
      ftsDbPath: paths.ftsDbPath,
      error: sqliteError,
    },
    embedding: {
      provider: "local",
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      prepared: embeddingPrepared,
      modelManifestPath: paths.modelManifestPath,
      error: embeddingError,
    },
  };
}
