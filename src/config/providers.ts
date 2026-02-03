/**
 * Unified Provider Registry
 *
 * Central registry of all external service providers (embedding, reranking, TTS, STT, image).
 * Each provider has an auth ID that maps to the agent-core auth system.
 *
 * This enables:
 * - Single source of truth for all providers across service types
 * - Unified auth login via `agent-core auth login <provider>`
 * - Service-agnostic credentials (login once, use everywhere)
 * - Easy discovery via `agent-core auth list`
 */

// =============================================================================
// Types
// =============================================================================

export type ServiceType = "embedding" | "reranking" | "tts" | "stt" | "image";

export interface ProviderDefinition {
  /** Unique provider ID (matches auth system) */
  id: string;
  /** Display name */
  name: string;
  /** Services this provider supports */
  services: ServiceType[];
  /** Environment variable for API key */
  envKey: string;
  /** Alternative env var names */
  envAliases?: string[];
  /** Base URL (if configurable) */
  baseUrl?: string;
  /** Whether provider requires local server (vLLM, Ollama) */
  local?: boolean;
  /** Auth type */
  authType: "api" | "oauth" | "service-account" | "none";
  /** Validation endpoint (for testing credentials) */
  validateEndpoint?: string;
  /** Provider website for getting API keys */
  website?: string;
}

// =============================================================================
// Provider Registry
// =============================================================================

export const PROVIDERS: Record<string, ProviderDefinition> = {
  // --- Cloud Providers ---
  google: {
    id: "google",
    name: "Google AI",
    services: ["embedding", "stt"],
    envKey: "GOOGLE_API_KEY",
    envAliases: ["GEMINI_API_KEY"],
    authType: "api",
    validateEndpoint: "https://generativelanguage.googleapis.com/v1/models",
    website: "https://aistudio.google.com/apikey",
  },

  openai: {
    id: "openai",
    name: "OpenAI",
    services: ["embedding", "tts", "image"],
    envKey: "OPENAI_API_KEY",
    authType: "api",
    validateEndpoint: "https://api.openai.com/v1/models",
    website: "https://platform.openai.com/api-keys",
  },

  voyage: {
    id: "voyage",
    name: "Voyage AI",
    services: ["embedding", "reranking"],
    envKey: "VOYAGE_API_KEY",
    authType: "api",
    baseUrl: "https://api.voyageai.com/v1",
    validateEndpoint: "https://api.voyageai.com/v1/models",
    website: "https://dash.voyageai.com/api-keys",
  },

  elevenlabs: {
    id: "elevenlabs",
    name: "ElevenLabs",
    services: ["tts"],
    envKey: "ELEVENLABS_API_KEY",
    envAliases: ["XI_API_KEY"],
    authType: "api",
    baseUrl: "https://api.elevenlabs.io",
    validateEndpoint: "https://api.elevenlabs.io/v1/user",
    website: "https://elevenlabs.io/app/settings/api-keys",
  },

  minimax: {
    id: "minimax",
    name: "MiniMax",
    services: ["tts"],
    envKey: "MINIMAX_API_KEY",
    envAliases: ["AGENT_CORE_MINIMAX_API_KEY", "OPENCODE_MINIMAX_API_KEY"],
    authType: "api",
    baseUrl: "https://api.minimax.io/v1",
    website: "https://platform.minimaxi.com/",
  },
  "minimax-tts": {
    id: "minimax-tts",
    name: "MiniMax TTS",
    services: ["tts"],
    envKey: "MINIMAX_TTS_API_KEY",
    authType: "api",
    baseUrl: "https://api.minimax.io/v1",
    website: "https://platform.minimaxi.com/",
  },

  // --- Local Providers ---
  vllm: {
    id: "vllm",
    name: "vLLM (Local)",
    services: ["embedding", "reranking"],
    envKey: "VLLM_BASE_URL",
    authType: "none",
    baseUrl: "http://localhost:8000",
    local: true,
  },

  edge: {
    id: "edge",
    name: "Microsoft Edge TTS",
    services: ["tts"],
    envKey: "",
    authType: "none",
    local: true,
  },
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get all providers for a service type
 */
export function getProvidersForService(service: ServiceType): ProviderDefinition[] {
  return Object.values(PROVIDERS).filter((p) => p.services.includes(service));
}

/**
 * Get provider by ID
 */
export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS[id];
}

/**
 * Check if provider has credentials configured (via env vars)
 */
export function hasCredentials(provider: ProviderDefinition): boolean {
  if (provider.authType === "none") return true;
  if (provider.envKey && process.env[provider.envKey]) return true;
  for (const alias of provider.envAliases ?? []) {
    if (process.env[alias]) return true;
  }
  return false;
}

/**
 * Check if provider has credentials configured (via env vars or auth store)
 */
export async function hasCredentialsAsync(provider: ProviderDefinition): Promise<boolean> {
  if (hasCredentials(provider)) return true;

  // Check auth store
  const { Auth } = await import("../../packages/agent-core/src/auth");
  const auth = await Auth.get(provider.id);
  return auth !== undefined;
}

/**
 * Synchronously read auth store file (fallback for when async is not available)
 */
function readAuthStoreSync(): Record<string, { type: string; key?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os");
    const xdgDataHome =
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    const xdgStateHome =
      process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
    const authPaths = [
      path.join(xdgDataHome, "agent-core", "auth.json"),
      path.join(xdgStateHome, "agent-core", "auth.json"),
    ];
    const authPath = authPaths.find((candidate: string) => fs.existsSync(candidate));
    if (!authPath) return {};
    const data = fs.readFileSync(authPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Get API key for provider from environment variables or auth store (sync)
 */
export function getApiKeySync(providerId: string): string | undefined {
  const provider = PROVIDERS[providerId];

  // Check primary env var
  if (provider?.envKey && process.env[provider.envKey]) {
    return process.env[provider.envKey];
  }

  // Check aliases
  for (const alias of provider?.envAliases ?? []) {
    if (process.env[alias]) return process.env[alias];
  }

  // Check auth store (sync fallback)
  const authStore = readAuthStoreSync();
  const auth = authStore[providerId];
  if (auth?.type === "api" && auth.key) {
    return auth.key;
  }

  return undefined;
}

/**
 * Get API key for provider (from env or auth store)
 */
export async function getApiKey(providerId: string): Promise<string | undefined> {
  const provider = PROVIDERS[providerId];
  if (!provider) return undefined;

  // Check env vars first
  const envKey = getApiKeySync(providerId);
  if (envKey) return envKey;

  // Check auth store
  const { Auth } = await import("../../packages/agent-core/src/auth");
  const auth = await Auth.get(providerId);
  if (auth?.type === "api") return auth.key;

  return undefined;
}

/**
 * List all providers grouped by service
 */
export function listProvidersByService(): Record<ServiceType, ProviderDefinition[]> {
  const services: ServiceType[] = ["embedding", "reranking", "tts", "stt", "image"];
  const result = {} as Record<ServiceType, ProviderDefinition[]>;
  for (const service of services) {
    result[service] = getProvidersForService(service);
  }
  return result;
}

/**
 * Get all unique provider IDs
 */
export function getAllProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * Get provider status for display (configured, local, or not configured)
 */
export function getProviderStatus(
  provider: ProviderDefinition,
  hasAuthStoreCredential: boolean = false
): "configured" | "local" | "not configured" {
  if (provider.local) return "local";
  if (hasCredentials(provider) || hasAuthStoreCredential) return "configured";
  return "not configured";
}
