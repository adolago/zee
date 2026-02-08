/**
 * Stanley Domain Tools
 *
 * Financial research and market analysis tools powered by:
 * - OpenBB Platform for market data
 * - NautilusTrader for algorithmic trading
 * - SEC EDGAR for regulatory filings
 */

import { z } from "zod";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import type { ToolDefinition, ToolRuntime, ToolExecutionContext, ToolExecutionResult } from "../../mcp/types";
import { getSafeEnv } from "../../util/safe-env";
import { Stanley } from "../../paths";
import { scratchpadTool } from "./scratchpad";
import { getResearchContextManager, resetResearchContextManager } from "./research-context";

type StanleyResult = {
  ok: boolean;
  command?: string;
  data?: unknown;
  error?: string;
};

function resolveStanleyCli(): { python: string; cliPath: string; pythonPath?: string } {
  // Use centralized path resolution from paths.ts
  const python = Stanley.python();
  const cliPath = Stanley.cli();
  const pythonPath = Stanley.pythonPath();
  return { python, cliPath, pythonPath };
}

function runStanleyCli(args: string[]): StanleyResult {
  const { python, cliPath, pythonPath } = resolveStanleyCli();
  if (!existsSync(cliPath)) {
    return {
      ok: false,
      error: `Stanley CLI not found at ${cliPath}. Set STANLEY_REPO or STANLEY_CLI.`,
    };
  }

  const env = getSafeEnv(["STANLEY_REPO", "STANLEY_CLI", "STANLEY_PYTHON", "STANLEY_PYTHONPATH", "PYTHONPATH"]);
  if (pythonPath) {
    env.PYTHONPATH = env.PYTHONPATH ? `${pythonPath}${delimiter}${env.PYTHONPATH}` : pythonPath;
  }

  const result = spawnSync(python, [cliPath, ...args], {
    encoding: "utf-8",
    env,
    timeout: 30000, // 30s timeout
  });

  if (result.error) {
    if ((result.error as any).code === 'ETIMEDOUT') {
        return { ok: false, error: "Stanley CLI timed out (30s). The backend might be overloaded or hanging." };
    }
    return { ok: false, error: `Stanley execution failed: ${result.error.message}` };
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    const stderr = result.stderr.trim();
    return { ok: false, error: stderr || "Stanley CLI returned no output." };
  }

  try {
    return JSON.parse(stdout) as StanleyResult;
  } catch {
    return { ok: false, error: stdout };
  }
}

function renderOutput(title: string, result: StanleyResult): ToolExecutionResult {
  if (!result.ok) {
    return {
      title,
      metadata: { ok: false },
      output: result.error || "Stanley CLI failed.",
    };
  }

  return {
    title,
    metadata: { ok: true },
    output: JSON.stringify(result.data ?? result, null, 2),
  };
}

// =============================================================================
// Deduplication Wrapper
// =============================================================================

/**
 * Wrap a Stanley tool's execute function with research-session deduplication.
 * If the same toolId+args were already called in this session, returns the cached result.
 */
function withDeduplication(
  toolId: string,
  execute: (args: any, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>,
): (args: any, ctx: ToolExecutionContext) => Promise<ToolExecutionResult> {
  return async (args, ctx) => {
    const manager = getResearchContextManager();

    if (manager.isDuplicate(toolId, args)) {
      const cached = manager.getCachedResult(toolId, args)!;
      return {
        title: `[Cached] ${toolId}`,
        metadata: { cached: true, originalTimestamp: cached.timestamp },
        output: cached.fullOutput,
      };
    }

    const result = await execute(args, ctx);
    manager.record(toolId, args, result.output);
    return result;
  };
}

export { resetResearchContextManager };

// =============================================================================
// Market Data Tool
// =============================================================================

const MarketDataParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  dataType: z.enum(["quote", "chart", "fundamentals", "news"]).default("quote")
    .describe("Type of market data to retrieve"),
  period: z.enum(["1d", "5d", "1m", "3m", "6m", "1y", "ytd", "max"]).default("1m")
    .describe("Time period for historical data"),
  interval: z.enum(["1m", "5m", "15m", "1h", "1d", "1w"]).optional()
    .describe("Data interval for charts"),
});

