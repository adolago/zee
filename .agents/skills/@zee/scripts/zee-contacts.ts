#!/usr/bin/env npx tsx
/**
 * Zee Contacts CLI
 *
 * Usage:
 *   npx tsx zee-contacts.ts add --name "Sarah" [--platform telegram] [--topic "..."]
 *   npx tsx zee-contacts.ts list [--limit 20] [--contains "sa"]
 *   npx tsx zee-contacts.ts last --name "Sarah"
 *   npx tsx zee-contacts.ts dormant --days 30
 */

import { runZeeCli } from "./zee-runner";

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function printError(message: string) {
  console.error("\n  Zee CLI unavailable");
  console.error(message);
}

const baseArgs = ["contacts", command || ""];

switch (command) {
  case "add": {
    const name = getArg("name");
    if (!name) {
      printError("add requires --name");
      process.exit(1);
    }
    const platform = getArg("platform");
    const topic = getArg("topic");
    if (platform) baseArgs.push("--platform", platform);
    if (topic) baseArgs.push("--topic", topic);
    baseArgs.push("--name", name, "--json");
    break;
  }
  case "list": {
    const limit = getArg("limit");
    const contains = getArg("contains");
    if (limit) baseArgs.push("--limit", limit);
    if (contains) baseArgs.push("--contains", contains);
    baseArgs.push("--json");
    break;
  }
  case "last": {
    const name = getArg("name");
    if (!name) {
      printError("last requires --name");
      process.exit(1);
    }
    baseArgs.push("--name", name, "--json");
    break;
  }
  case "dormant": {
    const days = getArg("days");
    if (days) baseArgs.push("--days", days);
    baseArgs.push("--json");
    break;
  }
  default:
    console.log(`
Zee Contacts CLI

Commands:
  add --name <name> [--platform <platform>] [--topic <topic>]
  list [--limit <n>] [--contains <q>]
  last --name <name>
  dormant --days <n>
`);
    process.exit(0);
}

const result = runZeeCli(baseArgs);
if (!result.ok) {
  printError(result.error || "Unknown error");
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
