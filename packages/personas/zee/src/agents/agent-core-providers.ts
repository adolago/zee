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

type AgentCoreProviderEntry = {
  options?: {
    baseURL?: string;
  };
  models?: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    contextWindow?: number;
    maxTokens?: number;
  }>;
};

type AgentCoreConfig = {
  provider?: Record<string, AgentCoreProviderEntry>;
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

  const models: ModelDefinitionConfig[] = (entry.models ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    reasoning: m.reasoning ?? false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow ?? 128000,
    maxTokens: m.maxTokens ?? 8192,
  }));

  return {
    baseUrl,
    api: "openai-completions",
    models,
  };
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
