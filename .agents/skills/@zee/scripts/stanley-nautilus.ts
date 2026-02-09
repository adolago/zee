#!/usr/bin/env npx tsx
/**
 * stanley Nautilus CLI
 *
 * Usage:
 *   npx tsx stanley-nautilus.ts backtest momentum --symbols AAPL,MSFT --start 2023-01-01
 *   npx tsx stanley-nautilus.ts paper-trade mean-reversion --capital 100000
 *   npx tsx stanley-nautilus.ts strategy-info momentum
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type StanleyResult = {
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

function resolveStanleyCli(): { python: string; cliPath: string } {
  const repo = process.env.STANLEY_REPO || join(homedir(), ".local", "src", "agent-core", "vendor", "personas", "stanley");
  const cliPath = process.env.STANLEY_CLI || join(repo, "scripts", "stanley_cli.py");
  const venvPython = join(repo, ".venv", "bin", "python");
  const python = process.env.STANLEY_PYTHON || (existsSync(venvPython) ? venvPython : "python3");
  return { python, cliPath };
}

function runStanleyCli(cliArgs: string[]): StanleyResult {
  const { python, cliPath } = resolveStanleyCli();
  if (!existsSync(cliPath)) {
    return {
      ok: false,
      error: `Stanley CLI not found at ${cliPath}. Set STANLEY_REPO or STANLEY_CLI.`,
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
    return JSON.parse(stdout) as StanleyResult;
  } catch {
    return {
      ok: false,
      error: stdout || "Stanley CLI returned no output.",
    };
  }
}

function printError(message: string) {
  console.error("\n⚠️  Stanley backend unavailable");
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
    const result = runStanleyCli(["nautilus", "backtest", strategy, "--symbols", symbols, "--start", start]);
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
    const result = runStanleyCli(["nautilus", "paper-trade", strategy, "--capital", capital]);
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
    const result = runStanleyCli(["nautilus", "strategy-info", strategy]);
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
stanley nautilus CLI

Commands:
  backtest <strategy> --symbols AAPL,MSFT --start 2023-01-01
  paper-trade <strategy> --capital 100000
  strategy-info <strategy>

Examples:
  stanley-nautilus.ts backtest momentum --symbols AAPL,MSFT --start 2023-01-01
  stanley-nautilus.ts paper-trade mean-reversion --capital 100000
  stanley-nautilus.ts strategy-info momentum
`);
}
