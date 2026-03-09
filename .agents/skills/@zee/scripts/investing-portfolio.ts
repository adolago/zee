#!/usr/bin/env npx tsx
/**
 * investing Portfolio CLI
 *
 * Usage:
 *   npx tsx investing-portfolio.ts status
 *   npx tsx investing-portfolio.ts performance --period ytd
 *   npx tsx investing-portfolio.ts risk --var 0.95
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
  case "status": {
    const result = runInvestingCli(["portfolio", "status"]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("PORTFOLIO STATUS");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "performance": {
    const period = getArg("period") || "ytd";
    const result = runInvestingCli(["portfolio", "performance", "--period", period]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("PORTFOLIO PERFORMANCE");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "risk": {
    const varLevel = getArg("var") || "0.95";
    const result = runInvestingCli(["portfolio", "risk", "--var", varLevel]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("PORTFOLIO RISK");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  default:
    console.log(`
investing portfolio CLI

Commands:
  status
  performance --period ytd
  risk --var 0.95

Examples:
  investing-portfolio.ts status
  investing-portfolio.ts performance --period ytd
  investing-portfolio.ts risk --var 0.95
`);
}
