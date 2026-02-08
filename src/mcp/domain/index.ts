/**
 * Domain Tools Index
 *
 * Domain-specific tools for Stanley (financial), Zee (personal assistant),
 * Johny (learning), and shared tools.
 * These tools provide specialized functionality for each agent persona.
 *
 * This module bridges the MCP registry with the actual domain tool implementations
 * located in src/domain/.
 */

import type { ToolDefinition } from '../types';
import { getToolRegistry } from '../registry';
import { Log } from '../../../packages/agent-core/src/util/log';

// MCP layer stubs (fallback implementations)
import { StanleyMarketDataTool, StanleyResearchTool, StanleyPortfolioTool, StanleySecFilingTool, StanleyEstimatesTool, StanleyInsiderTradesTool, StanleySegmentsTool } from './stanley';
import { ZeeMemoryStoreTool, ZeeMemorySearchTool, ZeeMessagingTool, ZeeNotificationTool } from './zee';

const log = Log.create({ service: 'domain-tools' });

// ============================================================================
// Domain Tools Registry
// ============================================================================

/**
 * Stanley domain tools (financial analysis)
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
 * Zee domain tools (personal assistant) - MCP stubs
 */
export const zeeTools: ToolDefinition[] = [
  ZeeMemoryStoreTool,
  ZeeMemorySearchTool,
  ZeeMessagingTool,
  ZeeNotificationTool,
];

/**
 * Johny domain tools (learning/study) - dynamically loaded
 */
export let johnyTools: ToolDefinition[] = [];

/**
 * Full Zee domain tools (from src/domain/zee) - dynamically loaded
 */
export let zeeFullTools: ToolDefinition[] = [];

/**
 * Shared domain tools (available to all personas)
 */
export const sharedTools: ToolDefinition[] = [];

/**
 * All domain tools
 */
export const domainTools: ToolDefinition[] = [...stanleyTools, ...zeeTools, ...sharedTools];

/**
 * Register Stanley tools with the registry
 */
export function registerStanleyTools(): void {
  const registry = getToolRegistry();
  registry.registerAll(stanleyTools, { source: 'domain', enabled: true });
  log.debug('Registered Stanley domain tools', { count: stanleyTools.length });
}

/**
 * Register Zee tools with registry (MCP stubs + full domain tools)
 */
export function registerZeeTools(): void {
  const registry = getToolRegistry();
  registry.registerAll(zeeTools, { source: 'domain', enabled: true });
  log.debug('Registered Zee MCP stub tools', { count: zeeTools.length });
}

/**
 * Register full Zee domain tools from src/domain/zee
 * These include WhatsApp, Splitwise, Calendar, Browser, and more.
 */
export async function registerZeeFullTools(): Promise<void> {
  try {
    const zeeDomain = await import('../../domain/zee/tools.js');
    zeeFullTools = zeeDomain.ZEE_TOOLS as unknown as ToolDefinition[];
    
    const registry = getToolRegistry();
    registry.registerAll(zeeFullTools, { source: 'domain', enabled: true });
    log.info('Registered full Zee domain tools', { 
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
 * Register Johny domain tools from src/domain/johny
 * These include study sessions, knowledge graph, mastery tracking, and spaced repetition.
 */
export async function registerJohnyTools(): Promise<void> {
  try {
    const johnyDomain = await import('../../domain/johny/tools.js');
    johnyTools = johnyDomain.JOHNY_TOOLS as unknown as ToolDefinition[];
    
    const registry = getToolRegistry();
    registry.registerAll(johnyTools, { source: 'domain', enabled: true });
    log.info('Registered Johny domain tools', { 
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
 * Register all domain tools with registry (sync version for backwards compat)
 */
export function registerDomainTools(): void {
  registerStanleyTools();
  registerZeeTools();
  registerSharedTools();
}

/**
 * Register all domain tools with registry (async version - includes full tools)
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
  
  log.info('All domain tools registered');
}

// ============================================================================
// Re-exports
// ============================================================================

export * from './stanley';
export * from './zee';
