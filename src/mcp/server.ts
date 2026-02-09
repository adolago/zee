/**
 * MCP Server Management
 *
 * Handles connection and lifecycle management for MCP servers:
 * - Local servers (stdio transport)
 * - Remote servers (HTTP/SSE transport)
 * - OAuth authentication for remote servers
 * - Tool discovery and registration
 */

import { EventEmitter } from 'eventemitter3';
import type {
  McpServerConfig,
  McpLocalConfig,
  McpRemoteConfig,
  McpServerStatus,
  ToolDefinition,
} from './types';
import { getToolRegistry, defineTool } from './registry';
import { McpOAuthManager } from './oauth';
import { Log } from '../../packages/zee-core/src/util/log';

const log = Log.create({ service: 'mcp-server' });

// ============================================================================
// MCP Server Events
// ============================================================================

interface McpServerEvents {
  'status:changed': { serverId: string; status: McpServerStatus };
  'tools:changed': { serverId: string };
  'connected': { serverId: string; toolCount: number };
  'disconnected': { serverId: string };
  'error': { serverId: string; error: Error };
}

// ============================================================================
// MCP Client Interface (SDK compatibility)
// ============================================================================

/**
 * Abstract interface for MCP client operations
 * Implementations will use @modelcontextprotocol/sdk
 */
interface McpClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  onNotification(handler: (notification: McpNotification) => void): void;
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface McpNotification {
  method: string;
  params?: unknown;
}

// ============================================================================
// MCP Server Connection
// ============================================================================

interface ServerConnection {
  id: string;
  config: McpServerConfig;
  client?: McpClient;
  status: McpServerStatus;
  tools: Map<string, ToolDefinition>;
}

// ============================================================================
// MCP Server Manager
// ============================================================================

export class McpServerManager extends EventEmitter<McpServerEvents> {
  private servers: Map<string, ServerConnection> = new Map();
  private clientFactory: McpClientFactory;
  private oauthManager: McpOAuthManager;
  private defaultTimeout: number = 5000;

  constructor(options?: {
    clientFactory?: McpClientFactory;
    oauthManager?: McpOAuthManager;
    defaultTimeout?: number;
  }) {
    super();
    this.clientFactory = options?.clientFactory ?? new DefaultMcpClientFactory();
    this.oauthManager = options?.oauthManager ?? new McpOAuthManager();
    this.defaultTimeout = options?.defaultTimeout ?? 5000;
  }

  // --------------------------------------------------------------------------
  // Server Management
  // --------------------------------------------------------------------------

  /**
   * Add and connect to an MCP server
   */
  async add(serverId: string, config: McpServerConfig): Promise<McpServerStatus> {
    // Check if server is disabled
    if (config.enabled === false) {
      const connection: ServerConnection = {
        id: serverId,
        config,
        status: { status: 'disabled' },
        tools: new Map(),
      };
      this.servers.set(serverId, connection);
      return connection.status;
    }

    // Create connection entry
    const connection: ServerConnection = {
      id: serverId,
      config,
      status: { status: 'disabled' },
      tools: new Map(),
    };
    this.servers.set(serverId, connection);

    // Connect to server
    return this.connect(serverId);
  }

