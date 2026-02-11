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
import type { QueueDedupeMode, QueueDropPolicy } from "../swarm/queue";

// Parse CLI arguments
const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const ipcSocket = getArg("ipc-socket");
const lspPort = getArg("lsp-port");
const lspHost = getArg("lsp-host") || "127.0.0.1";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function parseDropPolicy(raw: string | undefined): QueueDropPolicy {
  if (raw === "old" || raw === "new" || raw === "summarize") return raw;
  return "summarize";
}

function parseDedupeMode(raw: string | undefined): QueueDedupeMode {
  if (raw === "task-id" || raw === "prompt" || raw === "none") return raw;
  return "task-id";
}

async function main(): Promise<void> {
  console.log(`[daemon] Starting zee daemon (PID: ${process.pid})`);

  // Ensure log directory exists
  const logDir = join(homedir(), ".zee", "zee");
  mkdirSync(logDir, { recursive: true });

  const maxWorkers = parsePositiveInt(
    getArg("max-workers") ?? process.env.ZEE_ORCH_MAX_WORKERS,
    8,
  );
  const queueCap = parsePositiveInt(
    getArg("queue-cap") ?? process.env.ZEE_ORCH_QUEUE_CAP,
    20,
  );

  // Start IPC server
  const server = new DaemonServer({
    socketPath: ipcSocket,
    orchestration: {
      maxWorkers,
      queue: {
        cap: queueCap,
        dropPolicy: parseDropPolicy(
          getArg("queue-drop-policy") ?? process.env.ZEE_ORCH_QUEUE_DROP_POLICY,
        ),
        dedupeMode: parseDedupeMode(
          getArg("queue-dedupe-mode") ?? process.env.ZEE_ORCH_QUEUE_DEDUPE_MODE,
        ),
      },
    },
  });

  server.on("listening", (path: string) => {
    console.log(`[daemon] IPC server listening on ${path}`);
    console.log(`[daemon] Orchestration: workers=${maxWorkers}, queueCap=${queueCap}`);
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
