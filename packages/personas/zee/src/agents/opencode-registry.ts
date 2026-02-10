import type { ModelApi, ModelDefinitionConfig, ModelProviderConfig } from "../config/types.models.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function listOpencodeProviderRegistry(): Promise<unknown> {
  // Use a computed specifier so tsc doesn't try to typecheck zee-core's Bun-oriented source tree.
  // This module is executed in environments that can import @zee/core modules (Bun/bundled).
  const specifier = "@zee/core/provider-registry";
  const mod = await import(specifier);
  const fn = (mod as { listProviderRegistry?: unknown }).listProviderRegistry;
  if (typeof fn !== "function") {
    throw new Error(`Invalid module export for ${specifier}: missing listProviderRegistry()`);
  }
  return (fn as () => Promise<unknown>)();
}

function resolveProviderApi(params: { providerId: string; npmHint?: string }): ModelApi {
  const providerId = params.providerId.trim().toLowerCase();
  const npm = (params.npmHint ?? "").trim().toLowerCase();

  if (providerId === "github-copilot") return "github-copilot";
  if (providerId === "amazon-bedrock") return "bedrock-converse-stream";

  if (npm.includes("anthropic") || providerId.includes("anthropic")) {
    return "anthropic-messages";
  }
  if (npm.includes("@ai-sdk/google") || providerId.includes("google") || providerId.includes("gemini")) {
    return "google-generative-ai";
  }

  if (providerId === "openai" || npm.includes("@ai-sdk/openai")) {
    return "openai-responses";
  }

  return "openai-completions";
}

function resolveModelInput(model: UnknownRecord): Array<"text" | "image"> {
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {};
  const input = isRecord(capabilities.input) ? capabilities.input : {};
  const supportsImage = input.image === true;
  return supportsImage ? ["text", "image"] : ["text"];
}

function resolveModelReasoning(model: UnknownRecord): boolean {
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {};
  return capabilities.reasoning === true;
}

function resolveModelHeaders(model: UnknownRecord): Record<string, string> | undefined {
  const headers = model.headers;
  if (!isRecord(headers)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveModelCost(model: UnknownRecord): ModelDefinitionConfig["cost"] {
  const cost = isRecord(model.cost) ? model.cost : {};
  const cache = isRecord(cost.cache) ? cost.cache : {};
  return {
    input: toNumberOrNull(cost.input) ?? 0,
    output: toNumberOrNull(cost.output) ?? 0,
    cacheRead: toNumberOrNull(cache.read) ?? 0,
    cacheWrite: toNumberOrNull(cache.write) ?? 0,
  };
}

function resolveModelContextWindow(model: UnknownRecord): number {
  const limit = isRecord(model.limit) ? model.limit : {};
  const ctx = toNumberOrNull(limit.context);
  return ctx && ctx > 0 ? ctx : 128000;
}

function resolveModelMaxTokens(model: UnknownRecord, contextWindow: number): number {
  const limit = isRecord(model.limit) ? model.limit : {};
  const out = toNumberOrNull(limit.output);
  if (out && out > 0) return out;
  return Math.min(8192, contextWindow);
}

function resolveModelApiUrl(model: UnknownRecord): string {
  const api = isRecord(model.api) ? model.api : {};
  return toStringOrEmpty(api.url).trim();
}

function resolveModelApiNpm(model: UnknownRecord): string {
  const api = isRecord(model.api) ? model.api : {};
  return toStringOrEmpty(api.npm).trim();
}

function toZeeModelDefinition(params: {
  providerId: string;
  model: UnknownRecord;
}): ModelDefinitionConfig | null {
  const id = toStringOrEmpty(params.model.id).trim();
  if (!id) return null;
  const name = toStringOrEmpty(params.model.name).trim() || id;

  const contextWindow = resolveModelContextWindow(params.model);
  const npm = resolveModelApiNpm(params.model);
  const api = resolveProviderApi({ providerId: params.providerId, npmHint: npm });

  return {
    id,
    name,
    api,
    reasoning: resolveModelReasoning(params.model),
    input: resolveModelInput(params.model),
    cost: resolveModelCost(params.model),
    contextWindow,
    maxTokens: resolveModelMaxTokens(params.model, contextWindow),
    headers: resolveModelHeaders(params.model),
  };
}

function resolveProviderBaseUrl(models: UnknownRecord[]): string | null {
  for (const model of models) {
    const url = resolveModelApiUrl(model);
    if (url) return url;
  }
  return null;
}

function resolveProviderApiKeyHint(entry: UnknownRecord): string | undefined {
  const env = entry.env;
  if (!Array.isArray(env)) return undefined;
  const first = env.find((k): k is string => typeof k === "string" && Boolean(k.trim()));
  return first?.trim() || undefined;
}

export async function resolveZeeProvidersFromOpencodeRegistry(): Promise<
  Record<string, ModelProviderConfig>
> {
  const rawRegistry = await listOpencodeProviderRegistry();
  if (!isRecord(rawRegistry)) return {};

  const providers: Record<string, ModelProviderConfig> = {};
  for (const [providerIdRaw, entryRaw] of Object.entries(rawRegistry)) {
    const providerId = providerIdRaw.trim();
    if (!providerId) continue;
    if (!isRecord(entryRaw)) continue;

    const modelsRaw = isRecord(entryRaw.models) ? entryRaw.models : {};
    const modelsEntries = Object.values(modelsRaw).filter(isRecord);
    const baseUrl = resolveProviderBaseUrl(modelsEntries);
    if (!baseUrl) continue;

    const models = modelsEntries
      .map((model) => toZeeModelDefinition({ providerId, model }))
      .filter((m): m is ModelDefinitionConfig => Boolean(m));
    if (models.length === 0) continue;

    const api: ModelApi = models[0]?.api ?? resolveProviderApi({ providerId });
    providers[providerId] = {
      baseUrl,
      apiKey: resolveProviderApiKeyHint(entryRaw),
      api,
      models,
    };
  }

  return providers;
}
