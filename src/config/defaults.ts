/**
 * Default Configuration Values
 *
 * Provides sensible defaults for all configuration sections and surfaces.
 * These are merged with user configuration following the hierarchy:
 * defaults < global < project < environment < runtime
 *
 * @module config/defaults
 */

import type {
  Config,
  AgentConfig,
  ProviderConfig,
  MemoryConfig,
  SurfaceConfig,
  StanleySurfaceConfig,
  ZeeSurfaceConfig,
  CliSurfaceConfig,
  WebSurfaceConfig,
} from './schema';

// ============================================================================
// Provider Defaults
// ============================================================================

export const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    timeout: 300000, // 5 minutes
  },
  openai: {
    timeout: 300000,
  },
  google: {
    timeout: 300000,
  },
  groq: {
    timeout: 60000, // 1 minute (fast inference)
  },
  ollama: {
    baseURL: 'http://localhost:11434',
    timeout: 600000, // 10 minutes (local models can be slow)
  },
};

// ============================================================================
// Agent Defaults
// ============================================================================

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  build: {
    description: 'Primary coding and development agent',
    mode: 'primary',
    temperature: 0.7,
    maxSteps: 50,
    prompt: `You are a skilled software developer. You write clean, maintainable code and follow best practices.
Focus on:
- Writing correct, working code
- Following established patterns in the codebase
- Testing your changes
- Clear communication about what you're doing`,
  },

  plan: {
    description: 'Planning and architecture agent',
    mode: 'primary',
    temperature: 0.8,
    maxSteps: 30,
    prompt: `You are a technical planner and architect. You help break down complex tasks and design solutions.
Focus on:
- Understanding requirements thoroughly
- Breaking down large tasks into smaller steps
- Identifying potential issues early
- Creating clear, actionable plans`,
  },

  explore: {
    description: 'Code exploration and analysis agent',
    mode: 'subagent',
    temperature: 0.5,
    maxSteps: 20,
    prompt: `You are a code explorer. You help understand codebases and find relevant information.
Focus on:
- Finding relevant files and functions
- Understanding code structure
- Identifying patterns and conventions
- Providing clear summaries`,
  },

  review: {
    description: 'Code review and quality agent',
    mode: 'subagent',
    temperature: 0.6,
    maxSteps: 25,
    prompt: `You are a code reviewer. You help identify issues and suggest improvements.
Focus on:
- Finding bugs and potential issues
- Suggesting improvements
- Ensuring code quality
- Checking for security concerns`,
  },

  title: {
    description: 'Session title generation',
    mode: 'subagent',
    temperature: 0.9,
    maxSteps: 1,
    prompt: `Generate a brief, descriptive title for the conversation. Maximum 50 characters.`,
  },

  summary: {
    description: 'Conversation summarization',
    mode: 'subagent',
    temperature: 0.7,
    maxSteps: 1,
    prompt: `Summarize the key points of the conversation concisely.`,
  },
};

// ============================================================================
// Surface Defaults
// ============================================================================

export const DEFAULT_STANLEY_CONFIG: StanleySurfaceConfig = {
  sessionName: 'stanley',
  defaultAgent: 'build',
  autoReconnect: true,
  syncHistory: true,
  maxMediaSize: 16 * 1024 * 1024, // 16MB
  allowedChatTypes: ['private', 'group'],
};

export const DEFAULT_ZEE_CONFIG: ZeeSurfaceConfig = {
  defaultAgent: 'build',
  useWebhooks: false,
  parseMode: 'MarkdownV2',
  allowedUsers: [],
  allowedChats: [],
};

export const DEFAULT_CLI_CONFIG: CliSurfaceConfig = {
  defaultAgent: 'build',
  theme: 'default',
  showTimestamps: false,
  scrollSpeed: 1,
  maxHistory: 1000,
};

export const DEFAULT_WEB_CONFIG: WebSurfaceConfig = {
  defaultAgent: 'build',
  port: 3000,
  hostname: 'localhost',
  cors: true,
  sessionTimeout: 3600,
  mdns: false,
};

export const DEFAULT_SURFACE_CONFIG: SurfaceConfig = {
  stanley: DEFAULT_STANLEY_CONFIG,
  zee: DEFAULT_ZEE_CONFIG,
  cli: DEFAULT_CLI_CONFIG,
  web: DEFAULT_WEB_CONFIG,
};

// ============================================================================
// Memory Defaults
// ============================================================================

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  vectorDb: {
    type: 'qdrant',
    collection: 'agent-core',
    embeddingModel: 'text-embedding-3-small',
    dimensions: 1536,
  },
  maxRetrieved: 10,
  similarityThreshold: 0.7,
  retentionDays: 0, // Keep forever
  namespaces: ['conversations', 'code', 'documentation'],
};

