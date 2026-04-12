import type { EmbeddingProviderType, EmbeddingTaskType } from "../memory/types";

export type EmbeddingProfileConfig = {
  provider: EmbeddingProviderType;
  model: string;
  dimensions?: number;
  baseUrl?: string;
  taskType?: EmbeddingTaskType;
  title?: string;
};

export const EMBEDDING_PROFILES: Record<string, EmbeddingProfileConfig> = {
  "local/zee-local-hash-embedding-v1": {
    provider: "local",
    model: "zee-local-hash-embedding-v1",
    dimensions: 384,
  },
};

export function resolveEmbeddingProfile(
  profile?: string
): EmbeddingProfileConfig | undefined {
  if (!profile) return undefined;
  return EMBEDDING_PROFILES[profile];
}
