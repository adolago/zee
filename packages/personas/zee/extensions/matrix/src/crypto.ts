/**
 * Matrix E2EE Support
 *
 * End-to-end encryption using the Matrix Rust crypto SDK via
 * @matrix-org/matrix-sdk-crypto-nodejs. State is persisted in
 * SQLite at ~/.zee/matrix/crypto/.
 *
 * This module is loaded lazily since the native crypto dependency
 * is optional -- channels that do not enable E2EE work without it.
 */

import path from "node:path";
import fs from "node:fs";

export interface CryptoConfig {
  stateDir: string;
  userId: string;
  deviceId: string;
}

const DEFAULT_CRYPTO_DIR = path.join(
  process.env.HOME ?? "",
  ".zee",
  "matrix",
  "crypto",
);

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Initialize the crypto store. Returns the crypto directory path.
 * The actual @matrix-org/matrix-sdk-crypto-nodejs module is loaded
 * dynamically so the extension does not hard-fail when the native
 * module is absent.
 */
export async function initializeCryptoStore(config?: Partial<CryptoConfig>): Promise<string> {
  const stateDir = config?.stateDir ?? DEFAULT_CRYPTO_DIR;
  ensureDir(stateDir);

  // The matrix-bot-sdk handles crypto integration internally when
  // configured with a crypto storage provider. We just need to ensure
  // the directory exists and return the path for the SDK to use.
  return stateDir;
}

/**
 * Check if the crypto native module is available.
 */
export async function isCryptoAvailable(): Promise<boolean> {
  try {
    // Attempt dynamic import of the native Rust crypto module
    await import("@matrix-org/matrix-sdk-crypto-nodejs");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the crypto store path for a given user.
 */
export function getCryptoStorePath(userId?: string): string {
  if (userId) {
    const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(DEFAULT_CRYPTO_DIR, sanitized);
  }
  return DEFAULT_CRYPTO_DIR;
}