export const marketDataTool: ToolDefinition = {
  id: "stanley:market-data",
  category: "domain",
  init: async () => ({
    description: `Retrieve real-time and historical market data for stocks, ETFs, and indices. Data types: quote (current price), chart (historical), fundamentals (P/E, market cap), news.`,
    parameters: MarketDataParams,
    execute: withDeduplication("stanley:market-data", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, dataType, period } = args;

      ctx.metadata({ title: `Fetching ${dataType} for ${symbol}` });

      if (dataType === "news") {
        return {
          title: `Market Data: ${symbol}`,
          metadata: { symbol, dataType },
          output: "News is not available in the Stanley CLI yet.",
        };
      }

      const cliArgs =
        dataType === "chart"
          ? ["market", "chart", symbol, "--period", period]
          : dataType === "fundamentals"
            ? ["market", "fundamentals", symbol]
            : ["market", "quote", symbol];
      const result = runStanleyCli(cliArgs);
      return renderOutput(`Market Data: ${symbol}`, result);
    }),
  }),
};

// =============================================================================
// Portfolio Analysis Tool
// =============================================================================

const PortfolioParams = z.object({
  action: z.enum(["get", "analyze", "optimize", "backtest"]).default("analyze")
    .describe("Portfolio action to perform"),
  portfolioId: z.string().optional()
    .describe("Portfolio identifier (uses default if not specified)"),
  benchmark: z.string().default("SPY")
    .describe("Benchmark symbol for comparison"),
  riskMetrics: z.boolean().default(true)
    .describe("Include risk metrics (Sharpe, Sortino, VaR)"),
});

export const portfolioTool: ToolDefinition = {
  id: "stanley:portfolio",
  category: "domain",
  init: async () => ({
    description: `Analyze and optimize investment portfolios. Check memory for user positions first. Actions: get (current), analyze (performance + risk metrics), optimize, backtest.`,
    parameters: PortfolioParams,
    execute: withDeduplication("stanley:portfolio", async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, portfolioId, benchmark, riskMetrics } = args;

      ctx.metadata({ title: `Portfolio ${action}` });

      if (action === "optimize") {
        return {
          title: "Portfolio Analysis",
          metadata: { action, portfolioId: portfolioId || "default", benchmark, riskMetrics },
          output: "Portfolio optimization is not available in the Stanley CLI yet.",
        };
      }

      if (action === "backtest") {
        return {
          title: "Portfolio Analysis",
          metadata: { action, portfolioId: portfolioId || "default", benchmark, riskMetrics },
          output: "Portfolio backtests should use the Nautilus tool with a strategy.",
        };
      }

      const cliArgs =
        action === "get"
          ? ["portfolio", "status"]
          : riskMetrics
            ? ["portfolio", "risk", "--var", "0.95"]
            : ["portfolio", "performance", "--period", "ytd"];
      const result = runStanleyCli(cliArgs);
      return renderOutput("Portfolio Analysis", result);
    }),
  }),
};

// =============================================================================
// SEC Filings Tool
// =============================================================================

const SecFilingsParams = z.object({
  ticker: z.string().describe("Company ticker symbol"),
  formType: z.enum(["10-K", "10-Q", "8-K", "13F", "DEF14A", "S-1", "all"]).default("10-K")
    .describe("SEC form type to retrieve"),
  year: z.number().optional()
    .describe("Filing year (defaults to most recent)"),
  summarize: z.boolean().default(true)
    .describe("Generate AI summary of the filing"),
});

