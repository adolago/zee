/**
 * Matrix Client Wrapper
 *
 * Wraps matrix-bot-sdk to provide a simplified interface for the
 * Matrix channel plugin. Handles client lifecycle, sync, and basic
 * room operations.
 */

import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
  type IStorageProvider,
} from "matrix-bot-sdk";
import path from "node:path";
import fs from "node:fs";

export interface MatrixClientConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  stateDir: string;
}

let activeClient: MatrixClient | null = null;
let activeConfig: MatrixClientConfig | null = null;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function createMatrixClient(config: MatrixClientConfig): MatrixClient {
  ensureDir(config.stateDir);
  const storageProvider: IStorageProvider = new SimpleFsStorageProvider(
    path.join(config.stateDir, "bot.json"),
  );

  const client = new MatrixClient(
    config.homeserver,
    config.accessToken,
    storageProvider,
  );

  AutojoinRoomsMixin.setupOnClient(client);

  activeClient = client;
  activeConfig = config;
  return client;
}

export function getActiveMatrixClient(): MatrixClient | null {
  return activeClient;
}

export function getActiveMatrixConfig(): MatrixClientConfig | null {
  return activeConfig;
}

export async function startMatrixClient(client: MatrixClient): Promise<void> {
  await client.start();
}

export async function stopMatrixClient(): Promise<void> {
  if (activeClient) {
    activeClient.stop();
    activeClient = null;
    activeConfig = null;
  }
}
