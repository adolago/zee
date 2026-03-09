/**
 * Capability Registry - Skill-based routing for multi-agent systems
 *
 * This module provides explicit capability registration and discovery for agents,
 * enabling skill-based routing decisions without keyword matching.
 *
 * Key concepts:
 * - Capabilities: Named abilities that agents explicitly register
 * - Routing: Finding which agent can handle a specific capability
 * - Handoff: Delegating work to an agent with the required capability
 *
 * @example
 * ```typescript
 * // Register capabilities for an agent
 * CapabilityRegistry.register('zee', ['memory', 'messaging', 'calendar']);
 * CapabilityRegistry.register('investing', ['market_data', 'sec_filings', 'portfolio']);
 *
 * // Check if handoff is needed
 * const result = shouldHandoff('market_data', 'zee');
 * // => { targetAgent: 'investing', capability: 'market_data' }
 *
 * // Find agent with capability
 * const agent = findAgentWithCapability('messaging');
 * // => { agentName: 'zee', capabilities: ['memory', 'messaging', 'calendar'] }
 * ```
 */

import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Types
// ============================================================================

/**
 * A named capability that an agent can perform
 */
export interface Capability {
  /** Unique capability identifier (e.g., 'market_data', 'messaging') */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Required capabilities (dependencies) */
  requires?: string[];
  /** Whether this capability is always available (not conditional) */
  always?: boolean;
}

/**
 * Agent capability registration
 */
export interface AgentCapabilities {
  /** Agent identifier */
  agentName: string;
  /** List of capabilities this agent provides */
  capabilities: Capability[];
  /** Whether this agent is currently available */
  available: boolean;
}

/**
 * Result from shouldHandoff check
 */
export interface HandoffDecision {
  /** Whether a handoff is needed */
  needed: boolean;
  /** Target agent name (if handoff needed) */
  targetAgent?: string;
  /** The capability that triggered the handoff */
  capability?: string;
  /** Reason for the decision */
  reason: string;
}

/**
 * Result from findAgentWithCapability
 */
export interface CapabilityMatch {
  /** Agent name */
  agentName: string;
  /** The matched capability */
  capability: Capability;
  /** All capabilities of this agent */
  allCapabilities: string[];
}

/**
 * Events emitted by the capability registry
 */
export interface CapabilityRegistryEvents {
  'capability:registered': { agentName: string; capability: string };
  'capability:unregistered': { agentName: string; capability: string };
  'agent:available': { agentName: string };
  'agent:unavailable': { agentName: string };
}

// ============================================================================
// Capability Registry
// ============================================================================

/**
 * Central registry for agent capabilities
 *
 * This registry maintains a mapping of agents to their capabilities,
 * enabling skill-based routing decisions.
 */
export class CapabilityRegistry extends EventEmitter<CapabilityRegistryEvents> {
  private agents: Map<string, AgentCapabilities> = new Map();

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  /**
   * Register capabilities for an agent
   *
   * @param agentName - Unique agent identifier
   * @param capabilities - Array of capability names or capability objects
   */
  register(
    agentName: string,
    capabilities: (string | Capability)[]
  ): void {
    const normalizedCapabilities = capabilities.map((c) =>
      typeof c === 'string' ? { name: c } : c
    );

    const existing = this.agents.get(agentName);
    if (existing) {
      // Merge capabilities
      const existingNames = new Set(existing.capabilities.map((c) => c.name));
      for (const cap of normalizedCapabilities) {
        if (!existingNames.has(cap.name)) {
          existing.capabilities.push(cap);
          this.emit('capability:registered', { agentName, capability: cap.name });
        }
      }
    } else {
      this.agents.set(agentName, {
        agentName,
        capabilities: normalizedCapabilities,
        available: true,
      });
      for (const cap of normalizedCapabilities) {
        this.emit('capability:registered', { agentName, capability: cap.name });
      }
    }
  }

  /**
   * Unregister a capability from an agent
   */
  unregister(agentName: string, capabilityName: string): boolean {
    const agent = this.agents.get(agentName);
    if (!agent) return false;

    const index = agent.capabilities.findIndex((c) => c.name === capabilityName);
    if (index === -1) return false;

    agent.capabilities.splice(index, 1);
    this.emit('capability:unregistered', { agentName, capability: capabilityName });
    return true;
  }

  /**
   * Remove an agent and all its capabilities
   */
  unregisterAgent(agentName: string): boolean {
    const agent = this.agents.get(agentName);
    if (!agent) return false;

    for (const cap of agent.capabilities) {
      this.emit('capability:unregistered', { agentName, capability: cap.name });
    }
    return this.agents.delete(agentName);
  }

  // --------------------------------------------------------------------------
  // Availability
  // --------------------------------------------------------------------------

  /**
   * Set agent availability
   */
  setAvailable(agentName: string, available: boolean): void {
    const agent = this.agents.get(agentName);
    if (agent) {
      agent.available = available;
      this.emit(available ? 'agent:available' : 'agent:unavailable', { agentName });
    }
  }

  /**
   * Check if an agent is available
   */
  isAvailable(agentName: string): boolean {
    return this.agents.get(agentName)?.available ?? false;
  }

  // --------------------------------------------------------------------------
  // Capability Queries
  // --------------------------------------------------------------------------

