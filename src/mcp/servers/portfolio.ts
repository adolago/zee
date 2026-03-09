#!/usr/bin/env node
/**
 * Portfolio MCP Server
 *
 * Exposes Investing's financial tools via MCP protocol:
 * - portfolio_status: Get portfolio holdings and performance
 * - portfolio_position: Get/update individual positions
 * - market_data: Get market data for symbols
 * - sec_filings: Search SEC filings
 * - research: Equity research and analysis
 * - backtest: Run trading strategy backtests
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Investing } from "../../paths.js";
import { installMcpParentGuard } from "./parent-guard.js";

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

type PortfolioState = {
  cash: number;
  positions: PortfolioPosition[];
};

function apiBaseUrl(): string {
  return Investing.apiUrl().replace(/\/+$/, "");
}

async function requestInvesting(pathname: string, init?: RequestInit): Promise<InvestingResult> {
  try {
    const response = await fetch(`${apiBaseUrl()}${pathname}`, {
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

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function portfolioFilePath(): string {
  return Investing.portfolioFile();
}

function loadPortfolioState(): PortfolioState {
  const file = portfolioFilePath();
  if (!existsSync(file)) {
    return { cash: 0, positions: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as any;
    if (Array.isArray(parsed)) {
      return {
        cash: 0,
        positions: parsed.map(normalizePosition).filter(Boolean) as PortfolioPosition[],
      };
    }
    return {
      cash: typeof parsed?.cash === "number" ? parsed.cash : 0,
      positions: Array.isArray(parsed?.positions)
        ? parsed.positions.map(normalizePosition).filter(Boolean) as PortfolioPosition[]
        : [],
    };
  } catch {
    return { cash: 0, positions: [] };
  }
}

function normalizePosition(raw: any): PortfolioPosition | null {
  const symbol = typeof raw?.symbol === "string" ? normalizeSymbol(raw.symbol) : "";
  const shares = Number(raw?.shares ?? 0);
  const averageCost = Number(
    raw?.averageCost ??
      raw?.average_cost ??
      raw?.avg_cost ??
      raw?.entryPrice ??
      raw?.entry_price ??
      raw?.price ??
      0,
  );
  if (!symbol || !Number.isFinite(shares) || shares <= 0) return null;
  return {
    symbol,
    shares,
    averageCost: Number.isFinite(averageCost) && averageCost > 0 ? averageCost : 0,
  };
}

function savePortfolioState(state: PortfolioState): void {
  const file = portfolioFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}

function portfolioHoldings(state: PortfolioState) {
  return state.positions.map((position) => ({
    symbol: position.symbol,
    shares: position.shares,
    average_cost: position.averageCost,
  }));
}

async function enrichPositions(state: PortfolioState) {
  return Promise.all(
    state.positions.map(async (position) => {
      const quote = await requestInvesting(`/api/market/${position.symbol}/quote`);
      const quoteData = quote.ok && quote.data && typeof quote.data === "object"
        ? quote.data as Record<string, unknown>
        : {};
      const currentPrice = Number(quoteData.price ?? position.averageCost);
      const marketValue = currentPrice * position.shares;
      const costBasis = position.averageCost * position.shares;
      const pnl = marketValue - costBasis;
      return {
        ...position,
        currentPrice,
        marketValue,
        costBasis,
        pnl,
        pnlPercent: costBasis > 0 ? (pnl / costBasis) * 100 : 0,
      };
    }),
  );
}

async function runInvestingCli(args: string[]): Promise<InvestingResult> {
  const [domain, action] = args;

  if (domain === "status") {
    return requestInvesting("/api/health");
  }

  if (domain === "portfolio") {
    const state = loadPortfolioState();
    if (action === "status") {
      const positions = await enrichPositions(state);
      const analytics = state.positions.length > 0
        ? await requestInvesting("/api/portfolio/analytics", {
            method: "POST",
            body: JSON.stringify({ holdings: portfolioHoldings(state), benchmark: "SPY" }),
          })
        : { ok: true, data: null };
      const risk = hasFlag(args, "--risk") && state.positions.length > 0
        ? await requestInvesting("/api/portfolio/risk", {
            method: "POST",
            body: JSON.stringify({
              holdings: portfolioHoldings(state),
              confidence_level: 0.95,
              method: "historical",
            }),
          })
        : { ok: true, data: null };

      if (!analytics.ok) return analytics;
      if (!risk.ok) return risk;

      return {
        ok: true,
        data: {
          cash: state.cash,
          positions,
          totalValue: positions.reduce((sum, item) => sum + Number(item.marketValue ?? 0), state.cash),
          analytics: analytics.data,
          risk: risk.data,
        },
      };
    }

    const symbol = normalizeSymbol(flagValue(args, "--symbol") || "");
    if (!symbol) {
      return { ok: false, error: "A --symbol value is required for portfolio position commands." };
    }

    if (action === "get") {
      const position = state.positions.find((entry) => entry.symbol === symbol);
      return position
        ? { ok: true, data: position }
        : { ok: false, error: `Position ${symbol} not found.` };
    }

    const shares = Number(flagValue(args, "--shares") ?? 0);
    const price = Number(flagValue(args, "--price") ?? 0);
    const index = state.positions.findIndex((entry) => entry.symbol === symbol);

    if (action === "close") {
      if (index === -1) return { ok: false, error: `Position ${symbol} not found.` };
      const [closed] = state.positions.splice(index, 1);
      savePortfolioState(state);
      return { ok: true, data: { action, closed, remainingPositions: state.positions } };
    }

    if (!Number.isFinite(shares) || shares <= 0) {
      return { ok: false, error: "A positive --shares value is required." };
    }

    if (action === "add") {
      if (index === -1) {
        state.positions.push({
          symbol,
          shares,
          averageCost: Number.isFinite(price) && price > 0 ? price : 0,
        });
      } else {
        const existing = state.positions[index];
        const totalShares = existing.shares + shares;
        const weightedCost = totalShares > 0
          ? ((existing.averageCost * existing.shares) + ((Number.isFinite(price) ? price : existing.averageCost) * shares)) / totalShares
          : existing.averageCost;
        state.positions[index] = {
          symbol,
          shares: totalShares,
          averageCost: weightedCost,
        };
      }
      savePortfolioState(state);
      return { ok: true, data: { action, position: state.positions.find((entry) => entry.symbol === symbol) } };
    }

    if (action === "reduce") {
      if (index === -1) return { ok: false, error: `Position ${symbol} not found.` };
      const remainingShares = state.positions[index].shares - shares;
      if (remainingShares < 0) {
        return { ok: false, error: `Cannot reduce ${symbol} below zero shares.` };
      }
      if (remainingShares === 0) {
        state.positions.splice(index, 1);
      } else {
        state.positions[index] = { ...state.positions[index], shares: remainingShares };
      }
      savePortfolioState(state);
      return { ok: true, data: { action, position: state.positions.find((entry) => entry.symbol === symbol) ?? null } };
    }

    return { ok: false, error: `Unsupported portfolio action: ${action}` };
  }

  if (domain === "market") {
    const symbols = (flagValue(args, "--symbols") || "")
      .split(",")
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean);
    if (action === "quote" && symbols.length > 0) {
      const quotes = await Promise.all(symbols.map(async (symbol) => {
        const result = await requestInvesting(`/api/market/${symbol}/quote`);
        return { symbol, result };
      }));
      const failure = quotes.find((item) => !item.result.ok);
      if (failure) return failure.result;
      return {
        ok: true,
        data: {
          quotes: Object.fromEntries(
            quotes.map((item) => [item.symbol, item.result.data]),
          ),
        },
      };
    }

    const symbol = normalizeSymbol(symbols[0] || args[2] || "");
    if (!symbol) {
      return { ok: false, error: "A symbol is required for market commands." };
    }
    if (action === "historical" || action === "chart") {
      const period = flagValue(args, "--period") || "1mo";
      const interval = flagValue(args, "--interval") || "1d";
      return requestInvesting(`/api/market/${symbol}/history?period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}`);
    }
    if (action === "fundamentals" || action === "indicators") {
      return requestInvesting(`/api/market/${symbol}`);
    }
    return requestInvesting(`/api/market/${symbol}/quote`);
  }

  if (domain === "sec" && action === "filings") {
    const symbol = normalizeSymbol(flagValue(args, "--ticker") || "");
    const filingType = (flagValue(args, "--type") || "10-K").toUpperCase();
    const limit = Number(flagValue(args, "--limit") || 5);
    const result = await requestInvesting(`/api/accounting/${symbol}/filings`);
    if (!result.ok) return result;
    const filings = Array.isArray(result.data)
      ? result.data as Record<string, unknown>[]
      : [];
    return {
      ok: true,
      data: {
        filings: filings
          .filter((item) => filingType === "ALL" || String(item.formType || "").toUpperCase() === filingType)
          .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 5),
        analyzed: hasFlag(args, "--analyze"),
      },
    };
  }

  if (domain === "research" && action === "analyze") {
    const symbol = normalizeSymbol(flagValue(args, "--ticker") || args[2] || "");
    return requestInvesting(`/api/research/${symbol}`);
  }

  if (domain === "nautilus" && action === "backtest") {
    const symbol = normalizeSymbol(flagValue(args, "--symbol") || "");
    return requestInvesting("/api/signals/backtest", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        strategy: flagValue(args, "--strategy") || "momentum",
        start_date: flagValue(args, "--start") || "2025-01-01",
        end_date: flagValue(args, "--end") || "2025-12-31",
        holding_period_days: 10,
        initial_capital: Number(flagValue(args, "--capital") || 100000),
      }),
    });
  }

  return {
    ok: false,
    error: `Unsupported Investing command: ${args.join(" ")}`,
  };
}

// Create server
const server = new McpServer({
  name: "portfolio",
  version: "1.0.0",
});

installMcpParentGuard("portfolio");

// =============================================================================
// portfolio_status - Get portfolio holdings and performance
// =============================================================================

server.tool(
  "portfolio_status",
  `Get current portfolio holdings, performance metrics, and risk analytics.

Returns:
- Holdings with current prices and P&L
- Total portfolio value
- Risk metrics (VaR, Sharpe, Sortino)`,
  {
    includeRisk: z.boolean().default(true).describe("Include risk metrics"),
  },
  async (args) => {
    const { includeRisk } = args;

    const cliArgs = ["portfolio", "status"];
    if (includeRisk !== false) {
      cliArgs.push("--risk");
    }

    const result = await runInvestingCli(cliArgs);

    if (!result.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: result.error,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          ...result.data as object,
        }, null, 2),
      }],
    };
  }
);

// =============================================================================
// portfolio_position - Get/update individual positions
// =============================================================================

server.tool(
  "portfolio_position",
  `Get details about a specific position or update holdings.

Actions:
- get: Get position details
- add: Add to position
- reduce: Reduce position
- close: Close position entirely`,
  {
    action: z.enum(["get", "add", "reduce", "close"]).default("get").describe("Action to perform"),
    symbol: z.string().describe("Stock symbol (e.g., AAPL)"),
    shares: z.number().optional().describe("Number of shares (for add/reduce)"),
    price: z.number().optional().describe("Entry price (for add)"),
  },
  async (args) => {
    const { action, symbol, shares, price } = args;

    const cliArgs = ["portfolio", action ?? "get", "--symbol", symbol.toUpperCase()];
    if (shares !== undefined) {
      cliArgs.push("--shares", String(shares));
    }
    if (price !== undefined) {
      cliArgs.push("--price", String(price));
    }

    const result = await runInvestingCli(cliArgs);

    if (!result.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: result.error,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          symbol: symbol.toUpperCase(),
          action: action ?? "get",
          ...result.data as object,
        }, null, 2),
      }],
    };
  }
);

// =============================================================================
// market_data - Get market data for symbols
// =============================================================================

server.tool(
  "market_data",
  `Get market data for one or more symbols.

Supports:
- Current quote (price, volume, change)
- Historical data (OHLCV)
- Technical indicators`,
  {
    symbols: z.array(z.string()).describe("Stock symbols (e.g., ['AAPL', 'GOOGL'])"),
    dataType: z.enum(["quote", "historical", "indicators"]).default("quote").describe("Type of data to fetch"),
    period: z.enum(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"]).default("1mo").describe("Historical data period"),
    interval: z.enum(["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"]).default("1d").describe("Data interval"),
  },
  async (args) => {
    const { symbols, dataType, period, interval } = args;

    const cliArgs = [
      "market",
      dataType ?? "quote",
      "--symbols",
      symbols.map((s: string) => s.toUpperCase()).join(","),
    ];

    if (dataType === "historical") {
      cliArgs.push("--period", period ?? "1mo");
      cliArgs.push("--interval", interval ?? "1d");
    }

    const result = await runInvestingCli(cliArgs);

    if (!result.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: result.error,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          dataType: dataType ?? "quote",
          symbols: symbols.map((s: string) => s.toUpperCase()),
          ...result.data as object,
        }, null, 2),
      }],
    };
  }
);

// =============================================================================
// sec_filings - Search SEC filings
// =============================================================================

server.tool(
  "sec_filings",
  `Search and analyze SEC filings.

Supports:
- 10-K (annual reports)
- 10-Q (quarterly reports)
- 8-K (current reports)
- 13F (institutional holdings)
- DEF 14A (proxy statements)`,
  {
    ticker: z.string().describe("Company ticker symbol"),
    filingType: z.enum(["10-K", "10-Q", "8-K", "13F", "DEF 14A"]).default("10-K").describe("Type of filing"),
    limit: z.number().default(5).describe("Maximum filings to return"),
    analyze: z.boolean().default(false).describe("Include AI analysis of filing"),
  },
  async (args) => {
    const { ticker, filingType, limit, analyze } = args;

    const cliArgs = [
      "sec",
      "filings",
      "--ticker",
      ticker.toUpperCase(),
      "--type",
      filingType ?? "10-K",
      "--limit",
      String(limit ?? 5),
    ];

    if (analyze) {
      cliArgs.push("--analyze");
    }

    const result = await runInvestingCli(cliArgs);

    if (!result.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: result.error,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          ticker: ticker.toUpperCase(),
          filingType: filingType ?? "10-K",
          ...result.data as object,
        }, null, 2),
      }],
    };
  }
);

// =============================================================================
// research - Equity research and analysis
// =============================================================================

server.tool(
  "research",
  `Get equity research and analysis for a company.

Includes:
- Company overview
- Financial metrics
- Analyst ratings
- News sentiment`,
  {
    ticker: z.string().describe("Company ticker symbol"),
    sections: z.array(z.enum(["overview", "financials", "ratings", "news"])).default(["overview", "financials"]).describe("Research sections to include"),
  },
  async (args) => {
    const { ticker, sections } = args;

    const cliArgs = [
      "research",
      "analyze",
      "--ticker",
      ticker.toUpperCase(),
      "--sections",
      (sections ?? ["overview", "financials"]).join(","),
    ];

    const result = await runInvestingCli(cliArgs);

    if (!result.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: result.error,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          ticker: ticker.toUpperCase(),
          ...result.data as object,
        }, null, 2),
      }],
    };
  }
);

// =============================================================================
// backtest - Run trading strategy backtests
// =============================================================================

server.tool(
  "backtest",
  `Run a trading strategy backtest using NautilusTrader.

Built-in strategies:
- momentum: EMA crossover strategy
- mean-reversion: SMA-based mean reversion

Returns performance metrics, trade history, and equity curve.`,
  {
    strategy: z.enum(["momentum", "mean-reversion"]).describe("Strategy to backtest"),
    symbol: z.string().describe("Symbol to trade (e.g., AAPL)"),
    startDate: z.string().describe("Backtest start date (YYYY-MM-DD)"),
    endDate: z.string().describe("Backtest end date (YYYY-MM-DD)"),
    initialCapital: z.number().default(100000).describe("Initial capital in USD"),
    params: z.record(z.string(), z.any()).optional().describe("Strategy-specific parameters"),
  },
  async (args) => {
    const { strategy, symbol, startDate, endDate, initialCapital, params } = args;

    const cliArgs = [
      "nautilus",
      "backtest",
      "--strategy",
      strategy,
      "--symbol",
      symbol.toUpperCase(),
      "--start",
      startDate,
      "--end",
      endDate,
      "--capital",
      String(initialCapital ?? 100000),
    ];

    if (params) {
      cliArgs.push("--params", JSON.stringify(params));
    }

    const result = await runInvestingCli(cliArgs);

    if (!result.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: result.error,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          strategy,
          symbol: symbol.toUpperCase(),
          period: `${startDate} to ${endDate}`,
          ...result.data as object,
        }, null, 2),
      }],
    };
  }
);

// =============================================================================
// Start server
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Portfolio MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start Portfolio MCP server:", error);
  process.exit(1);
});