// ============================================================================
// Permission Defaults
// ============================================================================

export const DEFAULT_PERMISSIONS = {
  edit: 'ask' as const,
  bash: 'ask' as const,
  skill: 'ask' as const,
  webfetch: 'ask' as const,
  mcp: 'allow' as const,
};

// ============================================================================
// Complete Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: Config = {
  $schema: 'https://agent-core.dev/config.json',

  // Provider defaults (providers are loaded from environment/auth)
  provider: DEFAULT_PROVIDERS,

  // Default model (will be overridden based on available providers)
  model: 'anthropic/claude-sonnet-4-20250514',
  smallModel: 'anthropic/claude-haiku-4-20250514',

  // Agent definitions
  agent: DEFAULT_AGENTS,
  defaultAgent: 'build',

  // MCP servers (empty by default, user configures)
  mcp: {},

  // Surface configurations
  surface: DEFAULT_SURFACE_CONFIG,

  // Memory configuration
  memory: DEFAULT_MEMORY_CONFIG,

  // Plugins (empty by default)
  plugin: [],

  // Global settings
  logLevel: 'info',

  // Permissions
  permission: DEFAULT_PERMISSIONS,

  // Experimental features
  experimental: {
    batchTool: false,
    openTelemetry: false,
    continueOnDeny: false,
  },
};

// ============================================================================
// Surface-Specific Default Overrides
// ============================================================================

/**
 * Get default configuration for a specific surface
 */
export function getDefaultsForSurface(surface: 'stanley' | 'zee' | 'cli' | 'web'): Partial<Config> {
  const overrides: Record<string, Partial<Config>> = {
    stanley: {
      // WhatsApp-specific defaults
      defaultAgent: 'build',
      experimental: {
        continueOnDeny: true, // More forgiving in chat contexts
      },
    },
    zee: {
      // Messaging-surface defaults
      defaultAgent: 'build',
    },
    cli: {
      // CLI-specific defaults
      defaultAgent: 'build',
      logLevel: 'info',
    },
    web: {
      // Web-specific defaults
      defaultAgent: 'build',
      logLevel: 'warn', // Less verbose for web
    },
  };

  return overrides[surface] || {};
}

// ============================================================================
// Model Fallback Chain
// ============================================================================

/**
 * Model fallback chain for when preferred model is unavailable
 */
export const MODEL_FALLBACK_CHAIN = [
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-3-5-sonnet-20241022',
  'openai/gpt-4o',
  'google/gemini-2.0-flash-exp',
  'groq/llama-3.3-70b-versatile',
];

/**
 * Small model fallback chain
 */
export const SMALL_MODEL_FALLBACK_CHAIN = [
  'anthropic/claude-haiku-4-20250514',
  'anthropic/claude-3-5-haiku-20241022',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-exp',
  'groq/llama-3.1-8b-instant',
];

// ============================================================================
// Environment Variable Mapping
// ============================================================================

/**
 * Maps environment variables to config paths
 */
export const ENV_VAR_MAPPING: Record<string, string> = {
  // Core settings
  'AGENT_CORE_MODEL': 'model',
  'AGENT_CORE_SMALL_MODEL': 'smallModel',
  'AGENT_CORE_DEFAULT_AGENT': 'defaultAgent',
  'AGENT_CORE_LOG_LEVEL': 'logLevel',
  'AGENT_CORE_THEME': 'theme',

  // Provider API keys
  'ANTHROPIC_API_KEY': 'provider.anthropic.apiKey',
  'OPENAI_API_KEY': 'provider.openai.apiKey',
  'GOOGLE_API_KEY': 'provider.google.apiKey',
  'GROQ_API_KEY': 'provider.groq.apiKey',

  // Surface-specific
  'AGENT_CORE_WHATSAPP_SESSION': 'surface.stanley.sessionName',
  'AGENT_CORE_PORT': 'surface.web.port',
  'AGENT_CORE_HOSTNAME': 'surface.web.hostname',

  // Memory
  'AGENT_CORE_MEMORY_ENABLED': 'memory.enabled',
  'QDRANT_URL': 'memory.vectorDb.url',
  'QDRANT_API_KEY': 'memory.vectorDb.apiKey',
};

// ============================================================================
// Config File Names
// ============================================================================

/**
 * Configuration file names to search for (in order of precedence)
 */
export const CONFIG_FILE_NAMES = [
  'agent-core.jsonc',
  'agent-core.json',
  '.agent-core.jsonc',
  '.agent-core.json',
];

/**
 * Config directory names
 */
export const CONFIG_DIR_NAMES = [
  '.agent-core',
  'agent-core',
];

/**
 * Global config directory (XDG compliant)
 */
export function getGlobalConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return `${xdgConfig}/agent-core`;
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/.config/agent-core`;
}
