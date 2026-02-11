/**
 * MCP Tools Layer - Type Definitions
 *
 * Core type definitions for the unified MCP tools layer that provides
 * tool access across all surfaces (CLI, Web, API, WhatsApp).
 */

import type { z } from 'zod';

// ============================================================================
// Tool Definition Types
// ============================================================================

/**
 * Metadata attached to tool execution results
 */
export interface ToolMetadata {
  [key: string]: unknown;
}

/**
 * Context provided during tool initialization
 */
export interface ToolInitContext {
  /** Agent information if running within an agent context */
  agent?: AgentInfo;
  /** Surface identifier (cli, web, api, whatsapp) */
  surface?: SurfaceType;
}

/**
 * Context provided during tool execution
 */
export interface ToolExecutionContext {
  /** Session identifier */
  sessionId: string;
  /** Message identifier */
  messageId: string;
  /** Agent name/type */
  agent: string;
  /** Abort signal for cancellation */
  abort: AbortSignal;
  /** Optional call identifier for permission tracking */
  callId?: string;
  /** Extra context data */
  extra?: Record<string, unknown>;
  /** Update metadata during execution */
  metadata(input: { title?: string; metadata?: ToolMetadata }): void;
}

/**
 * Result returned from tool execution
 */
export interface ToolExecutionResult<M extends ToolMetadata = ToolMetadata> {
  /** Title for UI display */
  title: string;
  /** Execution metadata */
  metadata: M;
  /** Text output from the tool */
  output: string;
  /** Optional file attachments */
  attachments?: FileAttachment[];
}

/**
 * File attachment in tool results
 */
export interface FileAttachment {
  id: string;
  sessionId: string;
  messageId: string;
  type: 'file';
  mime: string;
  url: string;
}

/**
 * Tool definition interface - the core contract for all tools
 */
export interface ToolDefinition<
  TParams extends z.ZodType<any, any> = z.ZodType<any, any>,
  TMeta extends ToolMetadata = ToolMetadata
> {
  /** Unique tool identifier */
  id: string;
  /** Tool category for organization */
  category: ToolCategory;
  /** Initialize the tool, returning its runtime definition */
  init: (ctx?: ToolInitContext) => Promise<ToolRuntime<TParams, TMeta>>;
}

/**
 * Runtime tool configuration after initialization
 */
export interface ToolRuntime<
  TParams extends z.ZodType<any, any> = z.ZodType<any, any>,
  TMeta extends ToolMetadata = ToolMetadata
