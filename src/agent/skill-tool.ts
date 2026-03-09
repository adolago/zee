/**
 * Skill Tool Module - Unified tool interface for skill invocation
 *
 * This module provides a standardized tool schema for invoking skills
 * in a multi-agent assistant system.
 *
 * @example
 * ```typescript
 * // Create the tool for a specific context
 * const tool = createSkillTool(context, {
 *   invoke: async (skill, params) => { ... },
 *   list: async () => { ... },
 *   handoff: async (target, reason) => { ... },
 * });
 *
 * // Execute via the tool interface
 * const result = await tool.execute({
 *   action: 'invoke',
 *   skill: 'research',
 *   params: { query: 'market analysis' }
 * });
 * ```
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for skill tool input
 *
 * Actions:
 * - invoke: Execute a specific skill
 * - list: List available skills
 * - handoff: Legacy handoff action (unused in single-assistant runtime)
 * - status: Get current agent status
 */
export const SkillToolSchema = z.object({
  /** Action to perform */
  action: z.enum(["invoke", "list", "handoff", "status"]),
  /** Skill name to invoke (for invoke action) */
  skill: z.string().optional(),
  /** Parameters for skill invocation */
  params: z.record(z.string(), z.unknown()).optional(),
  /** Target agent for handoff */
  targetAgent: z.string().optional(),
  /** Reason for handoff */
  reason: z.string().optional(),
  /** Bypass agent filter for cross-agent skill access */
  bypassAgentFilter: z.boolean().optional(),
});

export type SkillToolInput = z.infer<typeof SkillToolSchema>;

// ============================================================================
// Types
// ============================================================================

/**
 * Context for skill execution
 */
export interface SkillContext {
  /** Current agent identifier */
  agentName: string;
  /** Current session identifier */
  sessionId: string;
  /** Whether to bypass agent filtering */
  bypassAgentFilter: boolean;
  /** Currently active skill (if any) */
  activeSkill?: string;
  /** Timestamp of last interaction */
  lastInteraction?: number;
}

/**
 * Result from skill invocation
 */
export interface SkillResult {
  /** Whether the invocation succeeded */
  success: boolean;
  /** Output from the skill */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Handoff request if skill requires handoff */
  handoff?: HandoffSuggestion;
}

/**
 * Handoff suggestion from skill routing
 */
export interface HandoffSuggestion {
  /** Agent that should handle the request */
  targetAgent: string;
  /** Reason for the handoff */
  reason: string;
  /** Skill that triggered this suggestion */
  triggerSkill?: string;
}

/**
 * Result from skill tool execution
 */
export interface SkillToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Handlers for skill tool actions
 */
export interface SkillToolHandlers {
  /** Handle skill invocation */
  invoke: (
    skill: string,
    params: Record<string, unknown>,
    context: SkillContext
  ) => Promise<SkillResult>;

  /** List available skills */
  list: (
    includeAll: boolean,
    context: SkillContext
  ) => Promise<Array<{ name: string; description: string; skillKey: string }>>;

  /** Handle handoff request */
  handoff: (
    targetAgent: string,
    reason: string,
    context: SkillContext
  ) => Promise<SkillResult>;

  /** Get agent status */
  status: (context: SkillContext) => Promise<{
    agentName: string;
    activeSkill?: string;
    bypassEnabled: boolean;
    sessionId: string;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

export const SKILL_TOOL_NAME = "agent_skill";
export const SKILL_TOOL_DESCRIPTION =
  "Agent skill interface. Actions: invoke (execute skill), list (show skills), handoff (legacy), status (check state)";

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Execute the skill tool with given input and handlers
 */
export async function executeSkillTool(
  input: SkillToolInput,
  context: SkillContext,
  handlers: SkillToolHandlers
): Promise<SkillToolResult> {
  const ctx: SkillContext = {
    ...context,
    bypassAgentFilter: input.bypassAgentFilter ?? context.bypassAgentFilter,
  };

  switch (input.action) {
    case "invoke": {
      if (!input.skill) {
        return { success: false, error: "Skill name required" };
      }
      const result = await handlers.invoke(input.skill, input.params ?? {}, ctx);
      return result.success
        ? { success: true, data: { output: result.output } }
        : { success: false, error: result.error };
    }

    case "list": {
      const skills = await handlers.list(ctx.bypassAgentFilter, ctx);
      return {
        success: true,
        data: {
          agentName: ctx.agentName,
          skills,
        },
      };
    }

    case "handoff": {
      if (!input.targetAgent) {
        return { success: false, error: "Target agent required" };
      }
      if (!input.reason) {
        return { success: false, error: "Reason required" };
      }
      const result = await handlers.handoff(input.targetAgent, input.reason, ctx);
      return result.success
        ? { success: true, data: { handoff: result.handoff, output: result.output } }
        : { success: false, error: result.error };
    }

    case "status": {
      const status = await handlers.status(ctx);
      return { success: true, data: status };
    }

    default:
      return { success: false, error: `Unknown action: ${input.action}` };
  }
}

/**
 * Create a skill tool instance
 *
 * @param context - Skill execution context
 * @param handlers - Action handlers
 * @returns Tool definition with execute method
 */
export function createSkillTool(
  context: SkillContext,
  handlers: SkillToolHandlers
) {
  return {
    name: SKILL_TOOL_NAME,
    description: SKILL_TOOL_DESCRIPTION,
    schema: SkillToolSchema,
    execute: (input: SkillToolInput) => executeSkillTool(input, context, handlers),
  };
}
