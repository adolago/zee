/**
 * Domain Tools Index
 *
 * All domain tools (life admin, investing, learning) are registered
 * unconditionally under the unified Zee persona. Tool namespaces
 * (stanley:*, johny:*) are preserved for clarity.
 *
 * This module bridges the MCP registry with the actual domain tool
 * implementations located in src/domain/.
 */

import type { ToolDefinition } from '../types';
import { getToolRegistry } from '../registry';
import { Log } from '../../../packages/zee/src/util/log';

// MCP layer stubs (fallback implementations)
import { StanleyMarketDataTool, StanleyResearchTool, StanleyPortfolioTool, StanleySecFilingTool, StanleyEstimatesTool, StanleyInsiderTradesTool, StanleySegmentsTool } from './stanley';
import { ZeeMemoryStoreTool, ZeeMemorySearchTool, ZeeMessagingTool, ZeeNotificationTool } from './zee';

const log = Log.create({ service: 'domain-tools' });

// ============================================================================
// Domain Tools Registry
// ============================================================================

/**
 * Investing domain tools (stanley: namespace)
 */
export const stanleyTools: ToolDefinition[] = [
  StanleyMarketDataTool,
  StanleyResearchTool,
  StanleyPortfolioTool,
  StanleySecFilingTool,
  StanleyEstimatesTool,
  StanleyInsiderTradesTool,
  StanleySegmentsTool,
];

/**
 * Life admin domain tools (zee: namespace) - MCP stubs
 */
export const zeeTools: ToolDefinition[] = [
  ZeeMemoryStoreTool,
  ZeeMemorySearchTool,
  ZeeMessagingTool,
  ZeeNotificationTool,
];

/**
 * Learning domain tools (johny: namespace) - dynamically loaded
 */
export let johnyTools: ToolDefinition[] = [];

/**
 * Full Zee domain tools (from src/domain/zee) - dynamically loaded
 */
export let zeeFullTools: ToolDefinition[] = [];

/**
 * Shared domain tools
 */
export const sharedTools: ToolDefinition[] = [];

/**
 * All domain tools (static)
 */
export const domainTools: ToolDefinition[] = [...stanleyTools, ...zeeTools, ...sharedTools];

// ============================================================================
// Registration Functions
// ============================================================================

/**
 * Register investing tools (stanley: namespace)
 */
export function registerStanleyTools(): void {
  const registry = getToolRegistry();
  registry.registerAll(stanleyTools, { source: 'domain', enabled: true });
  log.debug('Registered investing domain tools (stanley:*)', { count: stanleyTools.length });
}

/**
 * Register life admin tools (zee: namespace) - MCP stubs
 */
export function registerZeeTools(): void {
  const registry = getToolRegistry();
  registry.registerAll(zeeTools, { source: 'domain', enabled: true });
  log.debug('Registered life admin MCP stub tools (zee:*)', { count: zeeTools.length });
}

/**
 * Register full Zee domain tools from src/domain/zee
 * Includes WhatsApp, Splitwise, Calendar, Browser, and more.
 */
export async function registerZeeFullTools(): Promise<void> {
  try {
    const zeeDomain = await import('../../domain/zee/tools.js');
    zeeFullTools = zeeDomain.ZEE_TOOLS as unknown as ToolDefinition[];
    
    const registry = getToolRegistry();
    registry.registerAll(zeeFullTools, { source: 'domain', enabled: true });
    log.info('Registered full life admin tools (zee:*)', { 
      count: zeeFullTools.length,
      tools: zeeFullTools.map(t => t.id).join(', ')
    });
  } catch (error) {
    log.warn('Could not load full Zee domain tools', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Register learning tools (johny: namespace) from src/domain/johny
 * Includes study sessions, knowledge graph, mastery tracking, spaced repetition.
 */
export async function registerJohnyTools(): Promise<void> {
  try {
    const johnyDomain = await import('../../domain/johny/tools.js');
    johnyTools = johnyDomain.JOHNY_TOOLS as unknown as ToolDefinition[];
    
    const registry = getToolRegistry();
    registry.registerAll(johnyTools, { source: 'domain', enabled: true });
    log.info('Registered learning domain tools (johny:*)', { 
      count: johnyTools.length,
      tools: johnyTools.map(t => t.id).join(', ')
    });
  } catch (error) {
    log.warn('Could not load Johny domain tools', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Register shared tools with registry
 */
export function registerSharedTools(): void {
  const registry = getToolRegistry();
  registry.registerAll(sharedTools, { source: 'domain', enabled: true });
}

/**
 * Register all domain tools (sync version for backwards compat)
 */
export function registerDomainTools(): void {
  registerStanleyTools();
  registerZeeTools();
  registerSharedTools();
}

/**
 * Register all domain tools unconditionally.
 * All namespaces (zee:*, stanley:*, johny:*) load for the unified Zee persona.
 */
export async function registerAllDomainTools(): Promise<void> {
  registerStanleyTools();
  registerZeeTools();
  registerSharedTools();
  
  // Register full implementations (async)
  await Promise.all([
    registerZeeFullTools(),
    registerJohnyTools(),
  ]);
  
  log.info('All domain tools registered (unified Zee persona)');
}

// ============================================================================
// Re-exports
// ============================================================================

export * from './stanley';
export * from './zee';
