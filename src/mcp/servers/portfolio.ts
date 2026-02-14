#!/usr/bin/env node
/**
 * Portfolio MCP Server
 *
 * Exposes Stanley's financial tools via MCP protocol:
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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { getSafeEnv } from "../../util/safe-env.js";
import { Stanley } from "../../paths.js";
import { installMcpParentGuard } from "./parent-guard.js";

type StanleyResult = {
  ok: boolean;
  command?: string;
  data?: unknown;
  error?: string;
};

function resolveStanleyCli(): { python: string; cliPath: string; pythonPath?: string } {
  return {
    python: Stanley.python(),
    cliPath: Stanley.cli(),
    pythonPath: Stanley.pythonPath(),
  };
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
    timeout: 60000, // 60 second timeout
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
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

    const result = runStanleyCli(cliArgs);

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

    const result = runStanleyCli(cliArgs);

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
      symbols.map((s) => s.toUpperCase()).join(","),
    ];

    if (dataType === "historical") {
      cliArgs.push("--period", period ?? "1mo");
      cliArgs.push("--interval", interval ?? "1d");
    }

    const result = runStanleyCli(cliArgs);

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
          symbols: symbols.map((s) => s.toUpperCase()),
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

    const result = runStanleyCli(cliArgs);

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

    const result = runStanleyCli(cliArgs);

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

    const result = runStanleyCli(cliArgs);

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