  /**
   * Connect to a server
   */
  async connect(serverId: string): Promise<McpServerStatus> {
    const connection = this.servers.get(serverId);
    if (!connection) {
      return { status: 'failed', error: `Server not found: ${serverId}` };
    }

    try {
      // Create appropriate client based on config type
      const client = await this.createClient(serverId, connection.config);

      // Connect
      await client.connect();
      connection.client = client;

      // Register notification handler
      client.onNotification((notification) => {
        if (notification.method === 'notifications/tools/list_changed') {
          this.handleToolsChanged(serverId);
        }
      });

      // Discover tools
      await this.discoverTools(serverId);

      // Update status
      connection.status = { status: 'connected' };
      this.emit('status:changed', { serverId, status: connection.status });
      this.emit('connected', { serverId, toolCount: connection.tools.size });

      return connection.status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for OAuth-specific errors
      if (this.isOAuthError(error)) {
        if (this.isRegistrationError(error)) {
          connection.status = {
            status: 'needs_client_registration',
            error: 'Server requires pre-registered client ID',
          };
        } else {
          connection.status = { status: 'needs_auth' };
        }
      } else {
        connection.status = { status: 'failed', error: errorMessage };
      }

      this.emit('status:changed', { serverId, status: connection.status });
      this.emit('error', { serverId, error: error as Error });

      return connection.status;
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnect(serverId: string): Promise<void> {
    const connection = this.servers.get(serverId);
    if (!connection?.client) return;

    try {
      await connection.client.close();
    } catch (error) {
      log.error('Failed to close MCP client', {
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Unregister tools
    this.unregisterServerTools(serverId);

    connection.client = undefined;
    connection.status = { status: 'disabled' };
    connection.tools.clear();

    this.emit('status:changed', { serverId, status: connection.status });
    this.emit('disconnected', { serverId });
  }

  /**
   * Remove a server completely
   */
  async remove(serverId: string): Promise<void> {
    await this.disconnect(serverId);
    this.servers.delete(serverId);
  }

  /**
   * Reconnect to a server
   */
  async reconnect(serverId: string): Promise<McpServerStatus> {
    await this.disconnect(serverId);
    return this.connect(serverId);
  }

  // --------------------------------------------------------------------------
  // Status & Information
  // --------------------------------------------------------------------------

  /**
   * Get server status
   */
  getStatus(serverId: string): McpServerStatus | undefined {
    return this.servers.get(serverId)?.status;
  }

  /**
   * Get all server statuses
   */
  getAllStatuses(): Record<string, McpServerStatus> {
    const result: Record<string, McpServerStatus> = {};
    for (const [id, connection] of this.servers) {
      result[id] = connection.status;
    }
    return result;
  }

  /**
   * Get connected server IDs
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, conn]) => conn.status.status === 'connected')
      .map(([id]) => id);
  }

  /**
   * Get tools for a server
   */
  getServerTools(serverId: string): ToolDefinition[] {
    const connection = this.servers.get(serverId);
    return connection ? Array.from(connection.tools.values()) : [];
  }

  // --------------------------------------------------------------------------
  // Tool Discovery
  // --------------------------------------------------------------------------

  /**
   * Discover and register tools from a server
   */
  private async discoverTools(serverId: string): Promise<void> {
    const connection = this.servers.get(serverId);
    if (!connection?.client) return;

    try {
      const timeout = connection.config.timeout ?? this.defaultTimeout;
      const mcpTools = await Promise.race([
        connection.client.listTools(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tool discovery timeout')), timeout)
        ),
      ]);

      // Clear existing tools
      this.unregisterServerTools(serverId);
      connection.tools.clear();

      // Register new tools
      const registry = getToolRegistry();
      for (const mcpTool of mcpTools) {
        const tool = this.convertMcpTool(serverId, mcpTool, connection.client);
        connection.tools.set(tool.id, tool);
        registry.register(tool, { source: 'mcp', serverId, enabled: true });
      }
    } catch (error) {
      log.error('Failed to discover tools from server', {
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Handle tools changed notification
   */
  private async handleToolsChanged(serverId: string): Promise<void> {
    try {
      await this.discoverTools(serverId);
      this.emit('tools:changed', { serverId });
    } catch (error) {
      log.error('Failed to refresh tools', {
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Convert MCP tool to ToolDefinition
   */
  private convertMcpTool(
    serverId: string,
    mcpTool: McpToolDefinition,
    client: McpClient
  ): ToolDefinition {
    const sanitizedServerId = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const toolId = `${sanitizedServerId}_${sanitizedToolName}`;

    return defineTool(toolId, 'mcp', {
      description: mcpTool.description ?? '',
      parameters: this.buildZodSchema(mcpTool.inputSchema),
      execute: async (args, _ctx) => {
        const result = await client.callTool(mcpTool.name, args as Record<string, unknown>);
        return {
          title: mcpTool.name,
          metadata: { serverId, originalName: mcpTool.name },
          output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        };
      },
    });
  }

  /**
   * Build Zod schema from JSON Schema
   */
  private buildZodSchema(
    _inputSchema: McpToolDefinition['inputSchema']
  ): import('zod').ZodType<Record<string, unknown>> {
    // Dynamic import to avoid bundling issues
    const { z } = require('zod');

    // For now, accept any object - in production, convert JSON Schema to Zod
    return z.object({}).passthrough();
  }

  /**
   * Unregister all tools from a server
   */
  private unregisterServerTools(serverId: string): void {
    const registry = getToolRegistry();
    registry.unregisterByServer(serverId);
  }

  // --------------------------------------------------------------------------
  // Client Creation
  // --------------------------------------------------------------------------

  /**
   * Create appropriate client for config type
   */
  private async createClient(serverId: string, config: McpServerConfig): Promise<McpClient> {
    if (config.type === 'local') {
      return this.clientFactory.createLocalClient(serverId, config);
    } else {
      return this.clientFactory.createRemoteClient(serverId, config, this.oauthManager);
    }
  }

  // --------------------------------------------------------------------------
  // OAuth Helpers
  // --------------------------------------------------------------------------

  private isOAuthError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.name === 'UnauthorizedError' ||
             error.message.includes('401') ||
             error.message.includes('unauthorized');
    }
    return false;
  }

  private isRegistrationError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('registration') ||
             error.message.includes('client_id');
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // OAuth Authentication
  // --------------------------------------------------------------------------

  /**
   * Start OAuth flow for a server
   */
  async startAuth(serverId: string): Promise<{ authorizationUrl: string }> {
    const connection = this.servers.get(serverId);
    if (!connection) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (connection.config.type !== 'remote') {
      throw new Error(`Server ${serverId} is not a remote server`);
    }

    return this.oauthManager.startAuth(serverId, connection.config);
  }

  /**
   * Complete OAuth flow
   */
  async finishAuth(serverId: string, authorizationCode: string): Promise<McpServerStatus> {
    const connection = this.servers.get(serverId);
    if (!connection) {
      throw new Error(`Server not found: ${serverId}`);
    }

    await this.oauthManager.finishAuth(serverId, authorizationCode);
    return this.reconnect(serverId);
  }

  /**
   * Remove OAuth credentials
   */
  async removeAuth(serverId: string): Promise<void> {
    await this.oauthManager.removeAuth(serverId);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize all servers from config
   */
  async initializeAll(configs: Record<string, McpServerConfig>): Promise<void> {
    await Promise.all(
      Object.entries(configs).map(([id, config]) => this.add(id, config))
    );
  }

  /**
   * Shutdown all servers
   */
  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.servers.keys()).map((id) => this.disconnect(id))
    );
    this.servers.clear();
  }
}

// ============================================================================
// MCP Client Factory
// ============================================================================

interface McpClientFactory {
  createLocalClient(serverId: string, config: McpLocalConfig): Promise<McpClient>;
  createRemoteClient(
    serverId: string,
    config: McpRemoteConfig,
    oauthManager: McpOAuthManager
  ): Promise<McpClient>;
}

/**
 * Default client factory using MCP SDK
 * This is a placeholder - actual implementation would use @modelcontextprotocol/sdk
 */
class DefaultMcpClientFactory implements McpClientFactory {
  async createLocalClient(_serverId: string, _config: McpLocalConfig): Promise<McpClient> {
    // In production, this would use StdioClientTransport from MCP SDK
    throw new Error('MCP SDK not available - implement with @modelcontextprotocol/sdk');
  }

  async createRemoteClient(
    _serverId: string,
    _config: McpRemoteConfig,
    _oauthManager: McpOAuthManager
  ): Promise<McpClient> {
    // In production, this would use StreamableHTTPClientTransport or SSEClientTransport
    throw new Error('MCP SDK not available - implement with @modelcontextprotocol/sdk');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let serverManagerInstance: McpServerManager | undefined;

/**
 * Get the global MCP server manager instance
 */
export function getMcpServerManager(): McpServerManager {
  if (!serverManagerInstance) {
    serverManagerInstance = new McpServerManager();
  }
  return serverManagerInstance;
}

/**
 * Reset the global server manager (for testing)
 */
export function resetMcpServerManager(): void {
  serverManagerInstance?.shutdown();
  serverManagerInstance = undefined;
}

// Re-export OAuth types from new module for backwards compatibility
export { McpOAuthManager, type OAuthTokens, type OAuthClientInfo, type McpOAuthConfig } from './oauth';
