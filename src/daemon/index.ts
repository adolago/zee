#!/usr/bin/env bun
/**
 * Daemon Entry Point
 *
 * Starts the IPC server for daemon communication.
 * Can be extended to include LSP server and other services.
 */

import { DaemonServer } from "./ipc-server";
import { mkdirSync } from "node:fs";
import { homedir, availableParallelism, cpus } from "node:os";
import { join } from "node:path";
import type { QueueDedupeMode, QueueDropPolicy } from "../swarm/queue";
import {
  TmuxVisualOrchestrationSink,
} from "../orchestration-visual";
import type {
  OrchestrationVisualMode,
  VisualOrchestrationSink,
} from "../orchestration-visual";

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

function parseVisualMode(raw: string | undefined): OrchestrationVisualMode {
  return raw?.toLowerCase() === "external" ? "external" : "events";
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function defaultMaxWorkers(): number {
  const cores = (() => {
    try {
      return typeof availableParallelism === "function"
        ? availableParallelism()
        : cpus().length;
    } catch {
      return 2;
    }
  })();
  return Math.max(2, Math.min(8, cores - 1));
}

async function main(): Promise<void> {
  console.log(`[daemon] Starting zee daemon (PID: ${process.pid})`);

  // Ensure log directory exists
  const logDir = join(homedir(), ".zee", "zee");
  mkdirSync(logDir, { recursive: true });

  const maxWorkers = parsePositiveInt(
    getArg("max-workers") ?? process.env.ZEE_ORCH_MAX_WORKERS,
    defaultMaxWorkers(),
  );
  const queueCap = parsePositiveInt(
    getArg("queue-cap") ?? process.env.ZEE_ORCH_QUEUE_CAP,
    20,
  );
  let visualMode = parseVisualMode(
    getArg("visual-mode") ?? process.env.ZEE_ORCH_VISUAL_MODE,
  );
  let visualBackend = (getArg("visual-backend") ?? process.env.ZEE_ORCH_VISUAL_BACKEND)
    ?.trim()
    .toLowerCase();
  let visualSink: VisualOrchestrationSink | undefined;

  if (visualMode === "external") {
    if (visualBackend === "tmux") {
      const keepSession = parseBoolean(process.env.ZEE_ORCH_TMUX_KEEP_SESSION) ?? false;
      visualSink = new TmuxVisualOrchestrationSink({
        socketPath: process.env.ZEE_ORCH_TMUX_SOCKET,
        sessionName: process.env.ZEE_ORCH_TMUX_SESSION,
        baseDir: process.env.ZEE_ORCH_TMUX_BASE_DIR,
        maxWorkerPanes: parsePositiveInt(process.env.ZEE_ORCH_TMUX_MAX_PANES, 8),
        cleanupSessionOnClose: !keepSession,
      });
    } else {
      console.warn(
        `[daemon] Unknown visual backend "${visualBackend ?? "undefined"}"; falling back to event mode`,
      );
      visualMode = "events";
      visualBackend = undefined;
    }
  } else {
    visualBackend = undefined;
  }

  // Start IPC server
  const server = new DaemonServer({
    socketPath: ipcSocket,
    orchestration: {
      maxWorkers,
      visual: {
        enabled: true,
        mode: visualMode,
        backend: visualBackend,
      },
      visualSink,
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
    if (visualMode === "external" && visualBackend === "tmux" && visualSink instanceof TmuxVisualOrchestrationSink) {
      console.log(
        `[daemon] Visual backend: tmux (socket=${visualSink.socketPath}, session=${visualSink.sessionName})`,
      );
    } else {
      console.log(`[daemon] Visual backend: event stream`);
    }
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
    if (visualSink?.close) {
      await visualSink.close().catch(() => {});
    }
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
