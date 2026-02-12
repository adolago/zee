/**
 * Configuration Schema Definitions
 *
 * Zod-based validation schemas for the unified configuration system.
 * Supports all surfaces: Stanley (WhatsApp), Zee (WhatsApp), CLI, and Web.
 *
 * @module config/schema
 */

import { z } from 'zod';

// ============================================================================
// Base Types
// ============================================================================

/**
 * Permission levels for tool access control
 */
export const PermissionSchema = z.enum(['ask', 'allow', 'deny']);
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * Log level configuration
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Model-specific configuration overrides
 */
export const ModelConfigSchema = z.object({
  /** Model identifier override */
  id: z.string().optional(),
  /** Display name for the model */
  name: z.string().optional(),
  /** Maximum context window size */
  contextWindow: z.number().int().positive().optional(),
  /** Maximum output tokens */
  maxOutputTokens: z.number().int().positive().optional(),
  /** Whether the model supports vision */
  vision: z.boolean().optional(),
  /** Whether the model supports tool use */
  tools: z.boolean().optional(),
  /** Cost per million input tokens */
  inputCostPerMillion: z.number().optional(),
  /** Cost per million output tokens */
  outputCostPerMillion: z.number().optional(),
}).strict();
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * Provider-level configuration
 */
export const ProviderConfigSchema = z.object({
  /** API key (supports {env:VAR} interpolation) */
  apiKey: z.string().optional(),
  /** Base URL for the provider API */
  baseURL: z.string().url().optional(),
  /** Request timeout in milliseconds */
  timeout: z.union([
    z.number().int().positive(),
    z.literal(false), // Disable timeout
  ]).optional(),
  /** Model whitelist (only these models are available) */
  whitelist: z.array(z.string()).optional(),
  /** Model blacklist (these models are excluded) */
  blacklist: z.array(z.string()).optional(),
  /** Per-model configuration overrides */
  models: z.record(z.string(), ModelConfigSchema).optional(),
  /** Additional provider-specific options */
  options: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Agent persona definition
 */
export const AgentConfigSchema = z.object({
  /** Model to use (provider/model format) */
  model: z.string().optional(),
  /** Temperature for generation (0.0 - 2.0) */
  temperature: z.number().min(0).max(2).optional(),
  /** Top-p sampling parameter */
  top_p: z.number().min(0).max(1).optional(),
  /** System prompt for the agent */
  prompt: z.string().optional(),
  /** Tool enable/disable map */
  tools: z.record(z.string(), z.boolean()).optional(),
  /** Whether this agent is disabled */
  disable: z.boolean().optional(),
  /** Description of when to use this agent */
  description: z.string().optional(),
  /** Agent mode: subagent (spawned), primary (main), or all */
  mode: z.enum(['subagent', 'primary', 'all']).optional(),
  /** Display color (hex format) */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional(),
  /** Maximum agentic iterations */
  maxSteps: z.number().int().positive().optional(),
  /** Agent-specific permission overrides */
  permission: z.object({
    edit: PermissionSchema.optional(),
    bash: z.union([PermissionSchema, z.record(z.string(), PermissionSchema)]).optional(),
    skill: z.union([PermissionSchema, z.record(z.string(), PermissionSchema)]).optional(),
    webfetch: PermissionSchema.optional(),
    mcp: z.union([PermissionSchema, z.record(z.string(), PermissionSchema)]).optional(),
  }).optional(),
}).passthrough(); // Allow additional properties for extensibility
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================================================
// MCP Configuration
// ============================================================================

/**
 * Local MCP server (spawned as subprocess)
 */
export const McpLocalConfigSchema = z.object({
  type: z.literal('local'),
  /** Command and arguments to run the server */
  command: z.array(z.string()),
  /** Environment variables for the process */
  environment: z.record(z.string(), z.string()).optional(),
  /** Whether the server is enabled */
  enabled: z.boolean().optional().default(true),
  /** Timeout for fetching tools (ms) */
  timeout: z.number().int().positive().optional().default(5000),
}).strict();
export type McpLocalConfig = z.infer<typeof McpLocalConfigSchema>;

/**
 * OAuth configuration for remote MCP servers
 */
export const McpOAuthConfigSchema = z.object({
  /** OAuth client ID */
  clientId: z.string().optional(),
  /** OAuth client secret */
  clientSecret: z.string().optional(),
  /** OAuth scopes to request */
  scope: z.string().optional(),
}).strict();
export type McpOAuthConfig = z.infer<typeof McpOAuthConfigSchema>;

/**
 * Remote MCP server (HTTP/SSE)
 */
export const McpRemoteConfigSchema = z.object({
  type: z.literal('remote'),
  /** URL of the remote server */
  url: z.string().url(),
  /** Whether the server is enabled */
  enabled: z.boolean().optional().default(true),
  /** HTTP headers for requests */
  headers: z.record(z.string(), z.string()).optional(),
  /** Run MCP tools asynchronously (returns job id; use <server>_job_poll to retrieve results) */
  async: z.boolean().optional(),
  /** OAuth configuration or false to disable */
  oauth: z.union([McpOAuthConfigSchema, z.literal(false)]).optional(),
  /** Timeout for fetching tools (ms) */
  timeout: z.number().int().positive().optional().default(5000),
}).strict();
export type McpRemoteConfig = z.infer<typeof McpRemoteConfigSchema>;

/**
 * MCP server configuration (local or remote)
 */
export const McpConfigSchema = z.discriminatedUnion('type', [
  McpLocalConfigSchema,
  McpRemoteConfigSchema,
]);
export type McpConfig = z.infer<typeof McpConfigSchema>;

// ============================================================================
// Surface Configuration
// ============================================================================

/**
 * Stanley (WhatsApp) surface-specific settings
 */
export const StanleySurfaceConfigSchema = z.object({
  /** WhatsApp session name */
  sessionName: z.string().optional().default('stanley'),
  /** Default agent for this surface */
  defaultAgent: z.string().optional(),
  /** Whether to auto-reconnect on disconnect */
  autoReconnect: z.boolean().optional().default(true),
  /** Message rate limiting (messages per minute) */
  rateLimit: z.number().int().positive().optional(),
  /** Whether to sync message history on reconnect */
  syncHistory: z.boolean().optional().default(true),
  /** Maximum media size in bytes */
  maxMediaSize: z.number().int().positive().optional(),
  /** Allowed chat types */
  allowedChatTypes: z.array(z.enum(['private', 'group'])).optional(),
}).strict();
export type StanleySurfaceConfig = z.infer<typeof StanleySurfaceConfigSchema>;

/**
 * Zee (WhatsApp) surface-specific settings
 */
export const ZeeSurfaceConfigSchema = z.object({
  /** Default agent for this surface */
  defaultAgent: z.string().optional(),
  /** Default outbound channel */
  defaultChannel: z.enum(['whatsapp']).optional(),
  /** Allowlist of sender identifiers (channel-specific) */
  allowFrom: z.array(z.string()).optional(),
}).strict();
export type ZeeSurfaceConfig = z.infer<typeof ZeeSurfaceConfigSchema>;

/**
 * CLI surface-specific settings
 */
export const CliSurfaceConfigSchema = z.object({
  /** Default agent for this surface */
  defaultAgent: z.string().optional(),
  /** Theme name */
  theme: z.string().optional().default('selenized-dark'),
  /** Editor command for external editing */
  editor: z.string().optional(),
  /** Whether to show timestamps */
  showTimestamps: z.boolean().optional().default(false),
  /** Scroll speed multiplier */
  scrollSpeed: z.number().min(0.1).max(10).optional().default(1),
  /** History file path */
  historyFile: z.string().optional(),
  /** Maximum history entries */
  maxHistory: z.number().int().positive().optional().default(1000),
}).strict();
export type CliSurfaceConfig = z.infer<typeof CliSurfaceConfigSchema>;

/**
 * Web surface-specific settings
 */
export const WebSurfaceConfigSchema = z.object({
  /** Default agent for this surface */
  defaultAgent: z.string().optional(),
  /** Server port */
  port: z.number().int().min(1).max(65535).optional().default(3000),
  /** Server hostname */
  hostname: z.string().optional().default('localhost'),
  /** Whether to enable CORS */
  cors: z.boolean().optional().default(true),
  /** CORS allowed origins */
  corsOrigins: z.array(z.string()).optional(),
  /** Session timeout in seconds */
  sessionTimeout: z.number().int().positive().optional().default(3600),
  /** Whether to enable mDNS discovery */
  mdns: z.boolean().optional().default(false),
}).strict();
export type WebSurfaceConfig = z.infer<typeof WebSurfaceConfigSchema>;

/**
 * Combined surface configuration
 */
export const SurfaceConfigSchema = z.object({
  stanley: StanleySurfaceConfigSchema.optional(),
  zee: ZeeSurfaceConfigSchema.optional(),
  cli: CliSurfaceConfigSchema.optional(),
  web: WebSurfaceConfigSchema.optional(),
}).strict();
export type SurfaceConfig = z.infer<typeof SurfaceConfigSchema>;

// ============================================================================
// Memory Configuration
// ============================================================================

/**
 * Vector database configuration
 */
export const VectorDbConfigSchema = z.object({
  /** Vector database type */
  type: z.enum(['qdrant', 'pinecone', 'weaviate', 'memory']).default('qdrant'),
  /** Connection URL */
  url: z.string().optional(),
  /** API key for cloud providers */
  apiKey: z.string().optional(),
  /** Collection/index name */
  collection: z.string().optional().default('zee'),
  /** Embedding model to use */
  embeddingModel: z.string().optional().default('gemini-embedding-001'),
  /** Embedding dimensions */
  dimensions: z.number().int().positive().optional().default(3072),
}).strict();
export type VectorDbConfig = z.infer<typeof VectorDbConfigSchema>;

/**
 * Memory system configuration
 */
export const MemoryConfigSchema = z.object({
  /** Whether memory is enabled */
  enabled: z.boolean().optional().default(true),
  /** Vector database configuration */
  vectorDb: VectorDbConfigSchema.optional(),
  /** Maximum memories to retrieve per query */
  maxRetrieved: z.number().int().positive().optional().default(10),
  /** Similarity threshold (0.0 - 1.0) */
  similarityThreshold: z.number().min(0).max(1).optional().default(0.7),
  /** Memory retention in days (0 = forever) */
  retentionDays: z.number().int().min(0).optional().default(0),
  /** Namespaces for memory organization */
  namespaces: z.array(z.string()).optional(),
}).strict();
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Plugin activation entry
 */
export const PluginEntrySchema = z.union([
  z.string(), // Simple: plugin name or path
  z.object({
    /** Plugin name or path */
    name: z.string(),
    /** Plugin-specific options */
    options: z.record(z.string(), z.unknown()).optional(),
    /** Whether the plugin is enabled */
    enabled: z.boolean().optional().default(true),
  }),
]);
export type PluginEntry = z.infer<typeof PluginEntrySchema>;

// ============================================================================
// Main Configuration Schema
// ============================================================================

/**
 * Complete Zee configuration
 */
export const ConfigSchema = z.object({
  /** JSON schema reference */
  $schema: z.string().optional(),

  // --- Provider Configuration ---
  /** LLM provider configurations */
  provider: z.record(z.string(), ProviderConfigSchema).optional(),
  /** Default model (provider/model format) */
  model: z.string().optional(),
  /** Small model for lightweight tasks */
  smallModel: z.string().optional(),
  /** Disabled providers */
  disabledProviders: z.array(z.string()).optional(),
  /** Enabled providers (exclusive - only these if set) */
  enabledProviders: z.array(z.string()).optional(),

  // --- Agent Configuration ---
  /** Agent persona definitions */
  agent: z.record(z.string(), AgentConfigSchema).optional(),
  /** Default agent to use */
  defaultAgent: z.string().optional(),

  // --- MCP Configuration ---
  /** MCP server configurations */
  mcp: z.record(z.string(), McpConfigSchema).optional(),

  // --- Surface Configuration ---
  /** Surface-specific settings */
  surface: SurfaceConfigSchema.optional(),

  // --- Memory Configuration ---
  /** Memory system settings */
  memory: MemoryConfigSchema.optional(),

  // --- Plugin Configuration ---
  /** Plugin activation list */
  plugin: z.array(PluginEntrySchema).optional(),

  // --- Global Settings ---
  /** Log level */
  logLevel: LogLevelSchema.optional().default('info'),
  /** Username for display */
  username: z.string().optional(),
  /** Theme name */
  theme: z.string().optional(),

  // --- Permissions ---
  /** Global permission settings */
  permission: z.object({
    edit: PermissionSchema.optional(),
    bash: z.union([PermissionSchema, z.record(z.string(), PermissionSchema)]).optional(),
    skill: z.union([PermissionSchema, z.record(z.string(), PermissionSchema)]).optional(),
    webfetch: PermissionSchema.optional(),
    mcp: z.union([PermissionSchema, z.record(z.string(), PermissionSchema)]).optional(),
  }).optional(),

  // --- Experimental Features ---
  /** Experimental feature flags */
  experimental: z.object({
    /** Enable batch tool */
    batchTool: z.boolean().optional(),
    /** Enable OpenTelemetry */
    openTelemetry: z.boolean().optional(),
    /** Continue agent loop on tool denial */
    continueOnDeny: z.boolean().optional(),
    /** Primary-only tools */
    primaryTools: z.array(z.string()).optional(),
  }).optional(),

}).strict();
export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate configuration and return parsed result or errors
 */
export function validateConfig(data: unknown): {
  success: true;
  data: Config;
} | {
  success: false;
  errors: ConfigValidationError[];
} {
  const result = ConfigSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
    suggestion: getSuggestion(issue),
  }));

  return { success: false, errors };
}

