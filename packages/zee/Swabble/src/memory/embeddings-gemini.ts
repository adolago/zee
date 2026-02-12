import { isTruthyEnvValue } from "../infra/env.js";
import { getZeeAuthApiKeySync } from "../infra/zee-auth-store.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";

export type GoogleEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  modelPath: string;
};

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GOOGLE_EMBEDDING_MODEL = "gemini-embedding-001";
const debugEmbeddings = isTruthyEnvValue(process.env.ZEE_DEBUG_MEMORY_EMBEDDINGS);
const log = createSubsystemLogger("memory/embeddings");

const debugLog = (message: string, meta?: Record<string, unknown>) => {
  if (!debugEmbeddings) return;
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  log.raw(`${message}${suffix}`);
};

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return DEFAULT_GOOGLE_EMBEDDING_MODEL;
  const withoutPrefix = trimmed.replace(/^models\//, "");
  if (withoutPrefix.startsWith("gemini/")) return withoutPrefix.slice("gemini/".length);
  if (withoutPrefix.startsWith("google/")) return withoutPrefix.slice("google/".length);
  return withoutPrefix;
}

function normalizeGeminiBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  const openAiIndex = trimmed.indexOf("/openai");
  if (openAiIndex > -1) return trimmed.slice(0, openAiIndex);
  return trimmed;
}

function buildGeminiModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export async function createGoogleEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: GoogleEmbeddingClient }> {
  const client = await resolveGoogleEmbeddingClient(options);
  const baseUrl = client.baseUrl.replace(/\/$/, "");
  const embedUrl = `${baseUrl}/${client.modelPath}:embedContent`;
  const batchUrl = `${baseUrl}/${client.modelPath}:batchEmbedContents`;

  const embedQuery = async (text: string): Promise<number[]> => {
    if (!text.trim()) return [];
    const res = await fetch(embedUrl, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`gemini embeddings failed: ${res.status} ${payload}`);
    }
    const payload = (await res.json()) as { embedding?: { values?: number[] } };
    return payload.embedding?.values ?? [];
  };

  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const requests = texts.map((text) => ({
      model: client.modelPath,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
    }));
    const res = await fetch(batchUrl, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`gemini embeddings failed: ${res.status} ${payload}`);
    }
    const payload = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
    const embeddings = Array.isArray(payload.embeddings) ? payload.embeddings : [];
    return texts.map((_, index) => embeddings[index]?.values ?? []);
  };

  return {
    provider: {
      id: "google",
      model: client.model,
      embedQuery,
      embedBatch,
    },
    client,
  };
}

export async function resolveGoogleEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<GoogleEmbeddingClient> {
  const remote = options.remote;
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const apiKey = getZeeAuthApiKeySync("google");
  if (!apiKey) {
    throw new Error("Google API key required: run `zee auth login google`");
  }

  const providerConfig = options.config.models?.providers?.google;
  const rawBaseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_GEMINI_BASE_URL;
  const baseUrl = normalizeGeminiBaseUrl(rawBaseUrl);
  const headers = Object.assign({}, providerConfig?.headers, remote?.headers) as Record<
    string,
    string
  >;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "x-goog-api-key") {
      delete headers[key];
    }
  }
  headers["Content-Type"] = "application/json";
  headers["x-goog-api-key"] = apiKey;
  const model = normalizeGeminiModel(options.model);
  const modelPath = buildGeminiModelPath(model);
  debugLog("memory embeddings: gemini client", {
    rawBaseUrl,
    baseUrl,
    model,
    modelPath,
    embedEndpoint: `${baseUrl}/${modelPath}:embedContent`,
    batchEndpoint: `${baseUrl}/${modelPath}:batchEmbedContents`,
  });
  return { baseUrl, headers, model, modelPath };
}
