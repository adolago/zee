/**
 * Built-in Persona Definitions
 *
 * This module exports all built-in persona configurations for:
 * - Agent-Core: Development agents (release, hold, general, explore)
 * - Stanley: Financial analysis agents (analyst, researcher, quant, macro)
 * - Zee: Personal assistant agents (assistant, coder, researcher)
 */

import { PersonaDefinition } from "../persona";
import { PermissionConfig } from "../agent";
import { personaPalettes } from "../../theme/rosetta";

// ============================================================================
// Base Permission Configurations
// ============================================================================

/**
 * Full access permissions for development
 */
export const FULL_ACCESS_PERMISSIONS: PermissionConfig = {
  edit: "allow",
  bash: { "*": "allow" },
  skill: { "*": "allow" },
  mcp: { "*": "allow" },
  webfetch: "allow",
  external_directory: "ask",
  doom_loop: "ask",
};

/**
 * Read-only permissions for analysis
 */
export const READ_ONLY_PERMISSIONS: PermissionConfig = {
  edit: "deny",
  bash: {
    "cat *": "allow",
    "cut *": "allow",
    "diff *": "allow",
    "du *": "allow",
    "file *": "allow",
    "find * -delete*": "ask",
    "find * -exec*": "ask",
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
  webfetch: "allow",
  external_directory: "ask",
  doom_loop: "ask",
};

/**
 * No bash/edit permissions for specialized analysis
 */
export const NO_EXECUTION_PERMISSIONS: PermissionConfig = {
  edit: "deny",
  bash: { "*": "deny" },
  skill: { "*": "allow" },
  mcp: { "*": "allow" },
  webfetch: "allow",
  external_directory: "deny",
  doom_loop: "ask",
};

// ============================================================================
// Agent-Core Personas
// ============================================================================

/**
 * Release agent - Full-access for code creation and modification
 */
export const AGENT_CORE_RELEASE: PersonaDefinition = {
  name: "release",
  description: "Full-access agent for code creation and modification",
  mode: "primary",
  useCase: "agent-core",
  permission: FULL_ACCESS_PERMISSIONS,
  tools: {},
};

/**
 * Hold agent - Read-only analysis and review before file alterations
 */
export const AGENT_CORE_HOLD: PersonaDefinition = {
  name: "hold",
  description: "Read-only agent for analysis and review before file alterations",
  mode: "primary",
  useCase: "agent-core",
  permission: READ_ONLY_PERMISSIONS,
  tools: {
    edit: false,
    write: false,
  },
};

/**
 * General agent - Complex task subagent
 */
export const AGENT_CORE_GENERAL: PersonaDefinition = {
  name: "general",
  description:
    "General-purpose agent for researching complex questions and executing multi-step tasks in parallel",
  mode: "subagent",
  useCase: "agent-core",
  hidden: true,
  permission: FULL_ACCESS_PERMISSIONS,
  tools: {
    todoread: false,
    todowrite: false,
  },
};

/**
 * Explore agent - Fast codebase exploration
 */
export const AGENT_CORE_EXPLORE: PersonaDefinition = {
  name: "explore",
  description:
    "Fast agent specialized for exploring codebases. Use for finding files by patterns, searching code for keywords, or answering questions about codebase structure.",
  mode: "subagent",
  useCase: "agent-core",
  tools: {
    todoread: false,
    todowrite: false,
    edit: false,
    write: false,
  },
  prompt: `You are a fast, focused codebase exploration agent. Your job is to:

1. Find files matching patterns (e.g., "src/components/**/*.tsx")
2. Search code for keywords (e.g., "API endpoints")
3. Answer questions about the codebase structure

When asked, specify your thoroughness level:
- "quick" for basic searches
- "medium" for moderate exploration
- "very thorough" for comprehensive analysis across multiple locations and naming conventions`,
};

// ============================================================================
// Stanley Personas (Financial Analysis)
// ============================================================================

/**
 * Analyst agent - Comprehensive financial analysis
 */
export const STANLEY_ANALYST: PersonaDefinition = {
  name: "analyst",
  description: "Comprehensive financial analysis agent for institutional investment",
  mode: "primary",
  useCase: "stanley",
  color: personaPalettes.stanley.primary.hex,
  model: "openrouter/anthropic/claude-sonnet-4",
  temperature: 0.3,
  permission: NO_EXECUTION_PERMISSIONS,
  tools: {
    market_data: true,
    fundamentals: true,
    technicals: true,
    portfolio: true,
    bash: false,
    edit: false,
    write: false,
  },
  prompt: `You are a senior institutional investment analyst. Your role is to:

1. Analyze securities with professional rigor
2. Consider risk-adjusted returns and portfolio context
3. Apply fundamental, technical, and quantitative methods
4. Communicate findings clearly with supporting data

Best practices:
- Always cite data sources
- Provide confidence levels for recommendations
- Consider both upside potential and downside risks
- Frame analysis in portfolio context
- Use appropriate valuation methodologies`,
};

/**
 * Researcher agent - Deep research and due diligence
 */
export const STANLEY_RESEARCHER: PersonaDefinition = {
  name: "researcher",
  description: "Deep research and due diligence agent for thorough analysis",
  mode: "primary",
  useCase: "stanley",
  color: "#5DB87A", // Emerald Flux (Stanley variant)
  model: "openrouter/anthropic/claude-sonnet-4",
  temperature: 0.4,
  permission: NO_EXECUTION_PERMISSIONS,
  tools: {
    sec_filings: true,
    earnings: true,
    peer_comparison: true,
    dcf: true,
    news_sentiment: true,
  },
  prompt: `You are a research analyst specializing in deep due diligence. Your focus areas:

1. SEC Filing Analysis
   - 10-K, 10-Q, 8-K filings
   - Proxy statements and management compensation
   - Risk factor evolution over time

2. Earnings Analysis
   - Earnings call transcript analysis
   - Management tone and credibility assessment
   - Forward guidance interpretation

3. Competitive Analysis
   - Peer comparison and positioning
   - Market share dynamics
   - Competitive moat assessment

4. Management Quality
   - Track record evaluation
   - Capital allocation history
   - Insider activity patterns

5. Risk Identification
   - Red flag detection
   - Accounting quality assessment
   - Liquidity and solvency analysis

Always provide thorough, citation-rich research reports.`,
};

/**
 * Quant agent - Quantitative analysis and backtesting
 */
export const STANLEY_QUANT: PersonaDefinition = {
  name: "quant",
  description: "Quantitative analysis and backtesting agent for systematic strategies",
  mode: "primary",
  useCase: "stanley",
  color: "#336144", // Emerald Steel (Stanley variant)
  model: "openrouter/anthropic/claude-sonnet-4",
  temperature: 0.2,
  permission: NO_EXECUTION_PERMISSIONS,
  tools: {
    backtest: true,
    factor_analysis: true,
    risk_metrics: true,
    statistical_tests: true,
  },
  prompt: `You are a quantitative analyst. Your capabilities include:

1. Factor Analysis
   - Multi-factor model construction
   - Factor exposure decomposition
   - Factor timing and rotation

2. Statistical Testing
   - Hypothesis testing for alpha
   - Stationarity and cointegration tests
   - Distribution analysis

3. Backtesting
   - Strategy performance evaluation
   - Walk-forward optimization
   - Transaction cost modeling

4. Risk Metrics
   - VaR and CVaR calculation
   - Sharpe, Sortino, Calmar ratios
   - Maximum drawdown analysis

5. Portfolio Optimization
   - Mean-variance optimization
   - Risk parity construction
   - Black-Litterman views

Always validate assumptions and report statistical significance.`,
};

/**
 * Macro agent - Macroeconomic analysis subagent
 */
export const STANLEY_MACRO: PersonaDefinition = {
  name: "macro",
  description: "Macroeconomic analysis subagent for economic regime and cross-asset analysis",
  mode: "subagent",
  useCase: "stanley",
  color: "#254533", // Emerald Bronze (Stanley variant)
  permission: NO_EXECUTION_PERMISSIONS,
  tools: {
    dbnomics: true,
    regime_detection: true,
    commodity_correlation: true,
    yield_curve: true,
  },
  prompt: `You are a macroeconomic analyst subagent. Provide analysis on:

1. Economic Indicators
   - Leading, coincident, and lagging indicators
   - Surprise indices and expectations gaps
   - Labor market dynamics

2. Regime Detection
   - Business cycle positioning
   - Inflation/deflation regime identification
   - Credit cycle analysis

3. Cross-Asset Correlations
   - Equity-bond correlations
   - Currency relationships
   - Commodity-equity linkages

4. Monetary Policy
   - Central bank policy analysis
   - Rate expectations and forward guidance
   - Quantitative policy effects

5. Global Dynamics
   - Capital flow analysis
   - Emerging market contagion risks
   - Trade and tariff impacts`,
};

// ============================================================================
// Zee Personas (Personal Assistant)
// ============================================================================

/**
 * Assistant agent - Personal AI assistant (default)
 */
export const ZEE_ASSISTANT: PersonaDefinition = {
  name: "assistant",
  description: "Personal AI assistant with full context and memory",
  mode: "primary",
  useCase: "zee",
  default: true,
  color: personaPalettes.zee.primary.hex,
  temperature: 0.7,
  identityFiles: ["~/.zee/IDENTITY.md", "~/.zee/SOUL.md"],
  tools: {
    memory: true,
    calendar: true,
    messaging: true,
    web_search: true,
    file_read: true,
  },
  prompt: `# Identity and Soul loaded from IDENTITY.md and SOUL.md

This prompt is composed dynamically from identity files.
The assistant persona inherits all values, boundaries, and directives
from the identity layer.

Key behaviors:
- Be genuinely helpful, not performatively helpful
- Have opinions and preferences
- Be resourceful before asking
- Maintain privacy and trust
- Communicate directly and clearly`,
};

/**
 * Coder agent - Technical help mode
 */
export const ZEE_CODER: PersonaDefinition = {
  name: "coder",
  description: "Technical help mode for coding assistance",
  mode: "primary",
  useCase: "zee",
  color: "#5078C2", // Sapphire Flux (Zee variant)
  extends: "agent-core/release",
  temperature: 0.3,
  identityFiles: ["~/.zee/IDENTITY.md", "~/.zee/SOUL.md"],
  prompt: `You are Zee in coder mode. Apply your personal context while focusing on:

1. Writing clean, maintainable code
2. Following project conventions and patterns
3. Explaining technical decisions clearly
4. Helping debug issues systematically

Maintain your personal identity and communication style while
providing technical assistance. Be direct and competent.`,
};

/**
 * Researcher agent - Information gathering mode
 */
export const ZEE_RESEARCHER: PersonaDefinition = {
  name: "researcher",
  description: "Information gathering and research mode",
  mode: "primary",
  useCase: "zee",
  color: "#304572", // Sapphire Steel (Zee variant)
  temperature: 0.5,
  identityFiles: ["~/.zee/IDENTITY.md", "~/.zee/SOUL.md"],
  tools: {
    web_search: true,
    web_fetch: true,
    memory: true,
  },
  prompt: `You are Zee in researcher mode. Focus on:

1. Thorough information gathering
2. Source verification and credibility assessment
3. Synthesizing findings into clear summaries
4. Remembering key insights in memory for future reference

Maintain your personal identity while being methodical
and thorough in research tasks.`,
};

// ============================================================================
// Persona Collections
// ============================================================================

/**
 * All agent-core personas
 */
export const AGENT_CORE_PERSONAS: Record<string, PersonaDefinition> = {
  release: AGENT_CORE_RELEASE,
  hold: AGENT_CORE_HOLD,
  general: AGENT_CORE_GENERAL,
  explore: AGENT_CORE_EXPLORE,
};

/**
 * All Stanley personas
 */
export const STANLEY_PERSONAS: Record<string, PersonaDefinition> = {
  analyst: STANLEY_ANALYST,
  researcher: STANLEY_RESEARCHER,
  quant: STANLEY_QUANT,
  macro: STANLEY_MACRO,
};

/**
 * All Zee personas
 */
export const ZEE_PERSONAS: Record<string, PersonaDefinition> = {
  assistant: ZEE_ASSISTANT,
  coder: ZEE_CODER,
  researcher: ZEE_RESEARCHER,
};

/**
 * All built-in personas indexed by qualified name (useCase/name)
 */
export const ALL_PERSONAS: Record<string, PersonaDefinition> = {
  // Agent-Core
  "agent-core/release": AGENT_CORE_RELEASE,
  "agent-core/hold": AGENT_CORE_HOLD,
  "agent-core/general": AGENT_CORE_GENERAL,
  "agent-core/explore": AGENT_CORE_EXPLORE,
  // Stanley
  "stanley/analyst": STANLEY_ANALYST,
  "stanley/researcher": STANLEY_RESEARCHER,
  "stanley/quant": STANLEY_QUANT,
  "stanley/macro": STANLEY_MACRO,
  // Zee
  "zee/assistant": ZEE_ASSISTANT,
  "zee/coder": ZEE_CODER,
  "zee/researcher": ZEE_RESEARCHER,
};

/**
 * Get a persona by qualified name
 */
export function getPersona(name: string): PersonaDefinition | undefined {
  // Try qualified name first
  if (ALL_PERSONAS[name]) {
    return ALL_PERSONAS[name];
  }

  // Try unqualified name across all use cases
  for (const persona of Object.values(ALL_PERSONAS)) {
    if (persona.name === name) {
      return persona;
    }
  }

  return undefined;
}

/**
 * List personas by use case
 */
export function listPersonas(useCase?: "stanley" | "zee" | "agent-core"): PersonaDefinition[] {
  if (!useCase) {
    return Object.values(ALL_PERSONAS);
  }

  return Object.values(ALL_PERSONAS).filter((p) => p.useCase === useCase);
}

/**
 * Get default persona for a use case
 */
export function getDefaultPersona(useCase: "stanley" | "zee" | "agent-core"): PersonaDefinition {
  switch (useCase) {
    case "stanley":
      return STANLEY_ANALYST;
    case "zee":
      return ZEE_ASSISTANT;
    case "agent-core":
      return AGENT_CORE_RELEASE;
  }
}
