import type { EmbeddingProviderType } from "../memory/types";

export type EmbeddingProfileConfig = {
  provider: EmbeddingProviderType;
  model: string;
  dimensions?: number;
  baseUrl?: string;
};

export const EMBEDDING_PROFILES: Record<string, EmbeddingProfileConfig> = {
  // Google Gemini embedding (recommended)
  "google/gemini-embedding-001": {
    provider: "google",
    model: "gemini-embedding-001",
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
