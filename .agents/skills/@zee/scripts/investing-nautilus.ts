#!/usr/bin/env npx tsx
/**
 * investing Nautilus CLI
 *
 * Usage:
 *   npx tsx investing-nautilus.ts backtest momentum --symbols AAPL,MSFT --start 2023-01-01
 *   npx tsx investing-nautilus.ts paper-trade mean-reversion --capital 100000
 *   npx tsx investing-nautilus.ts strategy-info momentum
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type InvestingResult = {
  ok: boolean;
  command?: string;
  data?: unknown;
  error?: string;
};

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

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

function renderJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

switch (command) {
  case "backtest": {
    const strategy = args[1];
    const symbols = getArg("symbols") || "";
    const start = getArg("start") || "";
    const result = runInvestingCli(["nautilus", "backtest", strategy, "--symbols", symbols, "--start", start]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("🧪 BACKTEST");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "paper-trade": {
    const strategy = args[1];
    const capital = getArg("capital") || "100000";
    const result = runInvestingCli(["nautilus", "paper-trade", strategy, "--capital", capital]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("PAPER TRADE");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "strategy-info": {
    const strategy = args[1];
    const result = runInvestingCli(["nautilus", "strategy-info", strategy]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("STRATEGY INFO");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  default:
    console.log(`
investing nautilus CLI

Commands:
  backtest <strategy> --symbols AAPL,MSFT --start 2023-01-01
  paper-trade <strategy> --capital 100000
  strategy-info <strategy>

Examples:
  investing-nautilus.ts backtest momentum --symbols AAPL,MSFT --start 2023-01-01
  investing-nautilus.ts paper-trade mean-reversion --capital 100000
  investing-nautilus.ts strategy-info momentum
`);
}
