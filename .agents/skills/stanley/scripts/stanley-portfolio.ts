#!/usr/bin/env npx tsx
/**
 * stanley Portfolio CLI
 *
 * Usage:
 *   npx tsx stanley-portfolio.ts status
 *   npx tsx stanley-portfolio.ts performance --period ytd
 *   npx tsx stanley-portfolio.ts risk --var 0.95
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
  case "status": {
    const result = runStanleyCli(["portfolio", "status"]);
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
    const result = runStanleyCli(["portfolio", "performance", "--period", period]);
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
    const result = runStanleyCli(["portfolio", "risk", "--var", varLevel]);
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
stanley portfolio CLI

Commands:
  status
  performance --period ytd
  risk --var 0.95

Examples:
  stanley-portfolio.ts status
  stanley-portfolio.ts performance --period ytd
  stanley-portfolio.ts risk --var 0.95
`);
}
