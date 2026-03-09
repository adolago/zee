/**
 * Configuration System Types
 *
 * Unified configuration for zee, supporting:
 * - Provider selection and auth
 * - Assistant profiles
 * - MCP servers
 * - Memory settings
 * - Surface-specific options
 */

import type { AuthMethod, SubscriptionProvider } from "../provider/types";
import type { AgentConfig, AssistantProfile } from "../agent/types";
import type { McpServerConfig as MCPConfig } from "../mcp/types";
import type { MemoryConfig } from "../memory/types";
import type { SurfaceType } from "../../packages/zee/src/surface/types";
import type { LogLevel, DmPolicy, GroupPolicy, RetryConfig } from "./shared";
import {
  QDRANT_URL,
  QDRANT_COLLECTION_MEMORY,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from "./constants";

// =============================================================================
// Main Configuration
// =============================================================================

/** Root configuration structure */
export interface ZeeRootConfig {
  /** Project identifier */
  projectId?: string;

  /** Provider configuration */
  provider: ProviderConfig;

  /** Agent configurations */
  agents: AgentConfig[];

  /** Assistant profiles */
  assistants: AssistantProfileConfig[];

  /** MCP server configurations */
  mcp: Record<string, MCPConfig>;

  /** Memory system configuration */
  memory: MemoryConfig;

  /** Surface-specific configurations */
  surfaces: SurfaceConfigs;

  /** General settings */
  settings: GeneralSettings;

  /** Zee-specific integrations */
  zee?: ZeeIntegrationsConfig;
}

// =============================================================================
// Provider Configuration
// =============================================================================

/** Provider configuration */
export interface ProviderConfig {
  /** Default provider ID */
  default: string;

  /** Default model for the default provider */
  model?: string;

  /** Provider-specific configurations */
  providers: Record<string, ProviderSettings>;

  /** Subscription authentication configs */
  subscriptions?: Record<SubscriptionProvider, SubscriptionConfig>;
}

/** Settings for a specific provider */
export interface ProviderSettings {
  /** Whether enabled */
  enabled?: boolean;

  /** Authentication method */
  auth?: AuthMethod;

  /** API base URL override */
  baseUrl?: string;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Request timeout in ms */
  timeout?: number;

  /** Max retries on failure */
  maxRetries?: number;

  /** Model overrides */
  models?: Record<string, ModelOverride>;
}

/** Override settings for a specific model */
export interface ModelOverride {
  /** Whether enabled */
  enabled?: boolean;

  /** Alias for the model */
  alias?: string;

  /** Custom options */
  options?: Record<string, unknown>;
}

/** Subscription service configuration */
export interface SubscriptionConfig {
  /** Whether enabled */
  enabled: boolean;

  /** OAuth tokens (managed automatically) */
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  };

  /** Preferred models when using this subscription */
  preferredModels?: string[];
}

// =============================================================================
// Assistant Profile Configuration
// =============================================================================

/** Extended assistant config with associated settings */
export interface AssistantProfileConfig extends AssistantProfile {
  /** Default agent config to use */
  defaultAgent: string;

  /** Surfaces this assistant appears on */
  surfaces: SurfaceType[];

  /** Identity and soul files to load for assistant wiring */
  identityFiles?: string[];

  /** Custom system prompt additions */
  systemPromptAdditions?: string;

  /** Knowledge file paths to include */
  knowledge?: string[];

  /** MCP servers enabled for this assistant */
  mcpServers?: string[];
}

// =============================================================================
// Surface Configurations
// =============================================================================

/** Surface-specific configurations */
export interface SurfaceConfigs {
  cli?: CLIConfig;
  web?: WebConfig;
  api?: APIConfig;
  whatsapp?: WhatsAppConfig;
}

/** CLI/TUI configuration */
export interface CLIConfig {
  /** Theme settings */
  theme?: {
    /** Color scheme */
    colorScheme?: "dark" | "light" | "auto";
    /** Accent color */
    accentColor?: string;
  };

  /** Editor for multi-line input */
  editor?: string;