export interface ConfigValidationError {
  path: string;
  message: string;
  code: string;
  suggestion?: string;
}

/**
 * Get helpful suggestion for validation errors
 */
function getSuggestion(issue: z.ZodIssue): string | undefined {
  const path = issue.path.join('.');
  const code = issue.code as string;

  // Common error suggestions
  if (code === 'invalid_type') {
    const invalid = issue as { expected?: unknown; received?: unknown };
    return `Expected ${invalid.expected}, received ${invalid.received}`;
  }

  if (code === 'unrecognized_keys') {
    const keys = (issue as z.ZodIssue & { keys?: string[] }).keys;
    if (keys?.length) {
      return `Unknown keys: ${keys.join(', ')}. Check spelling or remove.`;
    }
  }

  if (path.includes('provider') && (code === 'invalid_format' || code === 'invalid_string')) {
    return 'API keys can use {env:VAR_NAME} syntax for environment variables';
  }

  if (path.includes('model') && (code === 'invalid_format' || code === 'invalid_string')) {
    return 'Model format should be "provider/model-name" (e.g., "anthropic/claude-3-opus")';
  }

  if (path.includes('color')) {
    return 'Color must be a hex code like #FF5733';
  }

  return undefined;
}

/**
 * Schema metadata for documentation generation
 */
export const SchemaMetadata = {
  version: '1.0.0',
  description: 'Unified configuration schema for zee',
  surfaces: ['stanley', 'zee', 'cli', 'web'] as const,
  configLocations: {
    global: '~/.config/zee/',
    project: '.zee/',
    env: 'ZEE_*',
  },
};
