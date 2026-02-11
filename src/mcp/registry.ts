/**
 * MCP Tools Registry
 *
 * Central registry for all tools across built-in, MCP servers, plugins, and domain tools.
 * Provides tool discovery, registration, and access with permission checking.
 */

import { z } from 'zod';
import { EventEmitter } from 'eventemitter3';
import type {
  ToolDefinition,
  ToolRegistryEntry,
  ToolRegistryEvents,
  ToolInitContext,
  ToolRuntime,
  ToolCategory,
  AgentInfo,
  SurfaceType,
  ToolExecutionContext,
} from './types';
import type { PermissionRequest, PermissionResponse } from './permission';
import { PermissionChecker, PermissionDeniedError } from './permission';
import { Log } from '../../packages/zee/src/util/log';
import { resolveToolSandbox } from './security/sandbox';
import { validateToolPath } from './security/validate-path';

const log = Log.create({ service: 'mcp-registry' });

// ============================================================================
// Surface Tool Restrictions
// ============================================================================

/**
 * Tools restricted on specific surfaces.
 * Configure via environment or pass custom restrictions to the registry.
 */
export const SURFACE_TOOL_RESTRICTIONS: Record<SurfaceType, string[]> = {
  cli: [], // All tools available on CLI
  web: ['bash'], // Bash may be restricted on web
  api: [],
  whatsapp: ['bash', 'write', 'edit'], // File operations restricted on messaging
};

// ============================================================================
// Tool Registry State
// ============================================================================

interface RegistryState {
  tools: Map<string, ToolRegistryEntry>;
  initialized: boolean;
}

// ============================================================================
// Tool Registry
// ============================================================================

export class ToolRegistry extends EventEmitter<ToolRegistryEvents> {
  private state: RegistryState = {
    tools: new Map(),
    initialized: false,
  };

  private permissionChecker: PermissionChecker;

  constructor(permissionChecker?: PermissionChecker) {
    super();
    this.permissionChecker = permissionChecker ?? new PermissionChecker();
  }

  /**
   * Set the handler used when a tool requires interactive approval ("ask").
   */
  setAskHandler(handler: (request: PermissionRequest) => Promise<PermissionResponse>): void {
    this.permissionChecker.setAskHandler(handler);
  }

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  /**
   * Register a tool in the registry
   */
  register(
    tool: ToolDefinition,
    options: {
      source: ToolRegistryEntry['source'];
      serverId?: string;
      enabled?: boolean;
    }
  ): void {
    const entry: ToolRegistryEntry = {
      tool,
      source: options.source,
      serverId: options.serverId,
      enabled: options.enabled ?? true,
    };

    this.state.tools.set(tool.id, entry);
    this.emit('tool:registered', { toolId: tool.id, source: options.source });
  }

  /**
   * Register multiple tools at once
   */
  registerAll(
    tools: ToolDefinition[],
    options: {
      source: ToolRegistryEntry['source'];
      serverId?: string;
      enabled?: boolean;
    }
  ): void {
    for (const tool of tools) {
      this.register(tool, options);
    }
  }

  /**
   * Unregister a tool from the registry
   */
  unregister(toolId: string): boolean {
    const existed = this.state.tools.delete(toolId);
    if (existed) {
      this.emit('tool:unregistered', { toolId });
    }
    return existed;
  }

  /**
   * Unregister all tools from a specific MCP server
   */
  unregisterByServer(serverId: string): number {
    let count = 0;
    for (const [toolId, entry] of this.state.tools) {
      if (entry.serverId === serverId) {
        this.state.tools.delete(toolId);
        this.emit('tool:unregistered', { toolId });
        count++;
      }
    }
    return count;
  }

  // --------------------------------------------------------------------------
  // Tool Access
  // --------------------------------------------------------------------------

  /**
   * Get a tool by ID
   */
  get(toolId: string): ToolRegistryEntry | undefined {
    return this.state.tools.get(toolId);
  }

