#!/usr/bin/env npx tsx
/**
 * Zee Calendar CLI
 *
 * Usage:
 *   npx tsx zee-calendar.ts list [--calendar-id <id>] [--max <n>]
 *   npx tsx zee-calendar.ts create --summary <text> --start <iso> --end <iso>
 *   npx tsx zee-calendar.ts delete --event-id <id>
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

const baseArgs = ["calendar", command || ""];

switch (command) {
  case "list": {
    const calendarId = getArg("calendar-id");
    const max = getArg("max");
    if (calendarId) baseArgs.push("--calendar-id", calendarId);
    if (max) baseArgs.push("--max", max);
    baseArgs.push("--json");
    break;
  }
  case "create": {
    const summary = getArg("summary");
    const start = getArg("start");
    const end = getArg("end");
    if (!summary || !start || !end) {
      printError("create requires --summary, --start, and --end");
      process.exit(1);
    }
    const calendarId = getArg("calendar-id");
    const location = getArg("location");
    const description = getArg("description");
    baseArgs.push("--summary", summary, "--start", start, "--end", end);
    if (calendarId) baseArgs.push("--calendar-id", calendarId);
    if (location) baseArgs.push("--location", location);
    if (description) baseArgs.push("--description", description);
    baseArgs.push("--json");
    break;
  }
  case "delete": {
    const eventId = getArg("event-id");
    if (!eventId) {
      printError("delete requires --event-id");
      process.exit(1);
    }
    const calendarId = getArg("calendar-id");
    baseArgs.push("--event-id", eventId);
    if (calendarId) baseArgs.push("--calendar-id", calendarId);
    baseArgs.push("--json");
    break;
  }
  default:
    console.log(`
Zee Calendar CLI

Commands:
  list [--calendar-id <id>] [--max <n>]
  create --summary <text> --start <iso> --end <iso>
  delete --event-id <id>
`);
    process.exit(0);
}

const result = runZeeCli(baseArgs);
if (!result.ok) {
  printError(result.error || "Unknown error");
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
