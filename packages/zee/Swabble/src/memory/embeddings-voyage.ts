import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";

export type VoyageEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_VOYAGE_EMBEDDING_MODEL = "voyage-3-large";
const DEFAULT_VOYAGE_BASE_URL = "https://api.voyageai.com/v1";

function normalizeVoyageModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return DEFAULT_VOYAGE_EMBEDDING_MODEL;
  if (trimmed.startsWith("voyage/")) return trimmed.slice("voyage/".length);
  return trimmed;
}

function resolveRemoteApiKey(remoteApiKey?: string): string | undefined {
  const trimmed = remoteApiKey?.trim();
  if (!trimmed) return undefined;
  if (trimmed === "VOYAGE_API_KEY") {
    return process.env.VOYAGE_API_KEY?.trim();
  }
  return trimmed;
}

export async function createVoyageEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: VoyageEmbeddingClient }> {
  const client = await resolveVoyageEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;

  const embed = async (
    input: string[],
    inputType: "query" | "document",
  ): Promise<number[][]> => {
    if (input.length === 0) return [];
    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        model: client.model,
        input,
        input_type: inputType,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`voyage embeddings failed: ${res.status} ${text}`);
    }
    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const rows = payload.data ?? [];
    const sorted = rows
      .map((row, i) => ({
        embedding: row.embedding ?? [],
        index: typeof row.index === "number" ? row.index : i,
      }))
      .sort((a, b) => a.index - b.index);
    return sorted.map((row) => row.embedding);
  };

  return {
    provider: {
      id: "voyage",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text], "query");
        return vec ?? [];
      },
      embedBatch: async (texts) => await embed(texts, "document"),
    },
    client,
  };
}

export async function resolveVoyageEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<VoyageEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = resolveRemoteApiKey(remote?.apiKey);
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const apiKey = remoteApiKey
    ? remoteApiKey
    : requireApiKey(
        await resolveApiKeyForProvider({
          provider: "voyage",
          cfg: options.config,
          agentDir: options.agentDir,
        }),
        "voyage",
      );

  const providerConfig = options.config.models?.providers?.voyage;
  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_VOYAGE_BASE_URL;
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  const model = normalizeVoyageModel(options.model);

  return { baseUrl, headers, model };
}

