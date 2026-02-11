/**
 * MCP Tools Permission System
 *
 * Handles permission checking for tool execution with support for:
 * - Per-tool permissions (allow/deny/ask)
 * - Pattern-based permissions (for bash commands, file paths, etc.)
 * - Surface-specific defaults
 * - User overrides
 */

import type {
  PermissionAction,
  ToolPermission,
  SurfacePermissions,
  AgentInfo,
  ToolCategory,
  SurfaceType,
} from './types';
import { Log } from '../../packages/zee/src/util/log';

const log = Log.create({ service: 'mcp-permission' });

// ============================================================================
// Permission Check Context
// ============================================================================

export interface PermissionCheckContext {
  toolId: string;
  toolCategory: ToolCategory;
  agent: AgentInfo;
  surface?: SurfaceType;
  /** Additional context for pattern matching (e.g., command for bash) */
  patterns?: {
    command?: string[];
    path?: string;
    url?: string;
  };
}

export interface PermissionRequest {
  type:
    | 'bash'
    | 'edit'
    | 'write'
    | 'read'
    | 'glob'
    | 'grep'
    | 'webfetch'
    | 'websearch'
    | 'codesearch'
    | 'task'
    | 'skill'
    | 'external_directory'
    | 'mcp';
  pattern?: string | string[];
  sessionId: string;
  messageId: string;
  callId?: string;
  title: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionResponse {
  granted: boolean;
  remember?: boolean;
  rememberPattern?: string;
}

// ============================================================================
// Permission Checker
// ============================================================================

export class PermissionChecker {
  private permissions: SurfacePermissions;
  private runtimeOverrides: Map<string, PermissionAction> = new Map();
  private askHandler?: (request: PermissionRequest) => Promise<PermissionResponse>;