  /**
   * Check if a tool exists
   */
  has(toolId: string): boolean {
    return this.state.tools.has(toolId);
  }

  /**
   * Get all registered tool IDs
   */
  ids(): string[] {
    return Array.from(this.state.tools.keys());
  }

  /**
   * Get all tools matching criteria
   */
  filter(predicate: (entry: ToolRegistryEntry) => boolean): ToolRegistryEntry[] {
    return Array.from(this.state.tools.values()).filter(predicate);
  }

  /**
   * Get tools by category
   */
  byCategory(category: ToolCategory): ToolRegistryEntry[] {
    return this.filter((entry) => entry.tool.category === category);
  }

  /**
   * Get tools by source
   */
  bySource(source: ToolRegistryEntry['source']): ToolRegistryEntry[] {
    return this.filter((entry) => entry.source === source);
  }

  /**
   * Get tools by MCP server ID
   */
  byServer(serverId: string): ToolRegistryEntry[] {
    return this.filter((entry) => entry.serverId === serverId);
  }

  // --------------------------------------------------------------------------
  // Tool Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize and get runtime configuration for a tool
   */
  async initTool(
    toolId: string,
    ctx?: ToolInitContext
  ): Promise<ToolRuntime | undefined> {
    const entry = this.state.tools.get(toolId);
    if (!entry || !entry.enabled) {
      return undefined;
    }

    const runtime = await entry.tool.init(ctx);
    return this.wrapRuntimeWithPermissions(toolId, entry, runtime, ctx);
  }

