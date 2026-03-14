/**
 * Unified Provider Registry
 *
 * Central registry of all external service providers (embedding, reranking, TTS, STT, image).
 * Each provider has an auth ID that maps to the Zee auth system.
 *
 * This enables:
 * - Single source of truth for all providers across service types
 * - Unified auth login via `zee auth login <provider>`
 * - Service-agnostic credentials (login once, use everywhere)
 * - Easy discovery via `zee auth list`
 */

// =============================================================================
// Types
// =============================================================================

export type ServiceType =
  | "embedding"
  | "reranking"
  | "tts"
  | "stt"
  | "image"
  | "expenses"
  | "market_data";

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
    services: ["embedding"],
    envKey: "GOOGLE_API_KEY",
    envAliases: ["GEMINI_API_KEY"],
    authType: "api",
    validateEndpoint: "https://generativelanguage.googleapis.com/v1/models",
    website: "https://aistudio.google.com/apikey",
  },

  wisprflow: {
    id: "wisprflow",
    name: "Wispr Flow",
    services: ["stt"],
    envKey: "WISPRFLOW_API_KEY",
    authType: "api",
    baseUrl: "https://platform-api.wisprflow.ai/api/v1/dash/api",
    website: "https://wisprflow.ai/",
  },

  openai: {
    id: "openai",
    name: "OpenAI",
    services: ["tts", "image"],
    envKey: "OPENAI_API_KEY",
    authType: "api",
    validateEndpoint: "https://api.openai.com/v1/models",
    website: "https://platform.openai.com/api-keys",
  },

  voyage: {
    id: "voyage",
    name: "Voyage AI",
    services: ["reranking"],
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
    envAliases: [],
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

  // --- Integration Providers ---
  splitwise: {
    id: "splitwise",
    name: "Splitwise",
    services: ["expenses"],
    envKey: "SPLITWISE_TOKEN",
    authType: "api",
    baseUrl: "https://secure.splitwise.com/api/v3.0",
    website: "https://secure.splitwise.com/oauth_clients",
  },

  // --- Market Data Providers (OpenBB-compatible) ---
  "alpha-vantage": {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    services: ["market_data"],
    envKey: "ALPHA_VANTAGE_API_KEY",
    authType: "api",
    baseUrl: "https://www.alphavantage.co",
    website: "https://www.alphavantage.co/support/#api-key",
  },
  benzinga: {
    id: "benzinga",
    name: "Benzinga",
    services: ["market_data"],
    envKey: "BENZINGA_API_KEY",
    authType: "api",
    website: "https://www.benzinga.com/apis",
  },
  biztoc: {
    id: "biztoc",
    name: "Biztoc",
    services: ["market_data"],
    envKey: "BIZTOC_API_KEY",
    authType: "api",
    website: "https://biztoc.com/",
  },
  bls: {
    id: "bls",
    name: "BLS",
    services: ["market_data"],
    envKey: "BLS_API_KEY",
    authType: "api",
    website: "https://www.bls.gov/developers/home.htm",
  },
  cftc: {
    id: "cftc",
    name: "CFTC",
    services: ["market_data"],
    envKey: "CFTC_APP_TOKEN",
    authType: "api",
    website: "https://publicreporting.cftc.gov/",
  },
  "congress-gov": {
    id: "congress-gov",
    name: "Congress.gov",
    services: ["market_data"],
    envKey: "CONGRESS_GOV_API_KEY",
    authType: "api",
    website: "https://api.congress.gov/sign-up/",
  },
  econdb: {
    id: "econdb",
    name: "EconDB",
    services: ["market_data"],
    envKey: "ECONDB_API_KEY",
    authType: "api",
    website: "https://www.econdb.com/",
  },
  eia: {
    id: "eia",
    name: "EIA",
    services: ["market_data"],
    envKey: "EIA_API_KEY",
    authType: "api",
    website: "https://www.eia.gov/opendata/",
  },
  fmp: {
    id: "fmp",
    name: "Financial Modeling Prep",
    services: ["market_data"],
    envKey: "FMP_API_KEY",
    authType: "api",
    website: "https://site.financialmodelingprep.com/developer/docs",
  },
  fred: {
    id: "fred",
    name: "FRED",
    services: ["market_data"],
    envKey: "FRED_API_KEY",
    authType: "api",
    website: "https://fred.stlouisfed.org/docs/api/api_key.html",
  },
  intrinio: {
    id: "intrinio",
    name: "Intrinio",
    services: ["market_data"],
    envKey: "INTRINIO_API_KEY",
    authType: "api",
    website: "https://intrinio.com/",
  },
  nasdaq: {
    id: "nasdaq",
    name: "Nasdaq Data Link",
    services: ["market_data"],
    envKey: "NASDAQ_API_KEY",
    authType: "api",
    website: "https://data.nasdaq.com/",
  },
  sec: {
    id: "sec",
    name: "SEC EDGAR",
    services: ["market_data"],
    envKey: "SEC_IDENTITY",
    authType: "api",
    website: "https://www.sec.gov/edgar/sec-api-documentation",
  },
  tiingo: {
    id: "tiingo",
    name: "Tiingo",
    services: ["market_data"],
    envKey: "TIINGO_TOKEN",
    authType: "api",
    website: "https://api.tiingo.com/",
  },
  tradier: {
    id: "tradier",
    name: "Tradier",
    services: ["market_data"],
    envKey: "TRADIER_API_KEY",
    envAliases: ["TRADIER_TOKEN"],
    authType: "api",
    website: "https://developer.tradier.com/",
  },
  tradingeconomics: {
    id: "tradingeconomics",
    name: "TradingEconomics",
    services: ["market_data"],
    envKey: "TRADINGECONOMICS_API_KEY",
    authType: "api",
    website: "https://docs.tradingeconomics.com/",
  },

  // --- Local Providers ---
  vllm: {
    id: "vllm",
    name: "vLLM (Local)",
    services: ["reranking"],
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
  const { Auth } = await import("../../packages/zee/src/auth");
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
      path.join(xdgDataHome, "zee", "auth.json"),
      path.join(xdgStateHome, "zee", "auth.json"),
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
 * Get API key for provider from the global Zee auth store only (sync).
 *
 * This intentionally ignores environment variables to keep a single source of truth.
 */
export function getAuthApiKeySync(providerId: string): string | undefined {
  const authStore = readAuthStoreSync();
  const auth = authStore[providerId];
  if (auth?.type === "api" && auth.key) {
    return auth.key;
  }
  return undefined;
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
  const { Auth } = await import("../../packages/zee/src/auth");
  const auth = await Auth.get(providerId);
  if (auth?.type === "api") return auth.key;

  return undefined;
}

/**
 * List all providers grouped by service
 */
export function listProvidersByService(): Record<ServiceType, ProviderDefinition[]> {
  const services: ServiceType[] = [
    "embedding",
    "reranking",
    "tts",
    "stt",
    "image",
    "expenses",
    "market_data",
  ];
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