export const secFilingsTool: ToolDefinition = {
  id: "stanley:sec-filings",
  category: "domain",
  init: async () => ({
    description: `Access and analyze SEC regulatory filings. Form types: 10-K (annual), 10-Q (quarterly), 8-K (events), 13F (holdings), DEF14A (proxy), S-1 (IPO). Set summarize=true for AI summary.`,
    parameters: SecFilingsParams,
    execute: withDeduplication("stanley:sec-filings", async (args, ctx): Promise<ToolExecutionResult> => {
      const { ticker, formType, year, summarize } = args;

      ctx.metadata({ title: `SEC ${formType} for ${ticker}` });

      const cliArgs = summarize
        ? ["research", "analyze", ticker, "--filing", formType]
        : ["research", "sec", ticker, "--type", formType];
      const result = runStanleyCli(cliArgs);
      const response = renderOutput(`SEC Filing: ${ticker} ${formType}`, result);
      response.metadata = { ...response.metadata, ticker, formType, year };
      return response;
    }),
  }),
};

// =============================================================================
// Research Tool
// =============================================================================

const ResearchParams = z.object({
  query: z.string().describe("Research query or topic"),
  sources: z.array(z.enum(["sec", "news", "analyst", "academic", "all"])).default(["news", "analyst"])
    .describe("Sources to search"),
  dateRange: z.enum(["1d", "1w", "1m", "3m", "1y", "all"]).default("1m")
    .describe("Date range for results"),
  limit: z.number().default(10)
    .describe("Maximum number of results"),
});

export const researchTool: ToolDefinition = {
  id: "stanley:research",
  category: "domain",
  init: async () => ({
    description: `Conduct financial research across multiple sources (SEC, news, analyst, academic). Check memory for previous analyses first. Specify dateRange and limit for results.`,
    parameters: ResearchParams,
    execute: withDeduplication("stanley:research", async (args, ctx): Promise<ToolExecutionResult> => {
      const { query, sources, dateRange, limit } = args;

      ctx.metadata({ title: `Researching: ${query}` });

      const result = runStanleyCli(["research", "screen", "--criteria", query]);
      const response = renderOutput(`Research: ${query}`, result);
      response.metadata = { ...response.metadata, sources, dateRange, limit };
      return response;
    }),
  }),
};

// =============================================================================
// Nautilus Trading Tool
// =============================================================================

const NautilusParams = z.object({
  action: z.enum(["backtest", "paper_trade", "strategy_info", "market_status"])
    .describe("Trading action to perform"),
  strategy: z.string().optional()
    .describe("Strategy name or ID"),
  symbols: z.array(z.string()).optional()
    .describe("Symbols to trade"),
  startDate: z.string().optional()
    .describe("Start date for backtest (YYYY-MM-DD)"),
  endDate: z.string().optional()
    .describe("End date for backtest (YYYY-MM-DD)"),
});

export const nautilusTool: ToolDefinition = {
  id: "stanley:nautilus",
  category: "domain",
  init: async () => ({
    description: `Interface with NautilusTrader for algorithmic trading research. Actions: backtest, paper_trade, strategy_info, market_status. Simulation only, no real trading.`,
    parameters: NautilusParams,
    execute: withDeduplication("stanley:nautilus", async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, strategy, symbols, startDate, endDate } = args;

      ctx.metadata({ title: `Nautilus: ${action}` });

      if (action === "market_status") {
        return {
          title: `NautilusTrader: ${action}`,
          metadata: { action, strategy, symbols },
          output: "Market status is not available in the Stanley CLI yet.",
        };
      }

      if (!strategy) {
        return {
          title: `NautilusTrader: ${action}`,
          metadata: { action, symbols },
          output: "A strategy is required for this action.",
        };
      }

      const symbolArg = symbols?.length ? symbols.join(",") : "";
      const cliArgs =
        action === "paper_trade"
          ? ["nautilus", "paper-trade", strategy, "--capital", "100000"]
          : action === "strategy_info"
            ? ["nautilus", "strategy-info", strategy]
            : ["nautilus", "backtest", strategy, "--symbols", symbolArg, "--start", startDate || ""];
      const result = runStanleyCli(cliArgs);
      const response = renderOutput(`NautilusTrader: ${action}`, result);
      response.metadata = { ...response.metadata, action, strategy, symbols, startDate, endDate };
      return response;
    }),
  }),
};