> {
  /** Tool description for LLM */
  description: string;
  /** Zod schema for parameters */
  parameters: TParams;
  /** Execute the tool */
  execute(
    args: z.infer<TParams>,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult<TMeta>>;
  /** Optional custom validation error formatter */
  formatValidationError?(error: z.ZodError): string;
}

// ============================================================================
// Tool Categories
// ============================================================================

export type ToolCategory =
  | 'builtin'    // Core built-in tools (bash, read, write, etc.)
  | 'domain'     // Domain-specific tools (Stanley, Zee)
  | 'mcp'        // External MCP server tools
  | 'plugin'     // User-defined plugin tools
  | 'skill';     // Skill-based tools

// ============================================================================
// Surface Types
// ============================================================================

export type SurfaceType = 'cli' | 'web' | 'api' | 'whatsapp';

// ============================================================================
// Permission Types
// ============================================================================

export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * Permission configuration for a tool
 */
export interface ToolPermission {
  /** Default action for the tool */
  default: PermissionAction;
  /** Pattern-based overrides (for bash commands, paths, etc.) */
  patterns?: Record<string, PermissionAction>;
}

/**
 * Permission configuration by surface
 */
export interface SurfacePermissions {
  /** Per-surface defaults */
  surfaces: Record<SurfaceType, Partial<Record<string, ToolPermission>>>;
  /** Global defaults */
  global: Partial<Record<string, ToolPermission>>;
  /** User overrides (highest priority) */
  overrides: Partial<Record<string, ToolPermission>>;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentInfo {
  name: string;
  mode: 'primary' | 'subagent';
  description?: string;
  permission: AgentPermissions;
  model?: {
    modelId: string;
    providerId: string;
  };
  tools?: Record<string, boolean>;
}

export interface AgentPermissions {
  bash: Record<string, PermissionAction>;
  edit: PermissionAction;
  write: PermissionAction;
  webfetch: PermissionAction;
  skill: Record<string, PermissionAction>;
  external_directory: PermissionAction;
  mcp: Record<string, ToolPermission>;
}

// ============================================================================
// MCP Server Types
// ============================================================================

export type McpTransportType = 'stdio' | 'http' | 'sse';

/**
 * Local MCP server configuration (stdio transport)
 */
export interface McpLocalConfig {
  type: 'local';
  /** Command and arguments to start the server */
  command: string[];
  /** Environment variables */
  environment?: Record<string, string>;
  /** Enable/disable the server */
  enabled?: boolean;
  /** Timeout for tool calls in ms */
  timeout?: number;
}

/**
 * Remote MCP server configuration (HTTP/SSE transport)
 */
export interface McpRemoteConfig {
  type: 'remote';
  /** Server URL */
  url: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Run MCP tools asynchronously (returns job id; use <server>_job_poll to retrieve results) */
  async?: boolean;
  /** OAuth configuration */
  oauth?: McpOAuthConfig | false;
  /** Enable/disable the server */
  enabled?: boolean;
  /** Timeout for tool calls in ms */
  timeout?: number;
}

export type McpServerConfig = McpLocalConfig | McpRemoteConfig;

/**
 * OAuth configuration for MCP servers
 */
export interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

/**
 * MCP server connection status
 */
export type McpServerStatus =
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string };

// ============================================================================
// Domain Tool Types (Stanley & Zee)
// ============================================================================

/**
 * Stanley domain tools - Financial market data and research
 */
export namespace StanleyTools {
  export interface MarketDataParams {
    symbol: string;
    period?: '1d' | '5d' | '1m' | '3m' | '6m' | '1y' | 'ytd';
  }

  export interface ResearchParams {
    query: string;
    sources?: ('sec' | 'news' | 'analyst')[];
    limit?: number;
  }

  export interface PortfolioParams {
    action: 'get' | 'analyze' | 'optimize';
    portfolioId?: string;
  }

  export interface SecFilingParams {
    ticker: string;
    formType?: '10-K' | '10-Q' | '8-K' | '13F' | 'DEF14A';
    year?: number;
  }
}

/**
 * Zee domain tools - Memory, messaging, and notifications
 */
export namespace ZeeTools {
  export interface MemoryStoreParams {
    key: string;
    value: unknown;
    namespace?: string;
    ttl?: number;
  }

  export interface MemorySearchParams {
    query: string;
    namespace?: string;
    limit?: number;
    threshold?: number;
  }

  export interface MessagingParams {
    channel: 'whatsapp';
    to: string;
    message: string;
    attachments?: string[];
  }

  export interface NotificationParams {
    type: 'alert' | 'reminder' | 'summary';
    title: string;
    body: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    schedule?: string; // ISO date or cron expression
  }
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Tool registry entry with status
 */
export interface ToolRegistryEntry {
  tool: ToolDefinition;
  source: 'builtin' | 'mcp' | 'plugin' | 'domain';
  serverId?: string; // For MCP tools
  enabled: boolean;
}

/**
 * Tool registry events
 */
export interface ToolRegistryEvents {
  'tool:registered': { toolId: string; source: string };
  'tool:unregistered': { toolId: string };
  'tool:enabled': { toolId: string };
  'tool:disabled': { toolId: string };
  'mcp:connected': { serverId: string; toolCount: number };
  'mcp:disconnected': { serverId: string };
  'mcp:tools_changed': { serverId: string };
}
