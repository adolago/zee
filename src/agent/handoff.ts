/**
 * Handoff Module - Context transfer between agents
 *
 * This module handles the execution of handoffs between agents,
 * including context transfer and session management.
 *
 * Handoffs are triggered by skill-based routing when an agent
 * doesn't have a capability but another agent does.
 *
 * @example
 * ```typescript
 * // Execute a handoff from zee to investing
 * const result = await executeHandoff({
 *   sourceAgent: 'zee',
 *   targetAgent: 'investing',
 *   capability: 'market_data',
 *   reason: 'User requested financial analysis',
 *   context: {
 *     sessionId: 'session-123',
 *     recentMessages: [...],
 *   }
 * });
 * ```
 */

import {
  getCapabilityRegistry,
  type CapabilityRegistry,
  type Capability,
} from './capability';

// ============================================================================
// Types
// ============================================================================

/**
 * Conversation message for context transfer
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

/**
 * Context to transfer during a handoff
 */
export interface HandoffContext {
  /** Current session identifier */
  sessionId: string;
  /** Recent conversation messages */
  recentMessages: ConversationMessage[];
  /** IDs of relevant memories to transfer */
  relevantMemoryIds?: string[];
  /** Pending tasks that the target agent should be aware of */
  pendingTasks?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Request to perform a handoff
 */
export interface HandoffRequest {
  /** Source agent identifier */
  sourceAgent: string;
  /** Target agent identifier */
  targetAgent: string;
  /** The capability that triggered this handoff */
  capability: string;
  /** Human-readable reason for the handoff */
  reason: string;
  /** Context to transfer */
  context: HandoffContext;
}

/**
 * Result of a handoff execution
 */
export interface HandoffResult {
  /** Whether the handoff was accepted */
  accepted: boolean;
  /** Capabilities available on the target agent */
  targetCapabilities: Capability[];
  /** Suggested capability to use (the one that triggered handoff) */
  suggestedCapability?: string;
  /** Whether session context was transferred */
  sessionTransferred: boolean;
  /** New session ID if a new session was created */
  newSessionId?: string;
  /** Error message if handoff failed */
  error?: string;
}

/**
 * Validation result for handoff requests
 */
export interface HandoffValidation {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Handoff Functions
// ============================================================================

/**
 * Validate a handoff request
 *
 * Checks that:
 * - Source and target agents exist
 * - Source and target are different
 * - Target agent has the requested capability
 * - Reason is provided
 */
export function validateHandoff(
  request: Partial<HandoffRequest>,
  registry: CapabilityRegistry = getCapabilityRegistry()
): HandoffValidation {
  if (!request.sourceAgent) {
    return { valid: false, error: 'Source agent is required' };
  }

  if (!request.targetAgent) {
    return { valid: false, error: 'Target agent is required' };
  }

  if (request.sourceAgent === request.targetAgent) {
    return { valid: false, error: 'Cannot handoff to the same agent' };
  }

  if (!request.reason?.trim()) {
    return { valid: false, error: 'Handoff reason is required' };
  }

  if (!request.capability) {
    return { valid: false, error: 'Capability is required' };
  }

  // Check if target agent exists and has the capability
  const agents = registry.listAgents();
  const targetExists = agents.some((a) => a.agentName === request.targetAgent);
  if (!targetExists) {
    return { valid: false, error: `Unknown target agent: ${request.targetAgent}` };
  }

  if (!registry.hasCapability(request.targetAgent, request.capability)) {
    return {
      valid: false,
      error: `Target agent '${request.targetAgent}' does not have capability '${request.capability}'`,
    };
  }

  if (!registry.isAvailable(request.targetAgent)) {
    return {
      valid: false,
      error: `Target agent '${request.targetAgent}' is not available`,
    };
  }

  return { valid: true };
}

/**
 * Transfer session context to the target agent
 *
 * This is a placeholder for actual session transfer logic.
 * In a real implementation, this would:
 * 1. Store context in a shared session store
 * 2. Notify the target agent
 * 3. Return the new session ID
 */
export async function transferSessionContext(
  _sourceAgent: string,
  targetAgent: string,
  context: HandoffContext
): Promise<string> {
  // Generate a new session ID for the handoff
  // In practice, this might create a linked session or branch the existing one
  const newSessionId = `${targetAgent}-${context.sessionId}-${Date.now()}`;
  return newSessionId;
}

/**
 * Execute a handoff from one agent to another
 *
 * @param request - The handoff request
 * @param registry - Optional capability registry instance
 * @returns HandoffResult indicating success/failure
 */
export async function executeHandoff(
  request: HandoffRequest,
  registry: CapabilityRegistry = getCapabilityRegistry()
): Promise<HandoffResult> {
  // Validate the request
  const validation = validateHandoff(request, registry);
  if (!validation.valid) {
    return {
      accepted: false,
      targetCapabilities: [],
      sessionTransferred: false,
      error: validation.error,
    };
  }

  // Get target agent capabilities
  const targetCapabilities = registry.getCapabilities(request.targetAgent);

  // Transfer session context
  const newSessionId = await transferSessionContext(
    request.sourceAgent,
    request.targetAgent,
    request.context
  );

  return {
    accepted: true,
    targetCapabilities,
    suggestedCapability: request.capability,
    sessionTransferred: true,
    newSessionId,
  };
}

/**
 * Generate a system message to inject into the target agent's context
 *
 * This message informs the target agent about:
 * - Who handed off and why
 * - The conversation context
 * - What capabilities are expected to be used
 */
export function generateHandoffSystemMessage(
  request: HandoffRequest,
  result: HandoffResult
): string {
  const lines: string[] = [
    `[HANDOFF FROM ${request.sourceAgent.toUpperCase()}]`,
    `Reason: ${request.reason}`,
    '',
    `${request.context.recentMessages.length} recent messages in conversation`,
  ];

  if (request.context.relevantMemoryIds?.length) {
    lines.push(`${request.context.relevantMemoryIds.length} relevant memories attached`);
  }

  if (request.context.pendingTasks?.length) {
    lines.push(`${request.context.pendingTasks.length} pending tasks to be aware of`);
  }

  if (result.suggestedCapability) {
    lines.push(`Suggested capability: ${result.suggestedCapability}`);
  }

  lines.push('', 'Your available capabilities:');
  for (const cap of result.targetCapabilities) {
    const desc = cap.description ? `: ${cap.description}` : '';
    lines.push(`- ${cap.name}${desc}`);
  }

  return lines.join('\n');
}

/**
 * Check if a handoff is possible between two agents
 *
 * @param sourceAgent - Current agent
 * @param targetAgent - Potential target agent
 * @param capability - The capability to check
 * @param registry - Optional capability registry
 */
export function canHandoff(
  sourceAgent: string,
  targetAgent: string,
  capability: string,
  registry: CapabilityRegistry = getCapabilityRegistry()
): boolean {
  if (sourceAgent === targetAgent) return false;
  if (!registry.isAvailable(targetAgent)) return false;
  return registry.hasCapability(targetAgent, capability);
}

/**
 * Get a summary of possible handoffs from the current agent
 *
 * @param currentAgent - The current agent
 * @param registry - Optional capability registry
 * @returns Summary of capabilities and which agents can handle them
 */
export function getHandoffSummary(
  currentAgent: string,
  registry: CapabilityRegistry = getCapabilityRegistry()
): Array<{ capability: string; agents: string[] }> {
  const currentCapabilities = new Set(registry.getCapabilityNames(currentAgent));
  const summary = new Map<string, string[]>();

  for (const agent of registry.listAgents()) {
    if (agent.agentName === currentAgent) continue;
    if (!agent.available) continue;

    for (const cap of agent.capabilities) {
      // Only show capabilities the current agent doesn't have
      if (currentCapabilities.has(cap.name)) continue;

      const agents = summary.get(cap.name) ?? [];
      agents.push(agent.agentName);
      summary.set(cap.name, agents);
    }
  }

  return Array.from(summary.entries()).map(([capability, agents]) => ({
    capability,
    agents,
  }));
}
