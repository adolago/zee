#!/usr/bin/env npx tsx
/**
 * stanley Research CLI
 *
 * Usage:
 *   npx tsx stanley-research.ts sec AAPL --type 10-K
 *   npx tsx stanley-research.ts analyze AAPL --filing 10-K
 *   npx tsx stanley-research.ts screen --criteria "pe<15,roe>20"
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
  case "sec": {
    const symbol = args[1];
    const formType = getArg("type") || "10-K";
    const limit = getArg("limit") || "5";
    const result = runStanleyCli(["research", "sec", symbol, "--type", formType, "--limit", limit]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("SEC FILINGS");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "analyze": {
    const symbol = args[1];
    const formType = getArg("filing") || "10-K";
    const result = runStanleyCli(["research", "analyze", symbol, "--filing", formType]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("🧾 FILING EXCERPT");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "screen": {
    const criteria = getArg("criteria") || "";
    const result = runStanleyCli(["research", "screen", "--criteria", criteria]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("SCREEN RESULTS");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  default:
    console.log(`
stanley research CLI

Commands:
  sec <symbol> --type 10-K [--limit 5]
  analyze <symbol> --filing 10-K
  screen --criteria "pe<15,roe>20"

Examples:
  stanley-research.ts sec AAPL --type 10-K
  stanley-research.ts analyze AAPL --filing 10-K
  stanley-research.ts screen --criteria "pe<15,roe>20"
`);
}
