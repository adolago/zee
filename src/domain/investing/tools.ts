/**
 * Investing Domain Tools
 *
 * Financial research and market analysis tools powered by:
 * - OpenBB Platform for market data
 * - NautilusTrader for algorithmic trading
 * - SEC EDGAR for regulatory filings
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import type { ToolDefinition, ToolRuntime, ToolExecutionContext, ToolExecutionResult } from "../../mcp/types";
import { Investing } from "../../paths";
import { scratchpadTool } from "./scratchpad";
import { getResearchContextManager, resetResearchContextManager } from "./research-context";

type InvestingResult = {
  ok: boolean;
  command?: string;
  data?: unknown;
  error?: string;
};

type InvestingEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
  timestamp: string;
};

type PortfolioPosition = {
  symbol: string;
  shares: number;
  averageCost: number;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function loadPortfolioHoldings(): Array<{ symbol: string; shares: number; average_cost: number }> {
  const portfolioFile = Investing.portfolioFile();
  if (!existsSync(portfolioFile)) return [];

  try {
    const parsed = JSON.parse(readFileSync(portfolioFile, "utf8")) as any;
    const positions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.positions)
        ? parsed.positions
        : [];

    return positions
      .map((position: any): PortfolioPosition | null => {
        const symbol = typeof position?.symbol === "string" ? normalizeSymbol(position.symbol) : "";
        const shares = Number(position?.shares ?? 0);
        const averageCost = Number(
          position?.averageCost ??
            position?.average_cost ??
            position?.avg_cost ??
            position?.entryPrice ??
            position?.entry_price ??
            position?.price ??
            0,
        );
        if (!symbol || !Number.isFinite(shares) || shares <= 0) return null;
        return { symbol, shares, averageCost };
      })
      .filter((position: PortfolioPosition | null): position is PortfolioPosition => Boolean(position))
      .map((position: PortfolioPosition) => ({
        symbol: position.symbol,
        shares: position.shares,
        average_cost: position.averageCost,
      }));
  } catch {
    return [];
  }
}

async function requestInvesting(pathname: string, init?: RequestInit): Promise<InvestingResult> {
  try {
    const baseUrl = Investing.apiUrl().replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as InvestingEnvelope<unknown> | unknown : null;

    if (
      payload &&
      typeof payload === "object" &&
      "success" in payload &&
      "data" in payload
    ) {
      const envelope = payload as InvestingEnvelope<unknown>;
      if (!response.ok || !envelope.success) {
        return {
          ok: false,
          error: envelope.error || `Investing request failed with status ${response.status}`,
        };
      }
      return { ok: true, data: envelope.data };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: text || `Investing request failed with status ${response.status}`,
      };
    }

    return { ok: true, data: payload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runInvestingCli(args: string[]): Promise<InvestingResult> {
  const [domain, action] = args;

  if (domain === "status") {
    return requestInvesting("/api/health");
  }

  if (domain === "market") {
    const symbol = normalizeSymbol(args[2] || "");
    if (!symbol) {
      return { ok: false, error: "A market symbol is required." };
    }
    if (action === "chart") {
      const period = flagValue(args, "--period") || "1mo";
      return requestInvesting(`/api/market/${symbol}/history?period=${encodeURIComponent(period)}&interval=1d`);
    }
    if (action === "segments") {
      return {
        ok: true,
        data: {
          symbol,
          segmentType: flagValue(args, "--type") || "business",
          note: "Segment detail is not yet exposed on the Rust investing HTTP surface.",
        },
      };
    }
    if (action === "fundamentals") {
      return requestInvesting(`/api/market/${symbol}`);
    }
    return requestInvesting(`/api/market/${symbol}/quote`);
  }

  if (domain === "portfolio") {
    const holdings = loadPortfolioHoldings();
    if (action === "status") {
      return {
        ok: true,
        data: {
          holdings,
          totalValue: holdings.reduce(
            (total, holding) => total + holding.shares * holding.average_cost,
            0,
          ),
        },
      };
    }
    if (action === "risk") {
      return requestInvesting("/api/portfolio/risk", {
        method: "POST",
        body: JSON.stringify({
          holdings,
          confidence_level: 0.95,
          method: "historical",
        }),
      });
    }
    if (action === "performance") {
      return requestInvesting("/api/portfolio/analytics", {
        method: "POST",
        body: JSON.stringify({ holdings, benchmark: "SPY" }),
      });
    }
  }

  if (domain === "research") {
    if (action === "analyze") {
      const symbol = normalizeSymbol(flagValue(args, "--ticker") || args[2] || "");
      return requestInvesting(`/api/research/${symbol}`);
    }
    if (action === "sec") {
      const symbol = normalizeSymbol(args[2] || "");
      return requestInvesting(`/api/accounting/${symbol}/filings`);
    }
    if (action === "screen") {
      const query = flagValue(args, "--criteria") || "";
      if (/^[A-Za-z.\-]{1,12}$/.test(query.trim())) {
        return requestInvesting(`/api/research/${normalizeSymbol(query)}`);
      }
      return {
        ok: true,
        data: {
          query,
          results: [],
          note: "Broad research screening is not yet exposed on the Rust investing HTTP surface.",
        },
      };
    }
    if (action === "estimates") {
      const symbol = normalizeSymbol(args[2] || "");
      return requestInvesting(`/api/valuation/${symbol}`);
    }
    if (action === "insider-trades") {
      const symbol = normalizeSymbol(args[2] || "");
      return requestInvesting(`/api/institutional/${symbol}/smart-money-flow`);
    }
  }

  if (domain === "nautilus") {
    if (action === "backtest") {
      const symbol = normalizeSymbol((flagValue(args, "--symbols") || "").split(",")[0] || "SPY");
      return requestInvesting("/api/signals/backtest", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          strategy: args[2] || "momentum",
          start_date: flagValue(args, "--start") || "2025-01-01",
          end_date: flagValue(args, "--end") || "2025-12-31",
          holding_period_days: 10,
          initial_capital: 100000,
        }),
      });
    }
    return {
      ok: true,
      data: {
        action,
        note: "This Nautilus action is not yet exposed on the Rust investing HTTP surface.",
      },
    };
  }

  return {
    ok: false,
    error: `Unsupported investing command: ${args.join(" ")}`,
  };
}

function renderOutput(title: string, result: InvestingResult): ToolExecutionResult {
  if (!result.ok) {
    return {
      title,
      metadata: { ok: false },
      output: result.error || "Investing CLI failed.",
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
 * Wrap an investing tool's execute function with research-session deduplication.
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
  id: "zee:invest-market-data",
  category: "domain",
  init: async () => ({
    description: `Retrieve real-time and historical market data for stocks, ETFs, and indices. Data types: quote (current price), chart (historical), fundamentals (P/E, market cap), news.`,
    parameters: MarketDataParams,
    execute: withDeduplication("zee:invest-market-data", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, dataType, period } = args;

      ctx.metadata({ title: `Fetching ${dataType} for ${symbol}` });

      if (dataType === "news") {
        return {
          title: `Market Data: ${symbol}`,
          metadata: { symbol, dataType },
          output: "News is not available in the Investing CLI yet.",
        };
      }

      const cliArgs =
        dataType === "chart"
          ? ["market", "chart", symbol, "--period", period]
          : dataType === "fundamentals"
            ? ["market", "fundamentals", symbol]
            : ["market", "quote", symbol];
      const result = await runInvestingCli(cliArgs);
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
  id: "zee:invest-portfolio",
  category: "domain",
  init: async () => ({
    description: `Analyze and optimize investment portfolios. Check memory for user positions first. Actions: get (current), analyze (performance + risk metrics), optimize, backtest.`,
    parameters: PortfolioParams,
    execute: withDeduplication("zee:invest-portfolio", async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, portfolioId, benchmark, riskMetrics } = args;

      ctx.metadata({ title: `Portfolio ${action}` });

      if (action === "optimize") {
        return {
          title: "Portfolio Analysis",
          metadata: { action, portfolioId: portfolioId || "default", benchmark, riskMetrics },
          output: "Portfolio optimization is not available in the Investing CLI yet.",
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
      const result = await runInvestingCli(cliArgs);
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
  id: "zee:invest-sec-filings",
  category: "domain",
  init: async () => ({
    description: `Access and analyze SEC regulatory filings. Form types: 10-K (annual), 10-Q (quarterly), 8-K (events), 13F (holdings), DEF14A (proxy), S-1 (IPO). Set summarize=true for AI summary.`,
    parameters: SecFilingsParams,
    execute: withDeduplication("zee:invest-sec-filings", async (args, ctx): Promise<ToolExecutionResult> => {
      const { ticker, formType, year, summarize } = args;

      ctx.metadata({ title: `SEC ${formType} for ${ticker}` });

      const cliArgs = summarize
        ? ["research", "analyze", ticker, "--filing", formType]
        : ["research", "sec", ticker, "--type", formType];
      const result = await runInvestingCli(cliArgs);
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
  id: "zee:invest-research",
  category: "domain",
  init: async () => ({
    description: `Conduct financial research across multiple sources (SEC, news, analyst, academic). Check memory for previous analyses first. Specify dateRange and limit for results.`,
    parameters: ResearchParams,
    execute: withDeduplication("zee:invest-research", async (args, ctx): Promise<ToolExecutionResult> => {
      const { query, sources, dateRange, limit } = args;

      ctx.metadata({ title: `Researching: ${query}` });

      const result = await runInvestingCli(["research", "screen", "--criteria", query]);
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
  id: "zee:invest-nautilus",
  category: "domain",
  init: async () => ({
    description: `Interface with NautilusTrader for algorithmic trading research. Actions: backtest, paper_trade, strategy_info, market_status. Simulation only, no real trading.`,
    parameters: NautilusParams,
    execute: withDeduplication("zee:invest-nautilus", async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, strategy, symbols, startDate, endDate } = args;

      ctx.metadata({ title: `Nautilus: ${action}` });

      if (action === "market_status") {
        return {
          title: `NautilusTrader: ${action}`,
          metadata: { action, strategy, symbols },
          output: "Market status is not available in the Investing CLI yet.",
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
      const result = await runInvestingCli(cliArgs);
      const response = renderOutput(`NautilusTrader: ${action}`, result);
      response.metadata = { ...response.metadata, action, strategy, symbols, startDate, endDate };
      return response;
    }),
  }),
};

export const statusTool: ToolDefinition = {
  id: "zee:invest-status",
  category: "domain",
  init: async () => ({
    description: "Check the health and connection status of the Investing investment platform.",
    parameters: z.object({}),
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
       const result = await runInvestingCli(["status"]);
       // If 'status' isn't supported by CLI, we can try a lightweight command like checking version or help
       // Let's assume we just want to verify CLI is runnable.
       
       if (!result.ok && result.error?.includes("Investing CLI not found")) {
           return {
               title: "Investing Status",
               metadata: { ok: false },
               output: "Investing is not installed or not found. Configure the investing backend.",
           };
       }
       
       // Try a lightweight ping/version if status fails, but for now report result
       return renderOutput("Investing Status", result);
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
  id: "zee:invest-estimates",
  category: "domain",
  init: async () => ({
    description: `Get analyst estimates, consensus ratings, forward EPS, price targets, and revision history. Use consensus for quick overview, forward_eps for quarterly/annual projections, price_target for individual analyst calls, revisions for upgrade/downgrade momentum.`,
    parameters: EstimatesParams,
    execute: withDeduplication("zee:invest-estimates", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, estimateType } = args;
      ctx.metadata({ title: `Estimates: ${symbol} (${estimateType})` });
      const cliArgs = ["research", "estimates", symbol, "--type", estimateType];
      const result = await runInvestingCli(cliArgs);
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
  id: "zee:invest-insider-trades",
  category: "domain",
  init: async () => ({
    description: `Get recent insider buy/sell transactions for a company. Returns officer names, transaction types, share amounts, prices, and a net sentiment summary (bullish/bearish). Useful for gauging management confidence.`,
    parameters: InsiderTradesParams,
    execute: withDeduplication("zee:invest-insider-trades", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, limit } = args;
      ctx.metadata({ title: `Insider Trades: ${symbol}` });
      const cliArgs = ["research", "insider-trades", symbol, "--limit", String(limit)];
      const result = await runInvestingCli(cliArgs);
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
  id: "zee:invest-segments",
  category: "domain",
  init: async () => ({
    description: `Get revenue breakdown by business segment or geography. Shows multi-period data with growth rates. Use business for product/service line analysis, geography for regional exposure. Essential for understanding revenue concentration and growth drivers.`,
    parameters: SegmentsParams,
    execute: withDeduplication("zee:invest-segments", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, segmentType } = args;
      ctx.metadata({ title: `Segments: ${symbol} (${segmentType})` });
      const cliArgs = ["market", "segments", symbol, "--type", segmentType];
      const result = await runInvestingCli(cliArgs);
      return renderOutput(`Segments: ${symbol}`, result);
    }),
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const INVESTING_TOOLS = [
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

export function registerInvestingTools(registry: { register: (tool: ToolDefinition, options: { source: string }) => void }): void {
  for (const tool of INVESTING_TOOLS) {
    registry.register(tool, { source: "domain" });
  }
}