  constructor(permissions?: Partial<SurfacePermissions>) {
    this.permissions = {
      surfaces: permissions?.surfaces ?? {
        cli: {},
        web: {},
        api: {},
        whatsapp: {},
      },
      global: permissions?.global ?? {},
      overrides: permissions?.overrides ?? {},
    };
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Set the handler for "ask" permissions
   */
  setAskHandler(handler: (request: PermissionRequest) => Promise<PermissionResponse>): void {
    this.askHandler = handler;
  }

  /**
   * Update global permissions
   */
  setGlobalPermission(toolId: string, permission: ToolPermission): void {
    this.permissions.global[toolId] = permission;
  }

  /**
   * Update surface-specific permissions
   */
  setSurfacePermission(
    surface: SurfaceType,
    toolId: string,
    permission: ToolPermission
  ): void {
    if (!this.permissions.surfaces[surface]) {
      this.permissions.surfaces[surface] = {};
    }
    this.permissions.surfaces[surface][toolId] = permission;
  }

  /**
   * Set user override
   */
  setOverride(toolId: string, permission: ToolPermission): void {
    this.permissions.overrides[toolId] = permission;
  }

  /**
   * Set runtime override (session-level, not persisted)
   */
  setRuntimeOverride(pattern: string, action: PermissionAction): void {
    this.runtimeOverrides.set(pattern, action);
  }

  // --------------------------------------------------------------------------
  // Permission Resolution
  // --------------------------------------------------------------------------

  /**
   * Get the effective permission for a tool
   * Priority: runtime overrides > user overrides > surface defaults > global defaults
   */
  getEffectivePermission(
    toolId: string,
    surface?: SurfaceType,
    pattern?: string
  ): ToolPermission {
    // Check runtime overrides first
    if (pattern) {
      const runtimeAction = this.runtimeOverrides.get(pattern);
      if (runtimeAction) {
        return { default: runtimeAction };
      }
    }

    // Check user overrides
    if (this.permissions.overrides[toolId]) {
      return this.permissions.overrides[toolId];
    }

    // Check surface-specific defaults
    if (surface && this.permissions.surfaces[surface]?.[toolId]) {
      return this.permissions.surfaces[surface][toolId]!;
    }

    // Check global defaults
    if (this.permissions.global[toolId]) {
      return this.permissions.global[toolId];
    }

    // Fall back to built-in defaults for this surface (if any)
    if (surface) {
      const defaults = PermissionChecker.getDefaultSurfacePermissions(surface);
      const surfaceDefault = defaults[toolId];
      if (surfaceDefault) {
        return surfaceDefault;
      }
    }

    // Default permission
    return { default: 'allow' };
  }

  /**
   * Check if a tool is allowed for an agent
   */
  isToolAllowed(toolId: string, agent: AgentInfo, category: ToolCategory): boolean {
    // Check agent-level permission restrictions
    const agentPerms = agent.permission;

    switch (toolId) {
      case 'bash':
        // Bash is denied if all patterns are denied
        if (
          agentPerms.bash['*'] === 'deny' &&
          Object.keys(agentPerms.bash).length === 1
        ) {
          return false;
        }
        break;

      case 'edit':
        if (agentPerms.edit === 'deny') {
          return false;
        }
        break;

      case 'write':
        if (agentPerms.write === 'deny') {
          return false;
        }
        break;

      case 'webfetch':
      case 'websearch':
      case 'codesearch':
        if (agentPerms.webfetch === 'deny') {
          return false;
        }
        break;

      case 'skill':
        if (
          agentPerms.skill['*'] === 'deny' &&
          Object.keys(agentPerms.skill).length === 1
        ) {
          return false;
        }
        break;
    }

    // Check MCP tool permissions
    if (category === 'mcp') {
      const mcpPerm = agentPerms.mcp[toolId];
      if (mcpPerm?.default === 'deny') {
        return false;
      }
    }

    return true;
  }

  /**
   * Check permission with pattern matching
   */
  async checkPermission(ctx: PermissionCheckContext): Promise<PermissionAction> {
    const { toolId, toolCategory, agent, surface, patterns } = ctx;

    // First check if tool is even allowed
    if (!this.isToolAllowed(toolId, agent, toolCategory)) {
      return 'deny';
    }

    const patternKey =
      patterns?.command ? patterns.command.join(' ') :
      patterns?.path ? patterns.path :
      patterns?.url ? patterns.url :
      undefined;

    // Get effective permission
    const permission = this.getEffectivePermission(toolId, surface, patternKey);

    // Check pattern-based permissions if patterns provided
    if (patterns && permission.patterns) {
      const patternResult = this.checkPatterns(patterns, permission.patterns);
      if (patternResult) {
        return patternResult;
      }
    }

    return permission.default;
  }

  /**
   * Check pattern-based permissions
   */
  private checkPatterns(
    input: PermissionCheckContext['patterns'],
    patterns: Record<string, PermissionAction>
  ): PermissionAction | null {
    if (!input) return null;

    // Check command patterns for bash
    if (input.command) {
      const commandStr = input.command.join(' ');
      for (const [pattern, action] of Object.entries(patterns)) {
        if (this.matchPattern(commandStr, pattern)) {
          return action;
        }
      }
    }

    // Check path patterns
    if (input.path) {
      for (const [pattern, action] of Object.entries(patterns)) {
        if (this.matchPattern(input.path, pattern)) {
          return action;
        }
      }
    }

    // Check URL patterns
    if (input.url) {
      for (const [pattern, action] of Object.entries(patterns)) {
        if (this.matchPattern(input.url, pattern)) {
          return action;
        }
      }
    }

    return null;
  }

  /**
   * Match a value against a pattern (supports wildcards)
   */
  private matchPattern(value: string, pattern: string): boolean {
    // Exact match
    if (pattern === value) return true;

    // Wildcard at end: "npm *" matches "npm install"
    if (pattern.endsWith(' *')) {
      const prefix = pattern.slice(0, -2);
      return value.startsWith(prefix);
    }

    // Wildcard anywhere: convert to regex
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(value);
    }

    // Prefix match for commands
    if (value.startsWith(pattern + ' ')) {
      return true;
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Ask Permission Flow
  // --------------------------------------------------------------------------

  /**
   * Request permission from user for "ask" actions
   */
  async askPermission(request: PermissionRequest): Promise<boolean> {
    if (!this.askHandler) {
      // No handler configured, deny by default
      log.warn('No permission ask handler configured, denying by default', {
        type: request.type,
        title: request.title,
      });
      return false;
    }

    const response = await this.askHandler(request);

    // Store the decision if remember was requested
    if (response.remember && response.rememberPattern) {
      this.setRuntimeOverride(
        response.rememberPattern,
        response.granted ? 'allow' : 'deny'
      );
    }

    return response.granted;
  }

  // --------------------------------------------------------------------------
  // Default Permission Configurations
  // --------------------------------------------------------------------------

  /**
   * Get default permissions for a surface
   */
  static getDefaultSurfacePermissions(surface: SurfaceType): Record<string, ToolPermission> {
    switch (surface) {
      case 'cli':
        // CLI has most permissive defaults
        return {
          bash: { default: 'ask', patterns: { 'git *': 'allow', 'npm *': 'allow' } },
          edit: { default: 'allow' },
          write: { default: 'allow' },
          read: { default: 'allow' },
          glob: { default: 'allow' },
          grep: { default: 'allow' },
          webfetch: { default: 'ask' },
          task: { default: 'allow' },
          skill: { default: 'allow' },
        };

      case 'web':
        // Web is more restrictive
        return {
          bash: { default: 'deny' },
          edit: { default: 'ask' },
          write: { default: 'ask' },
          read: { default: 'allow' },
          glob: { default: 'allow' },
          grep: { default: 'allow' },
          webfetch: { default: 'ask' },
          task: { default: 'allow' },
          skill: { default: 'allow' },
        };

      case 'api':
        // API assumes trusted client
        return {
          bash: { default: 'allow' },
          edit: { default: 'allow' },
          write: { default: 'allow' },
          read: { default: 'allow' },
          glob: { default: 'allow' },
          grep: { default: 'allow' },
          webfetch: { default: 'allow' },
          task: { default: 'allow' },
          skill: { default: 'allow' },
        };

      case 'whatsapp':
        // WhatsApp is most restrictive - no file/system operations
        return {
          bash: { default: 'deny' },
          edit: { default: 'deny' },
          write: { default: 'deny' },
          read: { default: 'deny' },
          glob: { default: 'deny' },
          grep: { default: 'deny' },
          webfetch: { default: 'allow' },
          task: { default: 'deny' },
          skill: { default: 'allow' },
        };

      default:
        return {};
    }
  }
}

// ============================================================================
// Permission Error
// ============================================================================

export class PermissionDeniedError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly permissionType: string,
    public readonly callId?: string,
    public readonly metadata?: Record<string, unknown>,
    message?: string
  ) {
    super(message ?? `Permission denied: ${permissionType}`);
    this.name = 'PermissionDeniedError';
  }
}