  /**
   * Check if an agent has a specific capability
   */
  hasCapability(agentName: string, capabilityName: string): boolean {
    const agent = this.agents.get(agentName);
    if (!agent) return false;
    return agent.capabilities.some((c) => c.name === capabilityName);
  }

  /**
   * Get all capabilities for an agent
   */
  getCapabilities(agentName: string): Capability[] {
    return this.agents.get(agentName)?.capabilities ?? [];
  }

  /**
   * Get capability names for an agent
   */
  getCapabilityNames(agentName: string): string[] {
    return this.getCapabilities(agentName).map((c) => c.name);
  }

  /**
   * Find all agents with a specific capability
   */
  findAgentsWithCapability(capabilityName: string): AgentCapabilities[] {
    return Array.from(this.agents.values()).filter(
      (agent) =>
        agent.available && agent.capabilities.some((c) => c.name === capabilityName)
    );
  }

  /**
   * Get all registered agents
   */
  listAgents(): AgentCapabilities[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all unique capability names across all agents
   */
  listAllCapabilities(): string[] {
    const capabilities = new Set<string>();
    const agents = Array.from(this.agents.values());
    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        capabilities.add(cap.name);
      }
    }
    return Array.from(capabilities);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Clear all registrations
   */
  clear(): void {
    this.agents.clear();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let registryInstance: CapabilityRegistry | undefined;

/**
 * Get the global capability registry instance
 */
export function getCapabilityRegistry(): CapabilityRegistry {
  if (!registryInstance) {
    registryInstance = new CapabilityRegistry();
  }
  return registryInstance;
}

/**
 * Reset the global registry (for testing)
 */
export function resetCapabilityRegistry(): void {
  registryInstance?.clear();
  registryInstance = undefined;
}

// ============================================================================
// Routing Functions
// ============================================================================

/**
 * Check if a handoff is needed for a capability
 *
 * This function determines whether the current agent can handle a capability
 * or if another agent should take over.
 *
 * @param capabilityName - The capability being requested
 * @param currentAgent - The agent currently handling the request
 * @param registry - Optional registry instance (defaults to global)
 * @returns HandoffDecision indicating whether handoff is needed
 *
 * @example
 * ```typescript
 * const decision = shouldHandoff('market_data', 'zee');
 * if (decision.needed) {
 *   console.log(`Handoff to ${decision.targetAgent} for ${decision.capability}`);
 * }
 * ```
 */
export function shouldHandoff(
  capabilityName: string,
  currentAgent: string,
  registry: CapabilityRegistry = getCapabilityRegistry()
): HandoffDecision {
  // Check if current agent has the capability
  if (registry.hasCapability(currentAgent, capabilityName)) {
    return {
      needed: false,
      reason: `Current agent '${currentAgent}' has capability '${capabilityName}'`,
    };
  }

  // Find another agent with this capability
  const agents = registry.findAgentsWithCapability(capabilityName);
  if (agents.length === 0) {
    return {
      needed: false,
      reason: `No agent has capability '${capabilityName}'`,
    };
  }

  // Return the first available agent with this capability
  const targetAgent = agents[0];
  return {
    needed: true,
    targetAgent: targetAgent.agentName,
    capability: capabilityName,
    reason: `Agent '${targetAgent.agentName}' has capability '${capabilityName}'`,
  };
}

/**
 * Find which agent has a specific capability
 *
 * @param capabilityName - The capability to search for
 * @param excludeAgent - Optional agent to exclude from search
 * @param registry - Optional registry instance (defaults to global)
 * @returns CapabilityMatch or null if no agent has the capability
 *
 * @example
 * ```typescript
 * const match = findAgentWithCapability('messaging', 'investing');
 * if (match) {
 *   console.log(`${match.agentName} can handle messaging`);
 * }
 * ```
 */
export function findAgentWithCapability(
  capabilityName: string,
  excludeAgent?: string,
  registry: CapabilityRegistry = getCapabilityRegistry()
): CapabilityMatch | null {
  const agents = registry.findAgentsWithCapability(capabilityName);

  for (const agent of agents) {
    if (excludeAgent && agent.agentName === excludeAgent) continue;

    const capability = agent.capabilities.find((c) => c.name === capabilityName);
    if (capability) {
      return {
        agentName: agent.agentName,
        capability,
        allCapabilities: agent.capabilities.map((c) => c.name),
      };
    }
  }

  return null;
}

/**
 * Get all capabilities that could be handled by other agents
 *
 * Useful for suggesting available handoffs to the LLM
 *
 * @param currentAgent - The current agent
 * @param registry - Optional registry instance
 * @returns Map of capability name to agent name
 */
export function getAvailableHandoffs(
  currentAgent: string,
  registry: CapabilityRegistry = getCapabilityRegistry()
): Map<string, string[]> {
  const handoffs = new Map<string, string[]>();
  const currentCapabilities = new Set(registry.getCapabilityNames(currentAgent));

  for (const agent of registry.listAgents()) {
    if (agent.agentName === currentAgent) continue;
    if (!agent.available) continue;

    for (const cap of agent.capabilities) {
      if (currentCapabilities.has(cap.name)) continue;

      const existing = handoffs.get(cap.name) ?? [];
      existing.push(agent.agentName);
      handoffs.set(cap.name, existing);
    }
  }

  return handoffs;
}