  /** History file path */
  historyPath?: string;

  /** Max history entries */
  maxHistory?: number;

  /** Enable vim mode */
  vimMode?: boolean;
}

/** Web/GUI configuration */
export interface WebConfig {
  /** Port to serve on */
  port?: number;

  /** Host to bind to */
  host?: string;

  /** Enable CORS */
  cors?: boolean | string[];

  /** Session timeout in ms */
  sessionTimeout?: number;
}

/** API configuration */
export interface APIConfig {
  /** API key for authentication */
  apiKey?: string;

  /** Rate limiting */
  rateLimit?: {
    /** Requests per minute */
    rpm?: number;
    /** Tokens per minute */
    tpm?: number;
  };

  /** Webhook URL for async responses */
  webhookUrl?: string;
}

/** WhatsApp configuration */
export interface WhatsAppConfig {
  /** Session data path */
  sessionPath?: string;

  /** Direct message access policy (shared with zee) */
  dmPolicy?: DmPolicy;

  /** Group message access policy (shared with zee) */
  groupPolicy?: GroupPolicy;

  /** Allowlist for direct chats (E.164 format) */
  allowFrom?: string[];

  /** Retry configuration for outbound messages */
  retry?: RetryConfig;

  /** Auto-reply settings */
  autoReply?: {
    /** Enable auto-reply */
    enabled: boolean;
    /** Delay before replying (ms) */
    delay?: number;
    /** Contacts to auto-reply to (empty = all) */
    allowedContacts?: string[];
    /** Contacts to never auto-reply to */
    blockedContacts?: string[];
    /** Groups to auto-reply in */
    allowedGroups?: string[];
  };

  /** Catchup settings for missed messages */
  catchup?: {
    /** Enable catchup on reconnect */
    enabled: boolean;
    /** Minutes to look back */
    minutes?: number;
  };
}

// =============================================================================
// General Settings
// =============================================================================

/** General application settings */
export interface GeneralSettings {
  /** Log level (uses shared LogLevel type) */
  logLevel?: LogLevel;

  /** Data directory for storage */
  dataDir?: string;

  /** Cache directory */
  cacheDir?: string;

  /** Enable telemetry */
  telemetry?: boolean;

  /** Auto-update check */
  autoUpdate?: boolean;

  /** Experimental features */
  experimental?: Record<string, boolean>;
}

// =============================================================================
// Zee Integrations
// =============================================================================

export interface ZeeIntegrationsConfig {
  splitwise?: ZeeSplitwiseConfig;
  codexbar?: ZeeCodexbarConfig;
}

export interface ZeeSplitwiseConfig {
  enabled?: boolean;
  token?: string;
  tokenFile?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface ZeeCodexbarConfig {
  enabled?: boolean;
  command?: string | string[];
  timeoutMs?: number;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/** Configuration file locations (in priority order) */
export const CONFIG_LOCATIONS = [
  // Project-specific
  "zee.jsonc",
  ".zee/zee.jsonc",
  // User-specific
  "~/.config/zee/zee.jsonc",
  // Global
  "/etc/zee/zee.jsonc",
];

/** Environment variable prefix */
export const ENV_PREFIX = "ZEE_";

/** Default configuration values */
export const DEFAULT_CONFIG: Partial<ZeeRootConfig> = {
  provider: {
    default: "anthropic",
    providers: {},
  },
  agents: [],
  assistants: [],
  mcp: {},
	  memory: {
	    qdrant: {
	      url: QDRANT_URL,
	      collection: QDRANT_COLLECTION_MEMORY,
	    },
	    embedding: {
	      provider: "google",
	      model: EMBEDDING_MODEL,
	      dimension: EMBEDDING_DIMENSIONS,
	    },
	    autoLearn: true,
    patternMinObservations: 3,
    defaultTTL: 0,
  },
  surfaces: {},
  settings: {
    logLevel: "info",
    dataDir: "~/.local/share/zee",
    cacheDir: "~/.cache/zee",
    telemetry: false,
    autoUpdate: true,
  },
};
