/**
 * Reads provider configuration from agent-core's config file.
 * This makes agent-core the single source of truth for model providers.
 *
 * Agent-core config: ~/.local/src/agent-core/.agent-core/agent-core.jsonc
 * or resolved via AGENT_CORE_ROOT environment variable.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSON5 from "json5";

import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { ProviderConfig } from "./models-config.providers.js";
import { log } from "./auth-profiles/constants.js";
import { DEFAULT_PROVIDER } from "./defaults.js";

const AGENT_CORE_CONFIG_PATHS = [
  // Environment override
  process.env.AGENT_CORE_ROOT
    ? path.join(process.env.AGENT_CORE_ROOT, ".agent-core", "agent-core.jsonc")
    : null,
  // Standard development location
  path.join(os.homedir(), ".local", "src", "agent-core", ".agent-core", "agent-core.jsonc"),
  // Current working directory
  path.join(process.cwd(), ".agent-core", "agent-core.jsonc"),
].filter(Boolean) as string[];

type AgentCoreModelEntry = {
  id?: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  limit?: {
    context?: number;
    output?: number;
  };
  modalities?: {
    input?: string[];
  };
  input?: string[];
};

type AgentCoreProviderEntry = {
  options?: {
    baseURL?: string;
  };
  models?: AgentCoreModelEntry[] | Record<string, AgentCoreModelEntry>;
};

type AgentCoreModelConfig =
  | string
  | {
      primary?: string;
      fallbacks?: string[];
    };

type AgentCoreAgentEntry = {
  model?: AgentCoreModelConfig;
};

type AgentCoreConfig = {
  provider?: Record<string, AgentCoreProviderEntry>;
  model?: string;
  agent?: Record<string, AgentCoreAgentEntry>;
  agents?: {
    defaults?: {
      model?: AgentCoreModelConfig;
    };
  };
};

let cachedConfig: AgentCoreConfig | null = null;
let lastReadAt = 0;
const CACHE_TTL_MS = 30_000;

function readAgentCoreConfig(): AgentCoreConfig | null {
  const now = Date.now();
  if (cachedConfig && now - lastReadAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  for (const configPath of AGENT_CORE_CONFIG_PATHS) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON5.parse(raw) as AgentCoreConfig;
      cachedConfig = parsed;
      lastReadAt = now;
      log.debug("loaded agent-core config", { path: configPath });
      return parsed;
    } catch (err) {
      log.debug("failed to read agent-core config", { path: configPath, error: String(err) });
    }
  }

  return null;
}

function convertToZeeProvider(
  providerId: string,
  entry: AgentCoreProviderEntry,
): ProviderConfig | null {
  const baseUrl = entry.options?.baseURL;
  // baseUrl is required for ProviderConfig
  if (!baseUrl) {
    return null;
  }

  const rawModels = normalizeAgentCoreModels(entry.models);
  const models: ModelDefinitionConfig[] = rawModels
    .map((m) => toZeeModelDefinition(m))
    .filter((m): m is ModelDefinitionConfig => Boolean(m));

  return {
    baseUrl,
    api: "openai-completions",
    models,
  };
}

type ModelRef = { provider: string; model: string };

function normalizeAgentCoreModels(
  models?: AgentCoreProviderEntry["models"],
): AgentCoreModelEntry[] {
  if (Array.isArray(models)) return models;
  if (!models || typeof models !== "object") return [];
  return Object.entries(models).map(([key, value]) => {
    const entry = value ?? {};
    if (entry.id) return entry;
    return { ...entry, id: key };
  });
}

function resolveInputModes(model: AgentCoreModelEntry): Array<"text" | "image"> {
  const raw = Array.isArray(model.input)
    ? model.input
    : Array.isArray(model.modalities?.input)
      ? model.modalities.input
      : [];
  const modes = new Set<"text" | "image">(["text"]);
  for (const entry of raw) {
    if (String(entry).toLowerCase() === "image") {
      modes.add("image");
    }
  }
  return Array.from(modes);
}

function resolveContextWindow(model: AgentCoreModelEntry): number {
  const candidate = model.limit?.context ?? model.contextWindow;
  if (typeof candidate === "number" && candidate > 0) return candidate;
  return 128000;
}

function resolveMaxTokens(model: AgentCoreModelEntry, contextWindow: number): number {
  const candidate = model.limit?.output ?? model.maxTokens;
  if (typeof candidate === "number" && candidate > 0) return candidate;
  return Math.min(8192, contextWindow);
}

function toZeeModelDefinition(model: AgentCoreModelEntry): ModelDefinitionConfig | null {
  const id = String(model.id ?? "").trim();
  if (!id) return null;
  const contextWindow = resolveContextWindow(model);
  return {
    id,
    name: model.name?.trim() || id,
    reasoning: model.reasoning ?? false,
    input: resolveInputModes(model),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: resolveMaxTokens(model, contextWindow),
  };
}

function resolvePrimaryModelRef(raw?: AgentCoreModelConfig): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim() || null;
  const primary = raw.primary?.trim();
  return primary || null;
}

function parseModelRef(raw: string): ModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return { provider: DEFAULT_PROVIDER, model: trimmed };
  }
  const provider = trimmed.slice(0, slash).trim();
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

export function resolveAgentCoreDefaultModelRef(params?: {
  agentId?: string;
}): ModelRef | null {
  const config = readAgentCoreConfig();
  if (!config) return null;

  const requestedId = params?.agentId?.trim();
  const normalizedId = requestedId?.toLowerCase();

  const resolveAgentModel = (agentId?: string): string | null => {
    if (!agentId) return null;
    const entry = config.agent?.[agentId] ?? config.agent?.[agentId.toLowerCase()];
    return resolvePrimaryModelRef(entry?.model);
  };

  const candidates: Array<string | null> = [];
  if (normalizedId) {
    candidates.push(resolveAgentModel(normalizedId));
  } else {
    candidates.push(resolveAgentModel("zee"));
  }
  candidates.push(resolvePrimaryModelRef(config.model));
  candidates.push(resolvePrimaryModelRef(config.agents?.defaults?.model));

  for (const raw of candidates) {
    if (!raw) continue;
    const parsed = parseModelRef(raw);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Resolves providers from agent-core's configuration.
 * These providers will be merged with zee's implicit providers,
 * with agent-core taking precedence.
 */
export function resolveAgentCoreProviders(): Record<string, ProviderConfig> {
  const config = readAgentCoreConfig();
  if (!config?.provider) return {};

  const providers: Record<string, ProviderConfig> = {};

  for (const [providerId, entry] of Object.entries(config.provider)) {
    const converted = convertToZeeProvider(providerId, entry);
    if (converted) {
      providers[providerId] = converted;
      log.debug("resolved agent-core provider", { providerId });
    }
  }

  return providers;
}

/**
 * Clears the cached config, forcing a re-read on next access.
 */
export function clearAgentCoreConfigCache(): void {
  cachedConfig = null;
  lastReadAt = 0;
}
