/**
 * Agent Module - Core types and interfaces for agent configuration
 *
 * This module defines the base agent interface and types used throughout
 * the Zee system. It supports these use cases:
 * - Stanley: Professional financial analysis
 * - Zee: Personal AI assistant
 * - Custom: User-defined agent variants
 */

import { z } from "zod";

/**
 * Permission levels for agent capabilities
 * - allow: Automatically permitted
 * - ask: Requires user confirmation
 * - deny: Always blocked
 */
export const Permission = z.enum(["allow", "ask", "deny"]);
export type Permission = z.infer<typeof Permission>;

/**
 * Agent operating modes
 * - primary: User-facing agent, can be selected directly
 * - subagent: Internal agent spawned by primary agents
 * - all: Can operate in both modes
 */
export const AgentMode = z.enum(["primary", "subagent", "all"]);
export type AgentMode = z.infer<typeof AgentMode>;

/**
 * Use case categories for personas
 */
export const UseCase = z.enum(["stanley", "zee", "opencode", "custom"]);
export type UseCase = z.infer<typeof UseCase>;

/**
 * Model configuration specifying provider and model ID
 */
export const ModelConfig = z.object({
  providerID: z.string().describe("Provider identifier (e.g., 'anthropic', 'openrouter')"),
  modelID: z.string().describe("Model identifier within the provider"),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

/**
 * Parse a model string in format "provider/model" into ModelConfig
 */
export function parseModelString(model: string): ModelConfig {
  const parts = model.split("/");
  if (parts.length < 2) {
    throw new Error(`Invalid model format: ${model}. Expected 'provider/model'`);
  }
  return {
    providerID: parts[0],
    modelID: parts.slice(1).join("/"),
  };
}

/**
 * Permission configuration for agent capabilities
 * Supports both simple permission values and pattern-based rules
 */
export const PermissionConfig = z.object({
  /** File edit permission */
  edit: Permission.optional().default("allow"),

  /** Bash command permissions - can be simple or pattern-based */
  bash: z
    .union([Permission, z.record(z.string(), Permission)])
    .optional()
    .default("allow"),

  /** Skill invocation permissions */
  skill: z
    .union([Permission, z.record(z.string(), Permission)])
    .optional()
    .default("allow"),

  /** MCP tool permissions */
  mcp: z
    .union([Permission, z.record(z.string(), Permission)])
    .optional()
    .default("allow"),

  /** Web fetch permission */
  webfetch: Permission.optional().default("allow"),

  /** External directory access permission */
  external_directory: Permission.optional().default("ask"),

  /** Doom loop detection permission (repeated identical tool calls) */
  doom_loop: Permission.optional().default("ask"),
});
export type PermissionConfig = z.infer<typeof PermissionConfig>;

/**
 * Tool configuration for agents
 */
export const ToolConfig = z.object({
  /** Tools to explicitly enable */
  whitelist: z.array(z.string()).optional(),

  /** Tools to explicitly disable */
  blacklist: z.array(z.string()).optional(),

  /** Per-tool overrides (true = enabled, false = disabled) */
  overrides: z.record(z.string(), z.boolean()).optional(),
});
export type ToolConfig = z.infer<typeof ToolConfig>;

/**
 * Base agent information interface
 * This is the core type used to configure agent behavior
 */
export const AgentInfo = z
  .object({
    // === Identity ===

    /** Unique agent name/identifier */
    name: z.string(),

    /** Human-readable description of when to use this agent */
    description: z.string().optional(),

    // === Mode ===

    /** Operating mode: primary, subagent, or all */
    mode: AgentMode.default("primary"),

    /** Whether this is a built-in (native) agent */
    native: z.boolean().optional().default(false),

    /** Whether to hide from user agent selection */
    hidden: z.boolean().optional().default(false),

    /** Whether this is the default agent */
    default: z.boolean().optional().default(false),

    // === Model Settings ===

    /** Model configuration (provider + model ID) */
    model: ModelConfig.optional(),

    /** Temperature for response generation (0-2) */
    temperature: z.number().min(0).max(2).optional(),

    /** Top-P (nucleus) sampling parameter (0-1) */
    topP: z.number().min(0).max(1).optional(),

    /** Maximum agentic steps before forcing text response */
    maxSteps: z.number().int().positive().optional(),

    // === Behavior ===

    /** System prompt for the agent */
    prompt: z.string().optional(),

    /** Permission configuration */
    permission: PermissionConfig.optional(),

    /** Tool configuration */
    tools: z
      .union([ToolConfig, z.record(z.string(), z.boolean())])
      .optional(),

    // === Metadata ===

    /** Display color (hex format) */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),

    /** Use case category */
    useCase: UseCase.optional(),

    /** Additional options for extensibility */
    options: z.record(z.string(), z.any()).optional(),
  })
  .describe("AgentInfo");
export type AgentInfo = z.infer<typeof AgentInfo>;

/**
 * Agent configuration from config file
 * Looser schema that allows partial configuration
 */
export const AgentConfig = z
  .object({
    model: z.string().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    prompt: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    disable: z.boolean().optional(),
    description: z.string().optional(),
    mode: AgentMode.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    maxSteps: z.number().int().positive().optional(),
    permission: z
      .object({
        edit: Permission.optional(),
        bash: z.union([Permission, z.record(z.string(), Permission)]).optional(),
        skill: z.union([Permission, z.record(z.string(), Permission)]).optional(),
        mcp: z.union([Permission, z.record(z.string(), Permission)]).optional(),
        webfetch: Permission.optional(),
        external_directory: Permission.optional(),
        doom_loop: Permission.optional(),
      })
      .optional(),
  })
  .catchall(z.any())
  .describe("AgentConfig");
export type AgentConfig = z.infer<typeof AgentConfig>;

/**
 * Agent state management
 */
export interface AgentState {
  /** Registered agents by name */
  agents: Map<string, AgentInfo>;

  /** Default agent name */
  defaultAgent: string;
}

/**
 * Agent namespace for managing agents
 */
export namespace Agent {
  /** Schema exports for validation */
  export const Info = AgentInfo;
  export const Config = AgentConfig;
  export const Mode = AgentMode;

  /**
   * Create default permission configuration
   */
  export function defaultPermissions(): PermissionConfig {
    return {
      edit: "allow",
      bash: { "*": "allow" },
      skill: { "*": "allow" },
      mcp: { "*": "allow" },
      webfetch: "allow",
      external_directory: "ask",
      doom_loop: "ask",
    };
  }

  /**
   * Create read-only (plan mode) permission configuration
   */
  export function planPermissions(): PermissionConfig {
    return {
      edit: "deny",
      bash: {
        "cut*": "allow",
        "diff*": "allow",
        "du*": "allow",
        "file *": "allow",
        "find * -delete*": "ask",
        "find * -exec*": "ask",
        "find * -fprint*": "ask",
        "find *": "allow",
        "git diff*": "allow",
        "git log*": "allow",
        "git show*": "allow",
        "git status*": "allow",
        "git branch": "allow",
        "git branch -v": "allow",
        "grep*": "allow",
        "head*": "allow",
        "less*": "allow",
        "ls*": "allow",
        "more*": "allow",
        "pwd*": "allow",
        "rg*": "allow",
        "sort*": "allow",
        "stat*": "allow",
        "tail*": "allow",
        "tree*": "allow",
        "uniq*": "allow",
        "wc*": "allow",
        "whereis*": "allow",
        "which*": "allow",
        "*": "ask",
      },
      skill: "allow",
      mcp: "allow",
      webfetch: "allow",
      external_directory: "ask",
      doom_loop: "ask",
    };
  }

  /**
   * Merge two permission configurations
   * Override values take precedence over base values
   */
  export function mergePermissions(
    base: PermissionConfig,
    override: Partial<PermissionConfig>
  ): PermissionConfig {
    const result: PermissionConfig = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;

      const baseValue = base[key as keyof PermissionConfig];

      // Normalize to object form for pattern-based permissions
      if (key === "bash" || key === "skill" || key === "mcp") {
        const baseObj =
          typeof baseValue === "string" ? { "*": baseValue } : baseValue || {};
        const overrideObj =
          typeof value === "string" ? { "*": value } : value || {};

        (result as any)[key] = { ...baseObj, ...overrideObj };
      } else {
        (result as any)[key] = value;
      }
    }

    return result;
  }

  /**
   * Merge two agent configurations
   */
  export function mergeAgents(
    base: AgentInfo,
    override: Partial<AgentInfo>
  ): AgentInfo {
    const result = { ...base, ...override };

    // Special handling for permission merge
    if (base.permission && override.permission) {
      result.permission = mergePermissions(base.permission, override.permission);
    }

    // Special handling for tools merge
    if (base.tools && override.tools) {
      if (typeof base.tools === "object" && typeof override.tools === "object") {
        const baseTools = "overrides" in base.tools ? base.tools.overrides : base.tools;
        const overrideTools = "overrides" in override.tools ? override.tools.overrides : override.tools;
        if (typeof baseTools === "object" && typeof overrideTools === "object" && baseTools && overrideTools) {
          result.tools = { ...(baseTools as Record<string, unknown>), ...(overrideTools as Record<string, unknown>) };
        }
      }
    }

    // Special handling for options merge
    if (base.options && override.options) {
      result.options = { ...base.options, ...override.options };
    }

    return result;
  }

  /**
   * Validate an agent configuration
   */
  export function validate(agent: unknown): AgentInfo {
    return AgentInfo.parse(agent);
  }

  /**
   * Check if an agent is a primary agent
   */
  export function isPrimary(agent: AgentInfo): boolean {
    return agent.mode === "primary" || agent.mode === "all";
  }

  /**
   * Check if an agent is a subagent
   */
  export function isSubagent(agent: AgentInfo): boolean {
    return agent.mode === "subagent" || agent.mode === "all";
  }

  /**
   * Check if an agent is visible to users
   */
  export function isVisible(agent: AgentInfo): boolean {
    return !agent.hidden;
  }
}
