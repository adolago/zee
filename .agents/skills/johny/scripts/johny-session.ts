#!/usr/bin/env npx tsx
/**
 * johny Study Session CLI (external persona bridge)
 *
 * Usage:
 *   npx tsx johny-session.ts start [--domain <domain>] [--minutes <n>]
 *   npx tsx johny-session.ts next-task
 *   npx tsx johny-session.ts complete --topic <id> --score <0-1>
 *   npx tsx johny-session.ts progress [--domain <domain>]
 *   npx tsx johny-session.ts path --target <topic-id>
 *   npx tsx johny-session.ts review-due
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type JohnyResult = {
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

function resolveJohnyCli(): { python: string; cliPath: string } {
  const python = process.env.JOHNY_PYTHON || "python3";
  const repo = process.env.JOHNY_REPO || join(homedir(), ".local", "src", "agent-core", "vendor", "personas", "johny");
  const cliPath = process.env.JOHNY_CLI || join(repo, "scripts", "johny_cli.py");
  return { python, cliPath };
}

function runJohnyCli(cliArgs: string[]): JohnyResult {
  const { python, cliPath } = resolveJohnyCli();
  if (!existsSync(cliPath)) {
    return {
      ok: false,
      error: `Johny CLI not found at ${cliPath}. Set JOHNY_REPO or JOHNY_CLI.`,
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
    return JSON.parse(stdout) as JohnyResult;
  } catch {
    return { ok: false, error: stdout || "Johny CLI returned no output." };
  }
}

function printError(message: string) {
  console.error("\n⚠️  Johny backend unavailable");
  console.error(message);
}

function renderJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

switch (command) {
  case "start": {
    const domain = getArg("domain") || "math";
    const minutes = getArg("minutes") || "30";
    const result = runJohnyCli(["start", "--domain", domain, "--minutes", minutes]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    console.log("\n" + "═".repeat(50));
    console.log("JOHNY SESSION");
    console.log("═".repeat(50));
    renderJson(result.data);
    break;
  }
  case "next-task": {
    const result = runJohnyCli(["next-task"]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    renderJson(result.data);
    break;
  }
  case "complete": {
    const topic = getArg("topic") || "";
    const score = getArg("score") || "0";
    const result = runJohnyCli(["complete", "--topic", topic, "--score", score]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    renderJson(result.data);
    break;
  }
  case "progress": {
    const domain = getArg("domain") || "math";
    const result = runJohnyCli(["progress", "--domain", domain]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    renderJson(result.data);
    break;
  }
  case "path": {
    const target = getArg("target") || "";
    const result = runJohnyCli(["path", "--target", target]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    renderJson(result.data);
    break;
  }
  case "review-due": {
    const result = runJohnyCli(["review-due"]);
    if (!result.ok) {
      printError(result.error || "Unknown error");
      break;
    }
    renderJson(result.data);
    break;
  }
  default:
    console.log(`
johny study session CLI

Commands:
  start [--domain <d>] [--minutes <n>]
  next-task
  complete --topic <id> --score <0-1>
  progress [--domain <d>]
  path --target <topic-id>
  review-due

Examples:
  johny-session.ts start --domain mathematics --minutes 30
  johny-session.ts next-task
  johny-session.ts complete --topic derivatives --score 0.85
`);
}
