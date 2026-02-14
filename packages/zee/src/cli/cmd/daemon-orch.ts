import { cmd } from "./cmd"
import { DaemonServer } from "@root/daemon/ipc-server"
import { DEFAULT_SOCKET_PATH, LEGACY_SOCKET_PATH } from "@root/daemon/types"
import { availableParallelism, cpus } from "node:os"
import fs from "node:fs/promises"
import type { QueueDedupeMode, QueueDropPolicy } from "@root/swarm/queue"

function parsePositiveInt(raw: unknown, fallback: number): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim().length > 0
        ? Number(raw)
        : Number.NaN
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function parseDropPolicy(raw: unknown): QueueDropPolicy {
  return raw === "old" || raw === "new" || raw === "summarize" ? raw : "summarize"
}

function parseDedupeMode(raw: unknown): QueueDedupeMode {
  return raw === "task-id" || raw === "prompt" || raw === "none" ? raw : "task-id"
}

function defaultMaxWorkers(): number {
  const cores = (() => {
    try {
      return typeof availableParallelism === "function"
        ? availableParallelism()
        : cpus().length
    } catch {
      return 2
    }
  })()
  return Math.max(2, Math.min(8, cores - 1))
}

async function cleanupLegacySocket(activeSocketPath: string): Promise<void> {
  if (activeSocketPath === LEGACY_SOCKET_PATH) return
  try {
    const stat = await fs.lstat(LEGACY_SOCKET_PATH)
    if (!stat.isSocket()) return
    await fs.unlink(LEGACY_SOCKET_PATH)
    console.log(`[daemon] Removed legacy socket ${LEGACY_SOCKET_PATH}`)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT") {
      console.warn(`[daemon] Failed to cleanup legacy socket ${LEGACY_SOCKET_PATH}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export const DaemonOrchCommand = cmd({
  command: "daemon-orch",
  describe: "Start the orchestration daemon IPC service",
  builder: (yargs) =>
    yargs
      .option("ipc-socket", {
        describe: "Unix socket path for orchestration IPC",
        type: "string",
      })
      .option("max-workers", {
        describe: "Maximum orchestration workers (default: CPU-based auto)",
        type: "number",
      })
      .option("queue-cap", {
        describe: "Queue capacity for orchestration tasks",
        type: "number",
      })
      .option("queue-drop-policy", {
        describe: "Queue overflow policy",
        type: "string",
        choices: ["old", "new", "summarize"],
      })
      .option("queue-dedupe-mode", {
        describe: "Queue dedupe mode",
        type: "string",
        choices: ["task-id", "prompt", "none"],
      })
      .option("lsp-port", {
        describe: "Reserved for future LSP integration",
        type: "number",
      })
      .option("lsp-host", {
        describe: "Reserved for future LSP integration host",
        type: "string",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    const socketPath =
      (args["ipc-socket"] as string | undefined)?.trim() ||
      process.env.ZEE_IPC_SOCKET ||
      DEFAULT_SOCKET_PATH
    const lspPort = args["lsp-port"] as number | undefined
    const lspHost = (args["lsp-host"] as string | undefined) || "127.0.0.1"
    const maxWorkers = parsePositiveInt(
      args["max-workers"] ?? process.env.ZEE_ORCH_MAX_WORKERS,
      defaultMaxWorkers(),
    )
    const queueCap = parsePositiveInt(
      args["queue-cap"] ?? process.env.ZEE_ORCH_QUEUE_CAP,
      20,
    )
    const queueDropPolicy = parseDropPolicy(
      args["queue-drop-policy"] ?? process.env.ZEE_ORCH_QUEUE_DROP_POLICY,
    )
    const queueDedupeMode = parseDedupeMode(
      args["queue-dedupe-mode"] ?? process.env.ZEE_ORCH_QUEUE_DEDUPE_MODE,
    )

    console.log(`[daemon] Starting zee daemon (PID: ${process.pid})`)
    await cleanupLegacySocket(socketPath)

    const server = new DaemonServer({
      socketPath,
      orchestration: {
        maxWorkers,
        queue: {
          cap: queueCap,
          dropPolicy: queueDropPolicy,
          dedupeMode: queueDedupeMode,
        },
      },
    })

    server.on("listening", (path: string) => {
      console.log(`[daemon] IPC server listening on ${path}`)
      console.log(`[daemon] Orchestration: workers=${maxWorkers}, queueCap=${queueCap}`)
    })

    server.on("error", (err: Error) => {
      console.error(`[daemon] Server error: ${err.message}`)
    })

    server.on("shutdown", () => {
      console.log("[daemon] Shutting down...")
    })

    await server.start()

    if (lspPort) {
      console.log(`[daemon] LSP server would start on ${lspHost}:${lspPort}`)
    }

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      console.log("[daemon] Received shutdown signal")
      await server.stop()
      process.exit(0)
    }

    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)

    console.log("[daemon] Ready")

    // Keep process running while the IPC server is active.
    await new Promise(() => {})
  },
})
