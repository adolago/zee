import fs from "node:fs/promises";
import path from "node:path";

import type { ZeeConfig } from "../config/config.js";
import type { ModelDefinitionConfig, ModelProviderConfig } from "../config/types.js";
import { resolveZeeAgentDir } from "./agent-paths.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { normalizeGoogleModelId } from "./models-config.providers.js";
import {
  DEFAULT_COPILOT_API_BASE_URL,
  resolveCopilotApiToken,
} from "../providers/github-copilot-token.js";
import { SYNTHETIC_BASE_URL, SYNTHETIC_MODEL_CATALOG, buildSyntheticModelDefinition } from "./synthetic-models.js";

type ModelsJsonPayload = {
  providers: Record<string, ModelProviderConfig>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceProvidersFromModelsJson(raw: string): Record<string, ModelProviderConfig> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    const providers = (parsed as ModelsJsonPayload).providers;
    if (!isRecord(providers)) return {};
    return providers as Record<string, ModelProviderConfig>;
  } catch {
    return {};
  }
}

function resolveGithubTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const copilot = env.COPILOT_GITHUB_TOKEN?.trim();
  if (copilot) return copilot;
  const gh = env.GH_TOKEN?.trim();
  if (gh) return gh;
  const github = env.GITHUB_TOKEN?.trim();
  if (github) return github;
  return null;
}

function resolveGithubTokenFromAuthProfiles(agentDir: string): string | null {
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const provider = "github-copilot";

  const ordered = store.order?.[provider] ?? [];
  const candidates = ordered.length > 0 ? ordered : listProfilesForProvider(store, provider);
  for (const profileId of candidates) {
    const cred = store.profiles[profileId];
    if (!cred) continue;
    if (cred.provider !== provider) continue;
    if (cred.type === "token") {
      const token = cred.token?.trim();
      if (token) return token;
    }
    if (cred.type === "api_key") {
      const key = cred.key?.trim();
      if (key) return key;
    }
    if (cred.type === "oauth") {
      const access = cred.access?.trim();
      if (access) return access;
    }
  }
  return null;
}

async function resolveGithubCopilotProviderBaseUrl(params: {
  githubToken: string;
}): Promise<string> {
  try {
    const resolved = await resolveCopilotApiToken({ githubToken: params.githubToken });
    return resolved.baseUrl;
  } catch {
    return DEFAULT_COPILOT_API_BASE_URL;
  }
}

function hasNonEmptyProviders(value: Record<string, ModelProviderConfig>): boolean {
  return Object.keys(value).length > 0;
}

function getEnvVarNameForProvider(providerId: string): string | null {
  // Used for models.json only; never write secrets.
  const key = providerId.trim().toLowerCase();
  if (key === "minimax") return "MINIMAX_API_KEY";
  if (key === "synthetic") return "SYNTHETIC_API_KEY";
  return null;
}

function envHasKey(envVar: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[envVar]?.trim());
}

function buildMinimaxModels(): ModelDefinitionConfig[] {
  // These IDs are used across the codebase (e.g., image model selection).
  return [
    {
      id: "MiniMax-M2.1",
      name: "MiniMax M2.1",
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-VL-01",
      name: "MiniMax VL 01",
      api: "openai-completions",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    },
  ];
}

function ensureModelPresent(
  models: ModelDefinitionConfig[],
  needle: { id: string; input?: Array<"text" | "image"> },
): ModelDefinitionConfig[] {
  const has = models.some((m) => String(m?.id ?? "").trim() === needle.id);
  if (has) return models;
  // Minimal definition; callers can overwrite by providing explicit model entries.
  return [
    ...models,
    {
      id: needle.id,
      name: needle.id,
      reasoning: false,
      input: needle.input ?? ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ];
}

export async function ensureZeeModelsJson(
  config?: ZeeConfig,
  agentDirOverride?: string,
): Promise<{ agentDir: string; wrote: boolean }> {
  const agentDir = agentDirOverride?.trim() ? agentDirOverride.trim() : resolveZeeAgentDir();

  const targetPath = path.join(agentDir, "models.json");

  const configProviders = (config?.models?.providers ?? {}) as Record<string, ModelProviderConfig>;
  const mode = config?.models?.mode ?? "merge";
  const existingRaw = await fs.readFile(targetPath, "utf8").catch(() => "");
  const existingProviders = mode === "merge" ? coerceProvidersFromModelsJson(existingRaw) : {};
  const providers: Record<string, ModelProviderConfig> = {
    ...existingProviders,
    ...configProviders,
  };

  // Fill missing apiKey hints from env var names (never write secrets).
  for (const [providerId, providerCfg] of Object.entries(providers)) {
    if (!providerCfg || typeof providerCfg !== "object") continue;
    const key = String((providerCfg as { apiKey?: string }).apiKey ?? "").trim();
    if (key) continue;
    const envVar = getEnvVarNameForProvider(providerId);
    if (envVar && envHasKey(envVar)) {
      (providerCfg as { apiKey?: string }).apiKey = envVar;
    }
  }

  // Provider-specific model normalizations.
  const google = providers.google;
  if (google?.models) {
    google.models = google.models.map((model) => ({
      ...model,
      id: normalizeGoogleModelId(model.id),
    }));
  }

  // MiniMax provider injection (API key via env; model list used by tools like image understanding).
  if (!providers.minimax && envHasKey("MINIMAX_API_KEY")) {
    providers.minimax = {
      baseUrl: "https://api.minimax.chat/v1",
      apiKey: "MINIMAX_API_KEY",
      api: "openai-completions",
      models: buildMinimaxModels(),
    };
  } else if (providers.minimax) {
    // Ensure the vision model is present when MiniMax is configured.
    const models = Array.isArray(providers.minimax.models) ? providers.minimax.models : [];
    providers.minimax.models = ensureModelPresent(models, {
      id: "MiniMax-VL-01",
      input: ["text", "image"],
    });
  }

  // Synthetic provider injection (Anthropic-compatible; models are static).
  if (!providers.synthetic && envHasKey("SYNTHETIC_API_KEY")) {
    providers.synthetic = {
      baseUrl: SYNTHETIC_BASE_URL,
      apiKey: "SYNTHETIC_API_KEY",
      api: "anthropic-messages",
      models: SYNTHETIC_MODEL_CATALOG.map(buildSyntheticModelDefinition),
    };
  }

  // GitHub Copilot injection (baseUrl from token exchange; does not override explicit config).
  if (!providers["github-copilot"]) {
    const githubToken =
      resolveGithubTokenFromEnv() ?? resolveGithubTokenFromAuthProfiles(agentDir);
    if (githubToken) {
      const baseUrl = await resolveGithubCopilotProviderBaseUrl({ githubToken });
      providers["github-copilot"] = {
        baseUrl,
        api: "github-copilot",
        models: [],
      };
    }
  }

  if (!hasNonEmptyProviders(providers)) {
    return { agentDir, wrote: false };
  }

  const next = `${JSON.stringify({ providers }, null, 2)}\n`;
  if (existingRaw === next) return { agentDir, wrote: false };

  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(targetPath, next, { mode: 0o600 });
  return { agentDir, wrote: true };
}
