/**
 * Built-in Plugins Index
 *
 * Exports all built-in plugins for easy registration.
 */

export { AnthropicAuthPlugin } from './anthropic-auth';
export { CopilotAuthPlugin } from './copilot-auth';
export { MinimaxTtsAuthPlugin } from './minimax-tts-auth';
export { MemoryPersistencePlugin } from './memory-persistence';

// Domain-specific plugins
export { StanleyFinancePlugin } from './domains/stanley-finance';
export { ZeeMessagingPlugin } from './domains/zee-messaging';

import { AnthropicAuthPlugin } from './anthropic-auth';
import { CopilotAuthPlugin } from './copilot-auth';
import { MinimaxTtsAuthPlugin } from './minimax-tts-auth';
import { MemoryPersistencePlugin } from './memory-persistence';
import { StanleyFinancePlugin } from './domains/stanley-finance';
import { ZeeMessagingPlugin } from './domains/zee-messaging';
import type { PluginFactory } from '../plugin';

/**
 * All built-in plugins mapped by name
 */
export const builtinPlugins: Record<string, PluginFactory> = {
  'anthropic-auth': AnthropicAuthPlugin,
  'copilot-auth': CopilotAuthPlugin,
  'minimax-tts-auth': MinimaxTtsAuthPlugin,
  'memory-persistence': MemoryPersistencePlugin,
  'stanley-finance': StanleyFinancePlugin,
  'zee-messaging': ZeeMessagingPlugin,
};

/**
 * Default plugins to load (in order)
 */
export const defaultPlugins = [
  'memory-persistence',
  'anthropic-auth',
];

/**
 * Get plugins for a specific agent identity
 */
export function getAgentPlugins(agentId: string): string[] {
  switch (agentId.toLowerCase()) {
    case 'stanley':
      return ['stanley-finance'];
    case 'zee':
      return ['zee-messaging'];
    default:
      return [];
  }
}
