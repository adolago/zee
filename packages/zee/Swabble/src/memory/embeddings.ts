import type { ZeeConfig } from "../config/config.js";
import {
  createGoogleEmbeddingProvider,
  type GoogleEmbeddingClient,
} from "./embeddings-gemini.js";

export type { GoogleEmbeddingClient } from "./embeddings-gemini.js";

export type EmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

export type EmbeddingProviderResult = {
  provider: EmbeddingProvider;
  requestedProvider: "google";
  google: GoogleEmbeddingClient;
};

export type EmbeddingProviderOptions = {
  config: ZeeConfig;
  agentDir?: string;
  provider?: "google";
  remote?: {
    baseUrl?: string;
    headers?: Record<string, string>;
  };
  model: string;
};

export async function createEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProviderResult> {
  const { provider, client } = await createGoogleEmbeddingProvider(options);
  return {
    provider,
    requestedProvider: "google",
    google: client,
  };
}

