/**
 * Lightweight runtime config loader.
 *
 * Reads zee.json(c) for runtime-only settings (memory)
 * without invoking the full CLI config pipeline.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { Assets } from "../paths";
import type { EmbeddingProviderType } from "../memory/types";
import type { RerankerConfig } from "../memory/reranker";
import { resolveEmbeddingProfile } from "./embedding-profiles";

type RuntimeConfig = {
  memory?: {
    qdrant?: {
      url?: string;
      collection?: string;
    };
    qdrantUrl?: string;
    qdrantCollection?: string;
    embedding?: {
      profile?: string;
      provider?: string;
      model?: string;
      dimensions?: number;
      dimension?: number;
      apiKey?: string;
      baseUrl?: string;
    };
    reranker?: {
      enabled?: boolean;
      provider?: "voyage" | "vllm";
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    };
  };
  zee?: {
    splitwise?: ZeeSplitwiseConfig;
    codexbar?: ZeeCodexbarConfig;
  };
};

export type MemoryQdrantConfig = {
  url?: string;
  collection?: string;
};

export type MemoryEmbeddingConfig = {
  provider?: EmbeddingProviderType;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
};

export type ZeeSplitwiseConfig = {
  enabled?: boolean;
  token?: string;
  tokenFile?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type ZeeCodexbarConfig = {
  enabled?: boolean;
  command?: string | string[];
  timeoutMs?: number;
};

const CONFIG_PATHS = [
  path.join(os.homedir(), ".config", "zee", "zee.jsonc"),
  path.join(os.homedir(), ".config", "zee", "zee.json"),
  Assets.config(),
  path.join(Assets.root(), "zee.json"),
];

let cachedConfig: RuntimeConfig | null = null;

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
      qdrant: {
        ...base.memory?.qdrant,
        ...override.memory?.qdrant,
      },
      embedding: {
        ...base.memory?.embedding,
        ...override.memory?.embedding,
      },
      reranker: {
        ...base.memory?.reranker,
        ...override.memory?.reranker,
      },
    },
    zee: {
      ...base.zee,
      ...override.zee,
      splitwise: {
        ...base.zee?.splitwise,
        ...override.zee?.splitwise,
      },
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

function resolveMemoryQdrantConfig(config: RuntimeConfig): MemoryQdrantConfig {
  const memory = config.memory ?? {};
  const qdrant = memory.qdrant ?? {};
  const url = (qdrant.url ?? memory.qdrantUrl)?.trim() || undefined;
  const collection = (qdrant.collection ?? memory.qdrantCollection)?.trim() || undefined;

  return {
    url,
    collection,
  };
}

function resolveMemoryEmbeddingConfig(config: RuntimeConfig): MemoryEmbeddingConfig {
  const embedding = config.memory?.embedding ?? {};
  const profileConfig = resolveEmbeddingProfile(embedding.profile?.trim());
  const rawDimensions =
    embedding.dimensions ?? embedding.dimension ?? profileConfig?.dimensions;
  const dimensions =
    typeof rawDimensions === "string"
      ? Number.parseInt(rawDimensions, 10)
      : rawDimensions;

  const provider = "google";

  return {
    provider: provider as EmbeddingProviderType | undefined,
    model: embedding.model?.trim() || profileConfig?.model,
    dimensions: Number.isFinite(dimensions as number) ? (dimensions as number) : undefined,
    baseUrl: embedding.baseUrl?.trim() || profileConfig?.baseUrl,
  };
}

export function getMemoryQdrantConfig(): MemoryQdrantConfig {
  return resolveMemoryQdrantConfig(loadRuntimeConfig());
}

export function getMemoryEmbeddingConfig(): MemoryEmbeddingConfig {
  return resolveMemoryEmbeddingConfig(loadRuntimeConfig());
}

export function getMemoryRerankerConfig(): RerankerConfig {
  const config = loadRuntimeConfig();
  const reranker = config.memory?.reranker ?? {};
  
  // Environment variable overrides (highest priority)
  const envEnabled = process.env.MEMORY_RERANKER_ENABLED;
  const envProvider = process.env.MEMORY_RERANKER_PROVIDER as "voyage" | "vllm" | undefined;
  const envModel = process.env.MEMORY_RERANKER_MODEL;
  const envApiKey = process.env.VOYAGE_API_KEY || process.env.MEMORY_RERANKER_API_KEY;
  const envBaseUrl = process.env.MEMORY_RERANKER_BASE_URL || process.env.VLLM_RERANKER_URL;
  
  return {
    enabled: envEnabled !== undefined 
      ? envEnabled === "true" || envEnabled === "1"
      : (reranker.enabled ?? false),
    provider: envProvider || reranker.provider || "voyage",
    model: envModel?.trim() || reranker.model?.trim() || undefined,
    apiKey: envApiKey?.trim() || reranker.apiKey?.trim() || undefined,
    baseUrl: envBaseUrl?.trim() || reranker.baseUrl?.trim() || undefined,
  };
}

export function getZeeSplitwiseConfig(): ZeeSplitwiseConfig {
  return loadRuntimeConfig().zee?.splitwise ?? {};
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
}
