/**
 * MCP Tools Layer - Main Entry Point
 *
 * Unified MCP tools layer that provides tool access across all surfaces.
 * Combines built-in tools, domain tools, MCP servers, and plugins.
 *
 * Architecture:
 * - types.ts: Core type definitions
 * - registry.ts: Tool registration and discovery
 * - permission.ts: Permission checking system
 * - server.ts: MCP server management
 * - builtin/: Built-in tool implementations
 * - domain/: Domain-specific tools (Stanley, Zee)
 */

// ============================================================================
// Core Exports
// ============================================================================

export * from './types';
export {
  ToolRegistry,
  getToolRegistry,
  resetToolRegistry,
  defineTool,
} from './registry';
export {
  PermissionChecker,
  PermissionDeniedError,
  type PermissionCheckContext,
  type PermissionRequest,
  type PermissionResponse,
} from './permission';
export {
  McpServerManager,
  McpOAuthManager,
  getMcpServerManager,
  resetMcpServerManager,
} from './server';

// ============================================================================
// Tool Exports
// ============================================================================

export * from './builtin';
export * from './domain';

// ============================================================================
// Initialization
// ============================================================================

import { getToolRegistry } from './registry';
import { getMcpServerManager, resetMcpServerManager } from './server';
import { registerBuiltinTools } from './builtin';
import { registerStanleyTools, registerZeeTools, registerJohnyTools, registerZeeFullTools, registerAllDomainTools } from './domain';
import type { McpServerConfig, SurfaceType, AgentInfo } from './types';

/**
 * Initialize the MCP tools layer
 *
 * @param options Configuration options
 * @returns Initialized registry and server manager
 */
export async function initializeMcp(options?: {
  /** MCP server configurations */
  mcpServers?: Record<string, McpServerConfig>;
  /** Enable Stanley domain tools */
  enableStanley?: boolean;
  /** Enable Zee domain tools */
  enableZee?: boolean;
  /** Enable Johny domain tools */
  enableJohny?: boolean;
  /** Enable full domain tools (async load from src/domain/) */
  enableFullDomainTools?: boolean;
  /** Permission configuration */
  permissions?: {
    surface?: SurfaceType;
    askHandler?: (request: import('./permission').PermissionRequest) => Promise<import('./permission').PermissionResponse>;
  };
}): Promise<{
  registry: import('./registry').ToolRegistry;
  serverManager: import('./server').McpServerManager;
}> {
  const registry = getToolRegistry();
  const serverManager = getMcpServerManager();

  // Set up permission checker with ask handler if provided
  if (options?.permissions?.askHandler) {
    registry.setAskHandler(options.permissions.askHandler);
  }

  // Register built-in tools
  registerBuiltinTools();

  // Register domain tools based on options
  if (options?.enableStanley !== false) {
    registerStanleyTools();
  }
  if (options?.enableZee !== false) {
    registerZeeTools();
  }

  // Register full domain tools (Johny + full Zee with WhatsApp/Splitwise/etc.)
  if (options?.enableFullDomainTools !== false) {
    await registerAllDomainTools();
  } else {
    // Register individual persona tools if full tools disabled
    if (options?.enableJohny !== false) {
      await registerJohnyTools();
    }
  }

  // Initialize MCP servers if configured
  if (options?.mcpServers) {
    await serverManager.initializeAll(options.mcpServers);
  }

  // Mark registry as initialized
  registry.markInitialized();

  return { registry, serverManager };
}

/**
 * Shutdown the MCP tools layer
 */
export async function shutdownMcp(): Promise<void> {
  const serverManager = getMcpServerManager();
  await serverManager.shutdown();
  resetMcpServerManager();

  const registry = getToolRegistry();
  registry.clear();
}

/**
 * Get tools available for an agent on a specific surface
 *
 * @param agent Agent information
 * @param surface Target surface
 * @returns Map of tool ID to runtime configuration
 */
export async function getToolsForAgent(
  agent: AgentInfo,
  surface?: SurfaceType
): Promise<Map<string, import('./types').ToolRuntime>> {
  const registry = getToolRegistry();
  return registry.getToolsForAgent(agent, surface);
}

// ============================================================================
// Convenience Types
// ============================================================================

export type {
  ToolDefinition,
  ToolRuntime,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolMetadata,
  ToolInitContext,
  ToolCategory,
  ToolPermission,
  ToolRegistryEntry,
  ToolRegistryEvents,
  SurfaceType,
  SurfacePermissions,
  PermissionAction,
  AgentInfo,
  AgentPermissions,
  McpServerConfig,
  McpLocalConfig,
  McpRemoteConfig,
  McpServerStatus,
  McpOAuthConfig,
  StanleyTools,
  ZeeTools,
  FileAttachment,
} from './types';
