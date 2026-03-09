#!/usr/bin/env npx tsx
/**
 * investing Market Data CLI
 *
 * Wraps market data capabilities for Zee's investing domain.
 * Uses OpenBB for market data and analysis.
 *
 * Usage:
 *   npx tsx investing-market.ts quote <symbols...>
 *   npx tsx investing-market.ts chart <symbol> [--period <p>] [--indicators <i>]
 *   npx tsx investing-market.ts fundamentals <symbol> [--metrics <m>]
 *   npx tsx investing-market.ts news <symbol> [--limit <n>]
 *   npx tsx investing-market.ts screen [--criteria <c>]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Bridge to the Investing Python runtime (stdio JSON).

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

type InvestingResult = {
  ok: boolean;
  command?: string;
  data?: unknown;
  error?: string;
};

function resolveInvestingCli(): { python: string; cliPath: string } {
  const repo = process.env.ZEE_INVESTING_REPO || join(homedir(), "Repositories", "zee", "investing");
  const cliPath = process.env.ZEE_INVESTING_CLI || join(repo, "scripts", "investing_cli.py");
  const venvPython = join(repo, ".venv", "bin", "python");
  const python = process.env.ZEE_INVESTING_PYTHON || (existsSync(venvPython) ? venvPython : "python3");
  return { python, cliPath };
}

function runInvestingCli(cliArgs: string[]): InvestingResult {
  const { python, cliPath } = resolveInvestingCli();
  if (!existsSync(cliPath)) {
    return {
      ok: false,
      error: `Investing CLI not found at ${cliPath}. Set ZEE_INVESTING_REPO or ZEE_INVESTING_CLI.`,
    };
  }

  const result = spawnSync(python, [cliPath, ...cliArgs], {
    encoding: "utf-8",
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  const stdout = result.stdout.trim();
  try {
    return JSON.parse(stdout) as InvestingResult;
  } catch {
    return {
      ok: false,
      error: stdout || "Investing CLI returned no output.",
    };
  }
}

function printError(message: string) {
  console.error("\n⚠️  Investing backend unavailable");
  console.error(message);
}

async function getQuotes(symbols: string[]) {
  console.log("\n" + "═".repeat(50));
  console.log("MARKET QUOTES");
  console.log("═".repeat(50));

  const result = runInvestingCli(["market", "quote", ...symbols]);
  if (!result.ok) {
    printError(result.error || "Unknown error");
    return;
  }

  const data = (result.data as Array<{ symbol?: string; price?: number; volume?: number }>) ?? [];
  if (data.length === 0) {
    console.log("\nNo quote data returned.");
    return;
  }

  console.log("\nSymbol  |  Price    |  Volume");
  console.log("--------|-----------|----------");
  for (const row of data) {
    const symbol = row.symbol ?? "-";
    const price = row.price ? `$${row.price.toFixed(2)}` : "-";
    const volume = row.volume ? row.volume.toLocaleString() : "-";
    console.log(`${symbol.padEnd(7)}|  ${price.padEnd(9)}|  ${volume}`);
  }
}

async function getChart(symbol: string, period?: string, indicators?: string) {
  console.log("\n" + "═".repeat(50));
  console.log(`${symbol} CHART`);
  console.log("═".repeat(50));

  console.log(`\nPeriod: ${period || "6mo"}`);
  console.log(`Indicators: ${indicators || "none"}`);

  const result = runInvestingCli(["market", "chart", symbol, "--period", period || "6m"]);
  if (!result.ok) {
    printError(result.error || "Unknown error");
    return;
  }

  const payload = result.data as { bars?: Array<{ close?: number; timestamp?: string }> };
  const bars = payload?.bars ?? [];
  console.log(`\nBars returned: ${bars.length}`);
  if (bars.length > 0) {
    const last = bars[bars.length - 1];
    console.log(`Last close: ${last.close ?? "n/a"} @ ${last.timestamp ?? "n/a"}`);
  }
}

async function getFundamentals(symbol: string, metrics?: string) {
  console.log("\n" + "═".repeat(50));
  console.log(`${symbol} FUNDAMENTALS`);
  console.log("═".repeat(50));

  console.log(`\nRequested metrics: ${metrics || "all"}`);

  const result = runInvestingCli(["market", "fundamentals", symbol]);
  if (!result.ok) {
    printError(result.error || "Unknown error");
    return;
  }

  const payload = result.data as { fundamentals?: Record<string, unknown> };
  const fundamentals = payload?.fundamentals ?? {};

  const keys = Object.keys(fundamentals);
  if (keys.length === 0) {
    console.log("\nNo fundamentals returned.");
    return;
  }

  const selected = metrics ? metrics.split(",") : keys.slice(0, 10);
  console.log();
  for (const key of selected) {
    if (key in fundamentals) {
      console.log(`${key}: ${fundamentals[key]}`);
    }
  }
}

async function getNews(symbol: string, limit?: number) {
  console.log("\n" + "═".repeat(50));
  console.log(`${symbol} NEWS`);
  console.log("═".repeat(50));

  console.log(`\nLimit: ${limit || 10} articles`);

  const result = runInvestingCli(["market", "news", symbol, "--limit", String(limit || 10)]);
  if (!result.ok) {
    printError(result.error || "Unknown error");
    return;
  }

  console.log("\nNews returned (JSON):");
  console.log(JSON.stringify(result.data, null, 2));
}

async function screenStocks(criteria?: string) {
  console.log("\n" + "═".repeat(50));
  console.log("STOCK SCREENER");
  console.log("═".repeat(50));

  console.log(`\nCriteria: ${criteria || "none specified"}`);

  const result = runInvestingCli(["market", "screen", "--criteria", criteria || ""]);
  if (!result.ok) {
    printError(result.error || "Unknown error");
    return;
  }

  console.log("\nScreen results (JSON):");
  console.log(JSON.stringify(result.data, null, 2));
}

// CLI Router
switch (command) {
  case "quote":
    getQuotes(args.slice(1).filter((a) => !a.startsWith("--")));
    break;
  case "chart":
    getChart(args[1], getArg("period"), getArg("indicators"));
    break;
  case "fundamentals":
    getFundamentals(args[1], getArg("metrics"));
    break;
  case "news":
    getNews(args[1], parseInt(getArg("limit") || "10"));
    break;
  case "screen":
    screenStocks(getArg("criteria"));
    break;
  default:
    console.log(`
investing market data CLI

Commands:
  quote <symbols...>                    Get real-time quotes
  chart <symbol> [--period p]           Show price chart
  fundamentals <symbol> [--metrics m]   Get fundamental data
  news <symbol> [--limit n]             Get recent news
  screen [--criteria c]                 Screen stocks

Examples:
  investing-market.ts quote AAPL MSFT GOOGL
  investing-market.ts chart AAPL --period 6mo --indicators sma,rsi
  investing-market.ts fundamentals NVDA --metrics pe,roe,growth
  investing-market.ts screen --criteria "pe<15,roe>20"
`);
}
