/**
 * Lightweight runtime config loader.
 *
 * Reads zee.jsonc for runtime-only settings (memory)
 * without invoking the full CLI config pipeline.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { Assets } from "../paths";
import type {
  EmbeddingProviderType,
  EmbeddingTaskType,
  LocalIndexBackend,
  LocalIndexDegradedReadMode,
} from "../memory/types";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  LOCAL_MEMORY_COLLECTION,
} from "./constants";
import { resolveEmbeddingProfile } from "./embedding-profiles";

type RuntimeConfig = {
  memory?: {
    backend?: "sqlite" | "file" | "redis";
    collection?: string;
    storage?: {
      collection?: string;
      dbPath?: string;
    };
    localIndex?: {
      enabled?: boolean;
      backend?: LocalIndexBackend;
      dbDir?: string;
      dbName?: string;
      degradedRead?: LocalIndexDegradedReadMode;
    };
    embedding?: {
      profile?: string;
      provider?: string;
      model?: string;
      dimensions?: number;
      dimension?: number;
      taskType?: string;
      title?: string;
      apiKey?: string;
      baseUrl?: string;
      modelPath?: string;
    };
  };
  zee?: {
    codexbar?: ZeeCodexbarConfig;
  };
};

export type MemoryStorageConfig = {
  collection?: string;
  dbPath?: string;
};

export type MemoryEmbeddingConfig = {
  provider?: EmbeddingProviderType;
  model?: string;
  dimensions?: number;
  taskType?: EmbeddingTaskType;
  title?: string;
  baseUrl?: string;
  modelPath?: string;
};

export type MemoryMigrationHints = {
  configuredCollection?: string;
  configuredEmbeddingProfile?: string;
  configuredEmbeddingModel?: string;
  configuredEmbeddingDimensions?: number;
};

export type MemoryLocalIndexConfig = {
  enabled: boolean;
  backend: LocalIndexBackend;
  dbDir?: string;
  dbName?: string;
  degradedRead: LocalIndexDegradedReadMode;
};

export type ZeeCodexbarConfig = {
  enabled?: boolean;
  command?: string | string[];
  timeoutMs?: number;
};

const USER_CONFIG_PATH = path.join(os.homedir(), ".config", "zee", "zee.jsonc");

const CONFIG_PATHS = [
  USER_CONFIG_PATH,
  Assets.config(),
];

let cachedConfig: RuntimeConfig | null = null;
let cachedUserConfig: RuntimeConfig | null | undefined;

function parseConfigFile(filePath: string): RuntimeConfig | null {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  contents = contents.replace(/\{env:([^}]+)\}/g, (_match, varName) => {
    return process.env[varName] ?? "";
  });

  const errors: ParseError[] = [];
  const parsed = parseJsonc(contents, errors, { allowTrailingComma: true });
  if (errors.length || typeof parsed !== "object" || parsed === null) {
    return null;
  }

  return parsed as RuntimeConfig;
}

function mergeConfigs(base: RuntimeConfig, override: RuntimeConfig): RuntimeConfig {
  return {
    ...base,
    ...override,
    memory: {
      ...base.memory,
      ...override.memory,
      storage: {
        ...base.memory?.storage,
        ...override.memory?.storage,
      },
      embedding: {
        ...base.memory?.embedding,
        ...override.memory?.embedding,
      },
      localIndex: {
        ...base.memory?.localIndex,
        ...override.memory?.localIndex,
      },
    },
    zee: {
      ...base.zee,
      ...override.zee,
      codexbar: {
        ...base.zee?.codexbar,
        ...override.zee?.codexbar,
      },
    },
  };
}

function loadRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) return cachedConfig;

  let merged: RuntimeConfig = {};
  for (const configPath of CONFIG_PATHS) {
    const parsed = parseConfigFile(configPath);
    if (parsed) merged = mergeConfigs(merged, parsed);
  }

  cachedConfig = merged;
  return merged;
}

function loadUserRuntimeConfig(): RuntimeConfig {
  if (cachedUserConfig !== undefined) {
    return cachedUserConfig ?? {};
  }

  cachedUserConfig = parseConfigFile(USER_CONFIG_PATH);
  return cachedUserConfig ?? {};
}

function resolveMemoryStorageConfig(config: RuntimeConfig): MemoryStorageConfig {
  const memory = config.memory ?? {};
  const storage = memory.storage ?? {};
  const collection = (storage.collection ?? memory.collection)?.trim() || undefined;
  const dbPath = storage.dbPath?.trim() || undefined;

  return {
    collection,
    dbPath,
  };
}

function resolveMemoryEmbeddingConfig(config: RuntimeConfig): MemoryEmbeddingConfig {
  const embedding = config.memory?.embedding ?? {};
  const profileConfig = resolveEmbeddingProfile(embedding.profile?.trim());
  const provider: EmbeddingProviderType = "local";
  const rawTaskType = embedding.taskType?.trim() || profileConfig?.taskType;
  const taskType = rawTaskType ? rawTaskType.toUpperCase() : undefined;

  return {
    provider,
    model: embedding.model?.trim() || EMBEDDING_MODEL,
    dimensions: embedding.dimensions ?? embedding.dimension ?? EMBEDDING_DIMENSIONS,
    taskType: taskType as EmbeddingTaskType | undefined,
    title: embedding.title?.trim() || profileConfig?.title,
    baseUrl: embedding.baseUrl?.trim() || profileConfig?.baseUrl,
    modelPath: embedding.modelPath?.trim() || undefined,
  };
}

function resolveMemoryMigrationHints(config: RuntimeConfig): MemoryMigrationHints {
  const memory = config.memory ?? {};
  const storage = memory.storage ?? {};
  const embedding = memory.embedding ?? {};
  const rawDimensions = embedding.dimensions ?? embedding.dimension;
  const dimensions =
    typeof rawDimensions === "string"
      ? Number.parseInt(rawDimensions, 10)
      : rawDimensions;

  return {
    configuredCollection:
      (storage.collection ?? memory.collection)?.trim() || undefined,
    configuredEmbeddingProfile: embedding.profile?.trim() || undefined,
    configuredEmbeddingModel: embedding.model?.trim() || undefined,
    configuredEmbeddingDimensions:
      typeof dimensions === "number" && Number.isFinite(dimensions)
        ? dimensions
        : undefined,
  };
}

function resolveMemoryLocalIndexConfig(config: RuntimeConfig): MemoryLocalIndexConfig {
  const memory = config.memory ?? {};
  const localIndex = memory.localIndex ?? {};
  const backend = (localIndex.backend ?? "sqlite-fts") as LocalIndexBackend;
  const enabled = localIndex.enabled ?? true;
  const degradedRead = (localIndex.degradedRead ?? (enabled ? "keyword_only" : "off")) as LocalIndexDegradedReadMode;
  const dbDir = localIndex.dbDir?.trim() || undefined;
  const dbName = localIndex.dbName?.trim() || undefined;

  return {
    enabled,
    backend,
    dbDir,
    dbName,
    degradedRead,
  };
}

export function getMemoryStorageConfig(): MemoryStorageConfig {
  const config = resolveMemoryStorageConfig(loadRuntimeConfig());
  return {
    ...config,
    collection: config.collection ?? LOCAL_MEMORY_COLLECTION,
  };
}

export function getMemoryEmbeddingConfig(): MemoryEmbeddingConfig {
  return resolveMemoryEmbeddingConfig(loadRuntimeConfig());
}

export function getMemoryMigrationHints(): MemoryMigrationHints {
  return resolveMemoryMigrationHints(loadRuntimeConfig());
}

export function getMemoryLocalIndexConfig(): MemoryLocalIndexConfig {
  return resolveMemoryLocalIndexConfig(loadRuntimeConfig());
}

export function getZeeCodexbarConfig(): ZeeCodexbarConfig {
  return loadRuntimeConfig().zee?.codexbar ?? {};
}

/**
 * Clear the cached runtime config.
 * Call this when environment variables may have changed since initial load.
 */
export function clearRuntimeConfigCache(): void {
  cachedConfig = null;
  cachedUserConfig = undefined;
}