export const statusTool: ToolDefinition = {
  id: "stanley:status",
  category: "domain",
  init: async () => ({
    description: "Check the health and connection status of the Stanley investment platform.",
    parameters: z.object({}),
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
       const result = runStanleyCli(["status"]); // Assuming stanley_cli.py supports 'status' or just running it with no args checks env
       // If 'status' isn't supported by CLI, we can try a lightweight command like checking version or help
       // Let's assume we just want to verify CLI is runnable.
       
       if (!result.ok && result.error?.includes("Stanley CLI not found")) {
           return {
               title: "Stanley Status",
               metadata: { ok: false },
               output: "Stanley is not installed or not found. Please install the 'stanley' persona.",
           };
       }
       
       // Try a lightweight ping/version if status fails, but for now report result
       return renderOutput("Stanley Status", result);
    }
  })
}

// =============================================================================
// Analyst Estimates Tool
// =============================================================================

const EstimatesParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  estimateType: z.enum(["consensus", "forward_eps", "price_target", "revisions"]).default("consensus")
    .describe("Type of estimate: consensus (rating + targets), forward_eps (EPS projections), price_target (analyst targets), revisions (estimate changes)"),
});

export const estimatesTool: ToolDefinition = {
  id: "stanley:estimates",
  category: "domain",
  init: async () => ({
    description: `Get analyst estimates, consensus ratings, forward EPS, price targets, and revision history. Use consensus for quick overview, forward_eps for quarterly/annual projections, price_target for individual analyst calls, revisions for upgrade/downgrade momentum.`,
    parameters: EstimatesParams,
    execute: withDeduplication("stanley:estimates", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, estimateType } = args;
      ctx.metadata({ title: `Estimates: ${symbol} (${estimateType})` });
      const cliArgs = ["research", "estimates", symbol, "--type", estimateType];
      const result = runStanleyCli(cliArgs);
      return renderOutput(`Estimates: ${symbol}`, result);
    }),
  }),
};

// =============================================================================
// Insider Trades Tool
// =============================================================================

const InsiderTradesParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  limit: z.number().default(20).describe("Maximum number of transactions to return"),
});

export const insiderTradesTool: ToolDefinition = {
  id: "stanley:insider-trades",
  category: "domain",
  init: async () => ({
    description: `Get recent insider buy/sell transactions for a company. Returns officer names, transaction types, share amounts, prices, and a net sentiment summary (bullish/bearish). Useful for gauging management confidence.`,
    parameters: InsiderTradesParams,
    execute: withDeduplication("stanley:insider-trades", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, limit } = args;
      ctx.metadata({ title: `Insider Trades: ${symbol}` });
      const cliArgs = ["research", "insider-trades", symbol, "--limit", String(limit)];
      const result = runStanleyCli(cliArgs);
      return renderOutput(`Insider Trades: ${symbol}`, result);
    }),
  }),
};

// =============================================================================
// Business Segments Tool
// =============================================================================

const SegmentsParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  segmentType: z.enum(["business", "geography"]).default("business")
    .describe("Breakdown type: business (product/service lines) or geography (regional revenue)"),
});

export const segmentsTool: ToolDefinition = {
  id: "stanley:segments",
  category: "domain",
  init: async () => ({
    description: `Get revenue breakdown by business segment or geography. Shows multi-period data with growth rates. Use business for product/service line analysis, geography for regional exposure. Essential for understanding revenue concentration and growth drivers.`,
    parameters: SegmentsParams,
    execute: withDeduplication("stanley:segments", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, segmentType } = args;
      ctx.metadata({ title: `Segments: ${symbol} (${segmentType})` });
      const cliArgs = ["market", "segments", symbol, "--type", segmentType];
      const result = runStanleyCli(cliArgs);
      return renderOutput(`Segments: ${symbol}`, result);
    }),
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const STANLEY_TOOLS = [
  statusTool,
  marketDataTool,
  portfolioTool,
  secFilingsTool,
  researchTool,
  nautilusTool,
  estimatesTool,
  insiderTradesTool,
  segmentsTool,
  scratchpadTool,
];

export function registerStanleyTools(registry: { register: (tool: ToolDefinition, options: { source: string }) => void }): void {
  for (const tool of STANLEY_TOOLS) {
    registry.register(tool, { source: "domain" });
  }
}
