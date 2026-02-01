#!/usr/bin/env npx tsx
/**
 * Zee Telegram CLI
 *
 * Usage:
 *   npx tsx zee-telegram.ts send --to @handle --message "Hi" [--mode user|bot]
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

if (command !== "send") {
  console.log(`
Zee Telegram CLI

Commands:
  send --to <chat> --message <text> [--mode user|bot]
`);
  process.exit(0);
}

const to = getArg("to");
const message = getArg("message");
const mode = getArg("mode") || "bot";

if (!to || !message) {
  printError("send requires --to and --message");
  process.exit(1);
}

const result = runZeeCli([
  "telegram",
  "send",
  "--to",
  to,
  "--message",
  message,
  "--mode",
  mode,
  "--json",
]);

if (!result.ok) {
  printError(result.error || "Unknown error");
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
