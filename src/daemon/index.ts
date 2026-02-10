#!/usr/bin/env bun
/**
 * Daemon Entry Point
 *
 * Starts the IPC server for daemon communication.
 * Can be extended to include LSP server and other services.
 */

import { DaemonServer } from "./ipc-server";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Parse CLI arguments
const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const ipcSocket = getArg("ipc-socket");
const lspPort = getArg("lsp-port");
const lspHost = getArg("lsp-host") || "127.0.0.1";

async function main(): Promise<void> {
  console.log(`[daemon] Starting zee daemon (PID: ${process.pid})`);

  // Ensure log directory exists
  const logDir = join(homedir(), ".zee", "zee");
  mkdirSync(logDir, { recursive: true });

  // Start IPC server
  const server = new DaemonServer(ipcSocket);

  server.on("listening", (path: string) => {
    console.log(`[daemon] IPC server listening on ${path}`);
  });

  server.on("error", (err: Error) => {
    console.error(`[daemon] Server error: ${err.message}`);
  });

  server.on("shutdown", () => {
    console.log("[daemon] Shutting down...");
  });

  await server.start();

  // TODO: Start LSP server if ports configured
  if (lspPort) {
    console.log(`[daemon] LSP server would start on ${lspHost}:${lspPort}`);
    // Future: integrate with an LSP server
  }

  // Handle signals
  const shutdown = async () => {
    console.log("[daemon] Received shutdown signal");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log("[daemon] Ready");
}

main().catch((err) => {
  console.error(`[daemon] Fatal error: ${err.message}`);
  process.exit(1);
});
