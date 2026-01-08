/**
 * Telegram User Account Provider (MTProto via GramJS)
 *
 * Unlike the bot provider (grammY/Bot API), this uses MTProto to act as a
 * regular Telegram user account with a phone number - similar to how Signal works.
 *
 * Key differences from bot:
 * - Auth via phone number + code + optional 2FA (not bot token)
 * - Can message anyone (bots require users to start chat first)
 * - Shows as regular user, not a bot
 * - Uses MTProto protocol (encrypted) vs HTTP Bot API
 */

import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

import { getChildLogger } from "../logging.js";
import type { ZeeConfig } from "../config/config.js";

const log = getChildLogger("telegram-user");

const SESSION_DIR = join(homedir(), ".zee", "credentials", "telegram");
const SESSION_FILE = join(SESSION_DIR, "user-session.txt");

interface TelegramUserConfig {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  // Optional 2FA password
  password?: string;
}

interface TelegramUserProvider {
  client: TelegramClient;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(to: string | number, text: string): Promise<void>;
  onMessage(handler: (event: NewMessageEvent) => Promise<void>): void;
}

/**
 * Load saved session string from disk
 */
async function loadSession(): Promise<string> {
  try {
    const session = await readFile(SESSION_FILE, "utf-8");
    return session.trim();
  } catch {
    return "";
  }
}

/**
 * Save session string to disk
 */
async function saveSession(session: string): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(SESSION_FILE, session);
  log.info("Session saved to", SESSION_FILE);
}

/**
 * Interactive prompt for auth code/password
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Create and authenticate a Telegram user client
 *
 * On first run, prompts for phone code interactively.
 * On subsequent runs, uses saved session.
 */
export async function createTelegramUserClient(
  config: TelegramUserConfig
): Promise<TelegramUserProvider> {
  const sessionString = await loadSession();
  const session = new StringSession(sessionString);

  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  let messageHandlers: Array<(event: NewMessageEvent) => Promise<void>> = [];

  const provider: TelegramUserProvider = {
    client,

    async start() {
      log.info("Starting Telegram user client for", config.phoneNumber);

      await client.start({
        phoneNumber: config.phoneNumber,
        password: async () => {
          if (config.password) return config.password;
          return prompt("Enter your 2FA password: ");
        },
        phoneCode: async () => {
          return prompt("Enter the code you received: ");
        },
        onError: (err) => {
          log.error("Auth error:", err.message);
          throw err;
        },
      });

      // Save session for future use
      const newSession = client.session.save() as unknown as string;
      if (newSession && newSession !== sessionString) {
        await saveSession(newSession);
      }

      log.info("Telegram user client connected");

      // Get current user info
      const me = await client.getMe();
      log.info(`Logged in as: ${me.firstName} ${me.lastName || ""} (@${me.username || "no username"})`);

      // Set up message handler
      client.addEventHandler(async (event: NewMessageEvent) => {
        for (const handler of messageHandlers) {
          try {
            await handler(event);
          } catch (err) {
            log.error("Message handler error:", err);
          }
        }
      }, new NewMessage({}));
    },

    async stop() {
      log.info("Stopping Telegram user client");
      await client.disconnect();
    },

    async sendMessage(to: string | number, text: string) {
      await client.sendMessage(to, { message: text });
    },

    onMessage(handler: (event: NewMessageEvent) => Promise<void>) {
      messageHandlers.push(handler);
    },
  };

  return provider;
}

/**
 * Get Telegram API credentials
 *
 * These come from https://my.telegram.org/apps
 * Store them in ~/.zee/credentials/telegram/api.json
 */
export async function loadTelegramApiCredentials(): Promise<{
  apiId: number;
  apiHash: string;
} | null> {
  const apiFile = join(SESSION_DIR, "api.json");
  try {
    const content = await readFile(apiFile, "utf-8");
    const data = JSON.parse(content);
    if (data.apiId && data.apiHash) {
      return { apiId: Number(data.apiId), apiHash: data.apiHash };
    }
  } catch {
    // File doesn't exist
  }
  return null;
}

/**
 * Check if user account is configured
 */
export async function isTelegramUserConfigured(): Promise<boolean> {
  const creds = await loadTelegramApiCredentials();
  return creds !== null;
}

/**
 * Get phone number from config
 */
export function getTelegramUserPhone(config: ZeeConfig): string | null {
  // Check for telegram.user.phoneNumber in config
  const userConfig = (config as any).telegram?.user;
  if (userConfig?.phoneNumber) {
    return userConfig.phoneNumber;
  }
  // Also check environment
  return process.env.TELEGRAM_USER_PHONE || null;
}

/**
 * Create provider from zee config
 */
export async function createTelegramUserFromConfig(
  config: ZeeConfig
): Promise<TelegramUserProvider | null> {
  const creds = await loadTelegramApiCredentials();
  if (!creds) {
    log.warn("Telegram API credentials not found at ~/.zee/credentials/telegram/api.json");
    log.warn("Get them from https://my.telegram.org/apps");
    return null;
  }

  const phoneNumber = getTelegramUserPhone(config);
  if (!phoneNumber) {
    log.warn("Telegram user phone number not configured");
    log.warn("Set telegram.user.phoneNumber in ~/.zee/zee.json or TELEGRAM_USER_PHONE env");
    return null;
  }

  const password = (config as any).telegram?.user?.password || process.env.TELEGRAM_USER_2FA;

  return createTelegramUserClient({
    apiId: creds.apiId,
    apiHash: creds.apiHash,
    phoneNumber,
    password,
  });
}
