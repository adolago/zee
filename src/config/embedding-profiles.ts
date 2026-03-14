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
  // Google Gemini embedding 2 (default)
  "google/gemini-embedding-2-preview": {
    provider: "google",
    model: "gemini-embedding-2-preview",
    dimensions: 3072,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
};

export function resolveEmbeddingProfile(
  profile?: string
): EmbeddingProfileConfig | undefined {
  if (!profile) return undefined;
  return EMBEDDING_PROFILES[profile];
}
