/**
 * Domain Tools Index
 *
 * All domain tools (life admin, investing, learning) are registered
 * unconditionally under the unified Zee assistant. Tool namespaces
 * (zee:invest-*, zee:learn-*) are preserved for clarity.
 *
 * This module bridges the MCP registry with the actual domain tool
 * implementations located in src/domain/.
 */

import type { ToolDefinition } from '../types';
import { getToolRegistry } from '../registry';
import { Log } from '../../../packages/zee/src/util/log';

// MCP layer stubs (fallback implementations)
import { InvestingMarketDataTool, InvestingResearchTool, InvestingPortfolioTool, InvestingSecFilingTool, InvestingEstimatesTool, InvestingInsiderTradesTool, InvestingSegmentsTool } from './investing';
import { ZeeMemoryStoreTool, ZeeMemorySearchTool, ZeeMessagingTool, ZeeNotificationTool } from './zee';

const log = Log.create({ service: 'domain-tools' });

// ============================================================================
// Domain Tools Registry
// ============================================================================

/**
 * Investing domain tools (zee:invest-* namespace)
 */
export const investingTools: ToolDefinition[] = [
  InvestingMarketDataTool,
  InvestingResearchTool,
  InvestingPortfolioTool,
  InvestingSecFilingTool,
  InvestingEstimatesTool,
  InvestingInsiderTradesTool,
  InvestingSegmentsTool,
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
 * Learning domain tools (zee:learn-* namespace) - dynamically loaded
 */
export let learningTools: ToolDefinition[] = [];

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
export const domainTools: ToolDefinition[] = [...investingTools, ...zeeTools, ...sharedTools];

// ============================================================================
// Registration Functions
// ============================================================================

/**
 * Register investing tools (zee:invest-* namespace)
 */
export function registerInvestingTools(): void {
  const registry = getToolRegistry();
  registry.registerAll(investingTools, { source: 'domain', enabled: true });
  log.debug('Registered investing domain tools (zee:invest-*)', { count: investingTools.length });
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
 * Register learning tools (zee:learn-* namespace) from src/domain/learning
 * Includes study sessions, knowledge graph, mastery tracking, spaced repetition.
 */
export async function registerLearningTools(): Promise<void> {
  try {
    const learningDomain = await import('../../domain/learning/tools.js');
    learningTools = learningDomain.LEARNING_TOOLS as unknown as ToolDefinition[];
    
    const registry = getToolRegistry();
    registry.registerAll(learningTools, { source: 'domain', enabled: true });
    log.info('Registered learning domain tools (zee:learn-*)', { 
      count: learningTools.length,
      tools: learningTools.map(t => t.id).join(', ')
    });
  } catch (error) {
    log.warn('Could not load learning domain tools', {
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
 * Register all domain tools unconditionally.
 * All namespaces (zee:*, zee:invest-*, zee:learn-*) load for the unified Zee assistant.
 */
export async function registerAllDomainTools(): Promise<void> {
  registerInvestingTools();
  registerZeeTools();
  registerSharedTools();
  
  // Register full implementations (async)
  await Promise.all([
    registerZeeFullTools(),
    registerLearningTools(),
  ]);
  
  log.info('All domain tools registered (unified Zee assistant)');
}

// ============================================================================
// Re-exports
// ============================================================================

export * from './investing';
export * from './zee';
