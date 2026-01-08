#!/usr/bin/env tsx
/**
 * Telegram User Account Setup Script
 *
 * This script helps you set up Telegram user account authentication.
 * Unlike the bot, this uses your real phone number and MTProto.
 *
 * Usage:
 *   pnpm tsx scripts/telegram-user-setup.ts
 *
 * Prerequisites:
 *   1. Get API credentials from https://my.telegram.org/apps
 *   2. Have your phone number ready
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

const SESSION_DIR = join(homedir(), ".zee", "credentials", "telegram");
const API_FILE = join(SESSION_DIR, "api.json");

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("=== Telegram User Account Setup ===\n");
  console.log("This will configure Zee to use a Telegram user account (not a bot).");
  console.log("You'll appear as a regular user, similar to how Signal works.\n");

  // Check if already configured
  try {
    const existing = await readFile(API_FILE, "utf-8");
    const data = JSON.parse(existing);
    if (data.apiId && data.apiHash) {
      console.log("API credentials already configured.");
      const reconfig = await prompt("Reconfigure? (y/N): ");
      if (reconfig.toLowerCase() !== "y") {
        console.log("\nTo complete setup, run: pnpm zee telegram-user login");
        return;
      }
    }
  } catch {
    // Not configured yet
  }

  console.log("\nStep 1: Get API credentials from https://my.telegram.org/apps");
  console.log("   - Log in with your phone number");
  console.log("   - Go to 'API development tools'");
  console.log("   - Create a new application (any name/platform)");
  console.log("   - Copy the api_id and api_hash\n");

  const apiId = await prompt("Enter api_id: ");
  const apiHash = await prompt("Enter api_hash: ");

  if (!apiId || !apiHash) {
    console.error("Error: Both api_id and api_hash are required");
    process.exit(1);
  }

  // Validate api_id is numeric
  if (!/^\d+$/.test(apiId)) {
    console.error("Error: api_id must be a number");
    process.exit(1);
  }

  // Save credentials
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(
    API_FILE,
    JSON.stringify({ apiId: Number(apiId), apiHash }, null, 2)
  );
  console.log(`\nCredentials saved to ${API_FILE}`);

  console.log("\nStep 2: Configure your phone number");
  console.log("Add to ~/.zee/zee.json:\n");
  console.log(`{
  "telegram": {
    "user": {
      "phoneNumber": "+1234567890",  // Your phone with country code
      "password": "your2FApassword"  // Optional, only if you have 2FA
    }
  }
}`);

  console.log("\nOr set environment variables:");
  console.log("  TELEGRAM_USER_PHONE=+1234567890");
  console.log("  TELEGRAM_USER_2FA=your2FApassword  # optional");

  console.log("\nStep 3: First login");
  console.log("Run: pnpm zee gateway");
  console.log("You'll be prompted to enter the code Telegram sends to your phone.");
  console.log("After first login, the session is saved and won't ask again.");

  console.log("\n=== Setup Complete ===");
}

main().catch(console.error);