  /**
   * Get all initialized tools for an agent
   */
  async getToolsForAgent(
    agent: AgentInfo,
    surface?: SurfaceType
  ): Promise<Map<string, ToolRuntime>> {
    const result = new Map<string, ToolRuntime>();
    const ctx: ToolInitContext = { agent, surface };

    for (const [toolId, entry] of this.state.tools) {
      if (!entry.enabled) continue;

      // Check if tool is enabled for the agent
      const toolEnabled = this.isToolEnabledForAgent(toolId, agent);
      if (!toolEnabled) continue;

      // Check surface-specific availability
      if (surface && !this.isToolAvailableOnSurface(toolId, surface)) {
        continue;
      }

      try {
        const runtime = await entry.tool.init(ctx);
        const wrapped = this.wrapRuntimeWithPermissions(toolId, entry, runtime, ctx);
        result.set(toolId, wrapped);
      } catch (error) {
        log.error('Failed to initialize tool', {
          toolId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private wrapRuntimeWithPermissions(
    toolId: string,
    entry: ToolRegistryEntry,
    runtime: ToolRuntime,
    initCtx?: ToolInitContext,
  ): ToolRuntime {
    const agent = initCtx?.agent;
    const surface = initCtx?.surface;
    if (!agent) return runtime;

    const originalExecute = runtime.execute;
    const checker = this.permissionChecker;

    return {
      ...runtime,
      execute: async (args, execCtx) => {
        const patterns = this.extractPermissionPatterns(toolId, args, execCtx);

        const action = await checker.checkPermission({
          toolId,
          toolCategory: entry.tool.category,
          agent,
          surface,
          patterns,
        });

        if (action === 'deny') {
          throw new PermissionDeniedError(execCtx.sessionId, toolId, execCtx.callId, {
            toolId,
            surface,
            patterns,
          });
        }

        if (action === 'ask') {
          const req = this.buildPermissionRequest(toolId, entry.tool.category, args, execCtx, patterns);
          const ok = await checker.askPermission(req);
          if (!ok) {
            throw new PermissionDeniedError(execCtx.sessionId, toolId, execCtx.callId, {
              toolId,
              surface,
              patterns,
            });
          }
        }

        return originalExecute(args, execCtx);
      },
    };
  }

  private extractPermissionPatterns(
    toolId: string,
    args: unknown,
    execCtx: ToolExecutionContext,
  ): { command?: string[]; path?: string; url?: string } | undefined {
    const a = args as Record<string, unknown> | null;
    if (!a) return undefined;

    if (toolId === 'bash') {
      const argv = a['argv'];
      const command = a['command'];
      if (Array.isArray(argv)) {
        return { command: argv.map((x) => String(x)) };
      }
      if (typeof command === 'string' && command.trim()) {
        return { command: [command.trim()] };
      }
      return undefined;
    }

    if (toolId === 'webfetch') {
      const url = a['url'];
      if (typeof url === 'string' && url.trim()) {
        return { url: url.trim() };
      }
      return undefined;
    }

    // File-ish tools
    if (toolId === 'read' || toolId === 'write' || toolId === 'edit') {
      const filePath = a['filePath'];
      if (typeof filePath === 'string' && filePath.trim()) {
        return { path: this.resolveSandboxedPathPattern(filePath, execCtx) };
      }
      return undefined;
    }

    if (toolId === 'glob' || toolId === 'grep') {
      const p = a['path'];
      if (typeof p === 'string' && p.trim()) {
        return { path: this.resolveSandboxedPathPattern(p, execCtx) };
      }
      // If omitted, treat as cwd for permissions.
      const sandbox = resolveToolSandbox(execCtx);
      return { path: sandbox.cwd };
    }

    return undefined;
  }

  private resolveSandboxedPathPattern(inputPath: string, execCtx: ToolExecutionContext): string {
    const sandbox = resolveToolSandbox(execCtx);
    try {
      return validateToolPath({ filePath: inputPath, cwd: sandbox.cwd, root: sandbox.root }).resolved;
    } catch {
      return inputPath;
    }
  }

  private buildPermissionRequest(
    toolId: string,
    category: ToolCategory,
    args: unknown,
    execCtx: ToolExecutionContext,
    patterns: { command?: string[]; path?: string; url?: string } | undefined,
  ): PermissionRequest {
    const type = this.mapToolToPermissionType(toolId, category);
    const pattern = patterns?.command ?? patterns?.path ?? patterns?.url;

    return {
      type,
      pattern,
      sessionId: execCtx.sessionId,
      messageId: execCtx.messageId,
      callId: execCtx.callId,
      title: this.formatPermissionTitle(type, toolId, pattern),
      metadata: this.buildPermissionMetadata(toolId, category, args, execCtx, patterns),
    };
  }

  private mapToolToPermissionType(toolId: string, category: ToolCategory): PermissionRequest['type'] {
    if (category === 'mcp') return 'mcp';
    switch (toolId) {
      case 'bash':
      case 'edit':
      case 'write':
      case 'read':
      case 'glob':
      case 'grep':
      case 'webfetch':
      case 'task':
      case 'skill':
        return toolId;
      default:
        return 'mcp';
    }
  }

  private formatPermissionTitle(
    type: PermissionRequest['type'],
    toolId: string,
    pattern: string | string[] | undefined,
  ): string {
    const base = type === 'mcp' ? toolId : type;
    if (!pattern) return base;
    const patternText = Array.isArray(pattern) ? pattern.join(' ') : pattern;
    const truncated = patternText.length > 140 ? patternText.slice(0, 140) + '...' : patternText;
    return `${base}: ${truncated}`;
  }

  private buildPermissionMetadata(
    toolId: string,
    category: ToolCategory,
    args: unknown,
    execCtx: ToolExecutionContext,
    patterns: { command?: string[]; path?: string; url?: string } | undefined,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      toolId,
      category,
      patterns,
    };

    if (toolId === 'write') {
      const a = args as Record<string, unknown> | null;
      const content = a && typeof a['content'] === 'string' ? a['content'] : '';
      base['contentChars'] = typeof content === 'string' ? content.length : undefined;
    }

    if (toolId === 'edit') {
      const a = args as Record<string, unknown> | null;
      base['oldStringChars'] = a && typeof a['oldString'] === 'string' ? a['oldString'].length : undefined;
      base['newStringChars'] = a && typeof a['newString'] === 'string' ? a['newString'].length : undefined;
    }

    // Carry through non-sensitive context keys if present.
    if (execCtx.extra && typeof execCtx.extra === 'object') {
      const surface = execCtx.extra['surface'];
      if (typeof surface === 'string') base['surface'] = surface;
    }

    return base;
  }

  // --------------------------------------------------------------------------
  // Tool Enablement
  // --------------------------------------------------------------------------

  /**
   * Enable a tool
   */
  enable(toolId: string): boolean {
    const entry = this.state.tools.get(toolId);
    if (!entry) return false;

    entry.enabled = true;
    this.emit('tool:enabled', { toolId });
    return true;
  }

  /**
   * Disable a tool
   */
  disable(toolId: string): boolean {
    const entry = this.state.tools.get(toolId);
    if (!entry) return false;

    entry.enabled = false;
    this.emit('tool:disabled', { toolId });
    return true;
  }

  /**
   * Check if a tool is enabled for an agent
   */
  isToolEnabledForAgent(toolId: string, agent: AgentInfo): boolean {
    // Check explicit agent tool configuration
    if (agent.tools) {
      const explicitSetting = agent.tools[toolId];
      if (explicitSetting !== undefined) {
        return explicitSetting;
      }
    }

    // Check permission-based restrictions
    const entry = this.state.tools.get(toolId);
    if (!entry) return false;

    return this.permissionChecker.isToolAllowed(toolId, agent, entry.tool.category);
  }

  /**
   * Check if a tool is available on a surface
   */
  isToolAvailableOnSurface(toolId: string, surface: SurfaceType): boolean {
    const entry = this.state.tools.get(toolId);
    if (!entry) return false;

    const restricted = SURFACE_TOOL_RESTRICTIONS[surface];
    return !restricted?.includes(toolId);
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get registry statistics
   */
  stats(): {
    total: number;
    enabled: number;
    disabled: number;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let enabled = 0;
    let disabled = 0;

    for (const entry of this.state.tools.values()) {
      if (entry.enabled) {
        enabled++;
      } else {
        disabled++;
      }

      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      byCategory[entry.tool.category] = (byCategory[entry.tool.category] || 0) + 1;
    }

    return {
      total: this.state.tools.size,
      enabled,
      disabled,
      bySource,
      byCategory,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.state.tools.clear();
    this.state.initialized = false;
  }

  /**
   * Mark registry as initialized
   */
  markInitialized(): void {
    this.state.initialized = true;
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let registryInstance: ToolRegistry | undefined;

/**
 * Get the global tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

/**
 * Reset the global registry (for testing)
 */
export function resetToolRegistry(): void {
  registryInstance?.clear();
  registryInstance = undefined;
}

// ============================================================================
// Tool Definition Helper
// ============================================================================

/**
 * Define a tool with type safety
 */
export function defineTool<
  TParams extends z.ZodType,
  TMeta extends Record<string, unknown> = Record<string, unknown>
>(
  id: string,
  category: ToolCategory,
  init:
    | ToolDefinition<TParams, TMeta>['init']
    | Awaited<ReturnType<ToolDefinition<TParams, TMeta>['init']>>
): ToolDefinition<TParams, TMeta> {
  return {
    id,
    category,
    init: async (ctx) => {
      const toolInfo = typeof init === 'function' ? await init(ctx) : init;

      // Wrap execute to validate parameters
      const originalExecute = toolInfo.execute;
      toolInfo.execute = async (args, execCtx) => {
        try {
          toolInfo.parameters.parse(args);
        } catch (error) {
          if (error instanceof z.ZodError && toolInfo.formatValidationError) {
            throw new Error(toolInfo.formatValidationError(error), { cause: error });
          }
          throw new Error(
            `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
            { cause: error }
          );
        }
        return originalExecute(args, execCtx);
      };

      return toolInfo;
    },
  };
}
